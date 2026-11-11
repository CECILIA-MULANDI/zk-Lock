use ckb_testtool::ckb_hash::blake2b_256;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::{Capacity, ScriptHashType, TransactionBuilder, TransactionView},
    packed::{CellDep, CellInput, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
};
use ckb_testtool::context::Context;

use crate::{
    E_ARGS_LENGTH, E_CONTEXT_MISMATCH, E_INVALID_PROOF, E_PI_COMMITMENT_MISMATCH,
    E_PUBLIC_INPUT_COUNT_TOO_SMALL, E_PUBLIC_INPUTS_LENGTH_MISMATCH, E_VKEY_DUPLICATED,
    E_VKEY_NOT_FOUND, E_WITNESS_LOCK_MISSING, E_WITNESS_LOCK_TOO_SHORT, MAX_CYCLES,
    assert_rejects_with,
};

const CONTRACT_NAME: &str = "zk-lock-bound";
const VK_BYTES: &[u8] = include_bytes!("../fixtures/vk.bin");

// poseidon-preimage-bound fixtures: pi[0] is the context scalar, pi[1] the
// digest. Valid only for the one transaction `success_path` builds, since the
// scalar is that transaction's hash. That circuit's `input.json` holds the same
// value, so these files are reproducible with prove.sh plus a re-encode.
const BOUND_VK_BYTES: &[u8] = include_bytes!("../fixtures/bound/vk.bin");
const BOUND_PROOF_BYTES: &[u8] = include_bytes!("../fixtures/bound/proof.bin");
const BOUND_PI_BYTES: &[u8] = include_bytes!("../fixtures/bound/public_inputs.bin");

fn vk_hash() -> [u8; 32] {
    blake2b_256(VK_BYTES)
}

fn args_bytes(vk: [u8; 32], commitment: [u8; 32]) -> Bytes {
    let mut buf = Vec::with_capacity(64);
    buf.extend_from_slice(&vk);
    buf.extend_from_slice(&commitment);
    Bytes::from(buf)
}

fn dummy_proof() -> [u8; 128] {
    [0u8; 128]
}

fn pack_witness_lock(proof: &[u8], pi_field_elements: &[[u8; 32]]) -> Bytes {
    let mut buf = Vec::with_capacity(proof.len() + 4 + pi_field_elements.len() * 32);
    buf.extend_from_slice(proof);
    buf.extend_from_slice(&(pi_field_elements.len() as u32).to_le_bytes());
    for fe in pi_field_elements {
        buf.extend_from_slice(fe);
    }
    Bytes::from(buf)
}

fn commit_body(body_pi: &[[u8; 32]]) -> [u8; 32] {
    let mut buf = Vec::with_capacity(body_pi.len() * 32);
    for fe in body_pi {
        buf.extend_from_slice(fe);
    }
    blake2b_256(&buf)
}

// The scalar the script computes for `tx`. Witnesses are outside `tx_hash`,
// which is why the tests below can build a transaction, hash it, and rebuild it
// carrying a witness bound to that hash.
fn expected_context(tx: &TransactionView) -> [u8; 32] {
    let mut scalar = [0u8; 32];
    scalar[..31].copy_from_slice(&tx.hash().raw_data()[..31]);
    scalar
}

// Builds a bound-script transaction.
// Returns (tx, expected_context_scalar)
// so tests can verify the on-chain context computation against ours.
fn build_tx_bound(
    context: &mut Context,
    args: Bytes,
    witness_lock: Option<Bytes>,
    include_vk_cell_dep: bool,
) -> (ckb_testtool::ckb_types::core::TransactionView, [u8; 32]) {
    let script_op = context.deploy_cell_by_name(CONTRACT_NAME);
    let lock_script = context.build_script(&script_op, args).expect("script");

    let input_out_point = context.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );
    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();

    let output_cell = CellOutput::new_builder()
        .capacity(500u64)
        .lock(lock_script)
        .build();
    let outputs = vec![output_cell];
    let outputs_data = vec![Bytes::new(); outputs.len()];

    let witness_args = WitnessArgs::new_builder().lock(witness_lock.pack()).build();

    let mut builder = TransactionBuilder::default()
        .input(input)
        .outputs(outputs)
        .outputs_data(outputs_data.pack())
        .witness(witness_args.as_bytes().pack());

    if include_vk_cell_dep {
        let vk_op = context.deploy_cell(Bytes::from(VK_BYTES.to_vec()));
        builder = builder.cell_dep(CellDep::new_builder().out_point(vk_op).build());
    }

    let tx = context.complete_tx(builder.build());
    let expected = expected_context(&tx);
    (tx, expected)
}

#[test]
fn args_len_rejects() {
    let mut ctx = Context::default();
    let (tx, _) = build_tx_bound(&mut ctx, Bytes::from(vec![0u8; 63]), None, false);
    assert_rejects_with(&ctx, &tx, E_ARGS_LENGTH);
}

#[test]
fn vkey_not_found_rejects() {
    let mut ctx = Context::default();
    let commit = commit_body(&[[7u8; 32]]);
    let witness = pack_witness_lock(&dummy_proof(), &[[0u8; 32], [7u8; 32]]);
    let (tx, _) = build_tx_bound(
        &mut ctx,
        args_bytes(vk_hash(), commit),
        Some(witness),
        false,
    );
    assert_rejects_with(&ctx, &tx, E_VKEY_NOT_FOUND);
}

#[test]
fn vkey_duplicate_rejects() {
    let mut ctx = Context::default();

    let script_op = ctx.deploy_cell_by_name(CONTRACT_NAME);
    let commit = commit_body(&[[7u8; 32]]);
    let lock_script = ctx
        .build_script(&script_op, args_bytes(vk_hash(), commit))
        .expect("script");

    let input_out_point = ctx.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );
    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();

    let output_cell = CellOutput::new_builder()
        .capacity(500u64)
        .lock(lock_script)
        .build();

    let witness = pack_witness_lock(&dummy_proof(), &[[0u8; 32], [7u8; 32]]);
    let witness_args = WitnessArgs::new_builder()
        .lock(Some(witness).pack())
        .build();

    let vk_op_a = ctx.deploy_cell(Bytes::from(VK_BYTES.to_vec()));
    let vk_op_b = ctx.deploy_cell(Bytes::from(VK_BYTES.to_vec()));

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output_cell)
        .output_data(Bytes::new().pack())
        .witness(witness_args.as_bytes().pack())
        .cell_dep(CellDep::new_builder().out_point(vk_op_a).build())
        .cell_dep(CellDep::new_builder().out_point(vk_op_b).build())
        .build();
    let tx = ctx.complete_tx(tx);

    assert_rejects_with(&ctx, &tx, E_VKEY_DUPLICATED);
}

#[test]
fn witness_missing_rejects() {
    let mut ctx = Context::default();
    let commit = commit_body(&[[7u8; 32]]);
    let (tx, _) = build_tx_bound(&mut ctx, args_bytes(vk_hash(), commit), None, true);
    assert_rejects_with(&ctx, &tx, E_WITNESS_LOCK_MISSING);
}

#[test]
fn witness_lock_too_short_rejects() {
    let mut ctx = Context::default();
    let commit = commit_body(&[[7u8; 32]]);
    let (tx, _) = build_tx_bound(
        &mut ctx,
        args_bytes(vk_hash(), commit),
        Some(Bytes::from(vec![0u8; 100])),
        true,
    );
    assert_rejects_with(&ctx, &tx, E_WITNESS_LOCK_TOO_SHORT);
}

#[test]
fn pi_length_mismatch_rejects() {
    let mut ctx = Context::default();
    let mut buf = Vec::new();
    buf.extend_from_slice(&dummy_proof());
    buf.extend_from_slice(&99u32.to_le_bytes());
    buf.extend_from_slice(&[0u8; 32]);
    let commit = commit_body(&[[7u8; 32]]);
    let (tx, _) = build_tx_bound(
        &mut ctx,
        args_bytes(vk_hash(), commit),
        Some(Bytes::from(buf)),
        true,
    );
    assert_rejects_with(&ctx, &tx, E_PUBLIC_INPUTS_LENGTH_MISMATCH);
}

#[test]
fn pi_count_zero_rejects() {
    let mut ctx = Context::default();
    let mut buf = Vec::new();
    buf.extend_from_slice(&dummy_proof());
    buf.extend_from_slice(&0u32.to_le_bytes());
    let commit = commit_body(&[]);
    let (tx, _) = build_tx_bound(
        &mut ctx,
        args_bytes(vk_hash(), commit),
        Some(Bytes::from(buf)),
        true,
    );
    assert_rejects_with(&ctx, &tx, E_PUBLIC_INPUT_COUNT_TOO_SMALL);
}

#[test]
fn pi_commitment_mismatch_rejects() {
    let mut ctx = Context::default();
    let witness = pack_witness_lock(&dummy_proof(), &[[0u8; 32], [7u8; 32]]);
    let (tx, _) = build_tx_bound(
        &mut ctx,
        args_bytes(vk_hash(), [0xFFu8; 32]),
        Some(witness),
        true,
    );
    assert_rejects_with(&ctx, &tx, E_PI_COMMITMENT_MISMATCH);
}

#[test]
fn context_mismatch_rejects() {
    let mut ctx = Context::default();
    let body: [[u8; 32]; 1] = [[7u8; 32]];
    let commit = commit_body(&body);
    let witness = pack_witness_lock(&dummy_proof(), &[[0u8; 32], body[0]]);
    let (tx, _) = build_tx_bound(&mut ctx, args_bytes(vk_hash(), commit), Some(witness), true);
    assert_rejects_with(&ctx, &tx, E_CONTEXT_MISMATCH);
}

// Sanity check: when pi[0] equals the expected context and body commitment
// matches, all pre-Groth16 checks pass; the script reaches verifier_core::verify
// and rejects on our garbage proof.
// This confirms our off-chain context
// computation matches the on-chain one. Uses the bound VK so the arity
// cross-check passes and the rejection comes from the proof itself.
#[test]
fn context_matches_then_fails_at_groth16() {
    let mut ctx = Context::default();

    let script_op = ctx.deploy_cell_by_name(CONTRACT_NAME);
    let vk_op = ctx.deploy_cell(Bytes::from(BOUND_VK_BYTES.to_vec()));

    let body: [[u8; 32]; 1] = [[7u8; 32]];
    let commit = commit_body(&body);
    let lock_script = ctx
        .build_script(&script_op, args_bytes(bound_vk_hash(), commit))
        .expect("script");

    let input_out_point = ctx.create_cell(
        CellOutput::new_builder()
            .capacity(1000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );
    let output_cell = CellOutput::new_builder()
        .capacity(500u64)
        .lock(lock_script)
        .build();

    let build = |witness_lock: Bytes| {
        let witness_args = WitnessArgs::new_builder()
            .lock(Some(witness_lock).pack())
            .build();
        TransactionBuilder::default()
            .input(
                CellInput::new_builder()
                    .previous_output(input_out_point.clone())
                    .build(),
            )
            .output(output_cell.clone())
            .output_data(Bytes::new().pack())
            .witness(witness_args.as_bytes().pack())
            .cell_dep(CellDep::new_builder().out_point(vk_op.clone()).build())
            .build()
    };

    // Two passes: the scalar hashes the transaction the witness goes into, and
    // `tx_hash` excludes witnesses, so both passes hash the same.
    let placeholder = pack_witness_lock(&dummy_proof(), &[[0u8; 32], body[0]]);
    let expected = expected_context(&ctx.complete_tx(build(placeholder)));

    let witness = pack_witness_lock(&dummy_proof(), &[expected, body[0]]);
    let tx = ctx.complete_tx(build(witness));

    // InvalidProof, not VerificationFailed: dummy_proof() is 128 zero bytes,
    // which decodes to points at infinity, and verifier_core rejects those
    // before the pairing check. Either way it got past the context and
    // commitment checks, which is the point of this test.
    assert_rejects_with(&ctx, &tx, E_INVALID_PROOF);
}

// ---------------------------------------------------------------------------
// Binding tests.
//
// build_tx_bound derives the context scalar from the very cells it builds, so
// it cannot express a mismatch. These tests need the witness to commit to one
// transaction while a different one is submitted, so they assemble the pieces
// directly.
// ---------------------------------------------------------------------------

struct BoundParts {
    lock_script: Script,
    vk_dep: CellDep,
}

fn prepare_bound(ctx: &mut Context, commitment: [u8; 32]) -> BoundParts {
    let script_op = ctx.deploy_cell_by_name(CONTRACT_NAME);
    let vk_op = ctx.deploy_cell(Bytes::from(VK_BYTES.to_vec()));
    let lock_script = ctx
        .build_script(&script_op, args_bytes(vk_hash(), commitment))
        .expect("script");
    BoundParts {
        lock_script,
        vk_dep: CellDep::new_builder().out_point(vk_op).build(),
    }
}

fn submit(
    ctx: &mut Context,
    parts: &BoundParts,
    input_out_point: OutPoint,
    output_cell: CellOutput,
    output_data: Bytes,
    witness_lock: Bytes,
) -> TransactionView {
    let witness_args = WitnessArgs::new_builder()
        .lock(Some(witness_lock).pack())
        .build();
    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_out_point)
                .build(),
        )
        .output(output_cell)
        .output_data(output_data.pack())
        .witness(witness_args.as_bytes().pack())
        .cell_dep(parts.vk_dep.clone())
        .build();
    ctx.complete_tx(tx)
}

fn locked_cell(ctx: &mut Context, parts: &BoundParts, capacity: u64) -> OutPoint {
    ctx.create_cell(
        CellOutput::new_builder()
            .capacity(capacity)
            .lock(parts.lock_script.clone())
            .build(),
        Bytes::new(),
    )
}

// The proof commits to the whole transaction, outputs included. Rewriting an
// output after the fact must invalidate it. This is the recipient-redirect
// case: an attacker reuses a broadcast witness but pays a different cell.
#[test]
fn wrong_output_rejects() {
    let mut ctx = Context::default();
    let body: [[u8; 32]; 1] = [[7u8; 32]];
    let parts = prepare_bound(&mut ctx, commit_body(&body));
    let input_out_point = locked_cell(&mut ctx, &parts, 1000u64);

    let committed_output = CellOutput::new_builder()
        .capacity(500u64)
        .lock(parts.lock_script.clone())
        .build();
    let committed = submit(
        &mut ctx,
        &parts,
        input_out_point.clone(),
        committed_output,
        Bytes::new(),
        pack_witness_lock(&dummy_proof(), &[[0u8; 32], body[0]]),
    );
    let expected = expected_context(&committed);
    let witness = pack_witness_lock(&dummy_proof(), &[expected, body[0]]);

    // Same shape, different capacity: the attacker keeps the change.
    let substituted_output = CellOutput::new_builder()
        .capacity(400u64)
        .lock(parts.lock_script.clone())
        .build();

    let tx = submit(
        &mut ctx,
        &parts,
        input_out_point,
        substituted_output,
        Bytes::new(),
        witness,
    );
    assert_rejects_with(&ctx, &tx, E_CONTEXT_MISMATCH);
}

// `outputs_data` is its own field of the RawTransaction. The other tests all
// use empty output data, so this is the only one exercising it.
#[test]
fn wrong_output_data_rejects() {
    let mut ctx = Context::default();
    let body: [[u8; 32]; 1] = [[7u8; 32]];
    let parts = prepare_bound(&mut ctx, commit_body(&body));
    let input_out_point = locked_cell(&mut ctx, &parts, 1000u64);

    let output_cell = CellOutput::new_builder()
        .capacity(500u64)
        .lock(parts.lock_script.clone())
        .build();

    // Identical cell struct; only the data differs.
    let committed = submit(
        &mut ctx,
        &parts,
        input_out_point.clone(),
        output_cell.clone(),
        Bytes::from_static(b"committed"),
        pack_witness_lock(&dummy_proof(), &[[0u8; 32], body[0]]),
    );
    let expected = expected_context(&committed);
    let witness = pack_witness_lock(&dummy_proof(), &[expected, body[0]]);

    let tx = submit(
        &mut ctx,
        &parts,
        input_out_point,
        output_cell,
        Bytes::from_static(b"substituted"),
        witness,
    );
    assert_rejects_with(&ctx, &tx, E_CONTEXT_MISMATCH);
}

// The proof commits to the transaction's inputs. Reusing the witness against a
// different cell carrying identical args must fail. This is the mempool
// witness-copy case, and it is the cross-cell replay that plain zk-lock
// cannot prevent.
#[test]
fn wrong_input_rejects() {
    let mut ctx = Context::default();
    let body: [[u8; 32]; 1] = [[7u8; 32]];
    let parts = prepare_bound(&mut ctx, commit_body(&body));

    // Two cells, same lock args, different outpoints.
    let committed_input = locked_cell(&mut ctx, &parts, 1000u64);
    let other_input = locked_cell(&mut ctx, &parts, 1000u64);
    assert_ne!(committed_input, other_input);

    let output_cell = CellOutput::new_builder()
        .capacity(500u64)
        .lock(parts.lock_script.clone())
        .build();

    let committed = submit(
        &mut ctx,
        &parts,
        committed_input,
        output_cell.clone(),
        Bytes::new(),
        pack_witness_lock(&dummy_proof(), &[[0u8; 32], body[0]]),
    );
    let expected = expected_context(&committed);
    let witness = pack_witness_lock(&dummy_proof(), &[expected, body[0]]);

    let tx = submit(
        &mut ctx,
        &parts,
        other_input,
        output_cell,
        Bytes::new(),
        witness,
    );
    assert_rejects_with(&ctx, &tx, E_CONTEXT_MISMATCH);
}

// A witness built for the generic zk-lock has no reserved context slot: every
// scalar is statement. Posting it at the bound lock must fail, because the
// bound lock reads pi[0] as context and commits only pi[1..]. The two args
// layouts are not interchangeable, which is the point of treating them as
// separate profiles.
#[test]
fn generic_witness_replayed_against_bound_rejects() {
    let mut ctx = Context::default();

    // Generic layout: args commit to the WHOLE pi array.
    let generic_pi: [[u8; 32]; 2] = [[3u8; 32], [7u8; 32]];
    let generic_commitment = commit_body(&generic_pi);

    let parts = prepare_bound(&mut ctx, generic_commitment);
    let input_out_point = locked_cell(&mut ctx, &parts, 1000u64);
    let output_cell = CellOutput::new_builder()
        .capacity(500u64)
        .lock(parts.lock_script.clone())
        .build();

    let witness = pack_witness_lock(&dummy_proof(), &generic_pi);

    // The bound lock hashes pi[1..] only, so it never matches a commitment
    // taken over pi[0..]. It fails on the commitment before it even reaches
    // the context comparison.
    let tx = submit(
        &mut ctx,
        &parts,
        input_out_point,
        output_cell,
        Bytes::new(),
        witness,
    );
    assert_rejects_with(&ctx, &tx, E_PI_COMMITMENT_MISMATCH);
}

// Every field of the transaction the fixture proof is bound to is pinned here,
// deps included, because `tx_hash` covers cell_deps and a dep is identified by
// an outpoint. Letting ckb-testtool choose those outpoints would tie the proof
// to the compiled binary, which is not byte-identical across machines, so the
// fixture could pass locally and fail in CI. See `pinned_dep`.
const PINNED_INPUT_TX_HASH: [u8; 32] = [0xAA; 32];
const PINNED_OUT_CODE_HASH: [u8; 32] = [0xBB; 32];
const PINNED_OUT_ARGS: [u8; 20] = [0xCC; 20];
const PINNED_OUT_CAPACITY: u64 = 500;
const PINNED_CONTRACT_DEP_TX_HASH: [u8; 32] = [0x11; 32];
const PINNED_VK_DEP_TX_HASH: [u8; 32] = [0x22; 32];

// Registers `data` as a dep cell at a fixed outpoint, and returns that outpoint.
//
// `Context::deploy_cell` derives an outpoint from the data hash, so the dep
// outpoint moves whenever the bytes move. A lock script is not part of the
// RawTransaction, only the outpoint it is spent from, so pinning the dep here
// keeps `tx_hash` constant while the script's code hash still tracks the binary
// the test actually runs.
fn pinned_dep(ctx: &mut Context, tx_hash: [u8; 32], data: Bytes) -> OutPoint {
    let out_point = OutPoint::new_builder()
        .tx_hash(tx_hash.pack())
        .index(0u32)
        .build();
    let cell = CellOutput::new_builder().build();
    let capacity = cell
        .occupied_capacity(Capacity::bytes(data.len()).expect("dep data size"))
        .expect("dep capacity");
    ctx.create_cell_with_out_point(
        out_point.clone(),
        cell.as_builder().capacity(capacity.pack()).build(),
        data,
    );
    out_point
}

// The contract bytes ckb-testtool located, so the pinned copy is the same
// binary the suite builds without this test duplicating the search path.
fn contract_bytes(ctx: &mut Context) -> Bytes {
    let found = ctx.deploy_cell_by_name(CONTRACT_NAME);
    ctx.cells
        .get(&found)
        .expect("deployed contract cell")
        .1
        .clone()
}

fn bound_vk_hash() -> [u8; 32] {
    blake2b_256(BOUND_VK_BYTES)
}

// The script commits to pi[1..]: past the 4-byte count and the context.
fn bound_body_commitment() -> [u8; 32] {
    blake2b_256(&BOUND_PI_BYTES[36..])
}

fn bound_context_pi() -> [u8; 32] {
    let mut out = [0u8; 32];
    out.copy_from_slice(&BOUND_PI_BYTES[4..36]);
    out
}

// public_inputs.bin already has the layout pack_witness_lock builds, so the
// witness lock is a plain concatenation.
fn bound_witness_lock() -> Bytes {
    let mut buf = Vec::with_capacity(BOUND_PROOF_BYTES.len() + BOUND_PI_BYTES.len());
    buf.extend_from_slice(BOUND_PROOF_BYTES);
    buf.extend_from_slice(BOUND_PI_BYTES);
    Bytes::from(buf)
}

// Little-endian field element to the decimal snarkjs wants in input.json.
// Schoolbook base-256 to base-10; the test crate has no bignum.
fn scalar_to_decimal(scalar: &[u8; 32]) -> String {
    let mut digits: Vec<u8> = vec![0];
    for byte in scalar.iter().rev() {
        let mut carry = u32::from(*byte);
        for d in digits.iter_mut() {
            let v = u32::from(*d) * 256 + carry;
            *d = (v % 10) as u8;
            carry = v / 10;
        }
        while carry > 0 {
            digits.push((carry % 10) as u8);
            carry /= 10;
        }
    }
    digits.iter().rev().map(|d| char::from(b'0' + d)).collect()
}

// If this fires, the transaction moved and the message says how to re-prove.
fn assert_context_matches_fixtures(tx: &TransactionView) {
    let expected = expected_context(tx);
    assert_eq!(
        expected,
        bound_context_pi(),
        "this transaction no longer hashes to the context the bound fixtures \
         were proved against.\n\nSet \"context\" in \
         circuits/poseidon-preimage-bound/input.json to:\n\n  {}\n\nthen run \
         prove.sh there and re-encode tests/fixtures/bound/ with the CLI.",
        scalar_to_decimal(&expected)
    );
}

fn pinned_output_cell() -> CellOutput {
    let lock = Script::new_builder()
        .code_hash(PINNED_OUT_CODE_HASH.pack())
        .hash_type(ScriptHashType::Data1)
        .args(Bytes::from(PINNED_OUT_ARGS.to_vec()).pack())
        .build();
    CellOutput::new_builder()
        .capacity(PINNED_OUT_CAPACITY)
        .lock(lock)
        .build()
}

#[test]
fn success_path() {
    let mut ctx = Context::default();

    let contract = contract_bytes(&mut ctx);
    let script_op = pinned_dep(&mut ctx, PINNED_CONTRACT_DEP_TX_HASH, contract);
    let vk_op = pinned_dep(
        &mut ctx,
        PINNED_VK_DEP_TX_HASH,
        Bytes::from(BOUND_VK_BYTES.to_vec()),
    );
    let lock_script = ctx
        .build_script_with_hash_type(
            &script_op,
            ScriptHashType::Data1,
            args_bytes(bound_vk_hash(), bound_body_commitment()),
        )
        .expect("script");

    let input_out_point = OutPoint::new_builder()
        .tx_hash(PINNED_INPUT_TX_HASH.pack())
        .index(0u32)
        .build();
    ctx.create_cell_with_out_point(
        input_out_point.clone(),
        CellOutput::new_builder()
            .capacity(1000u64)
            .lock(lock_script)
            .build(),
        Bytes::new(),
    );

    let output_cell = pinned_output_cell();

    let witness_args = WitnessArgs::new_builder()
        .lock(Some(bound_witness_lock()).pack())
        .build();
    let tx = TransactionBuilder::default()
        .input(
            CellInput::new_builder()
                .previous_output(input_out_point)
                .build(),
        )
        .output(output_cell)
        .output_data(Bytes::new().pack())
        .witness(witness_args.as_bytes().pack())
        .cell_dep(CellDep::new_builder().out_point(vk_op).build())
        .build();
    let tx = ctx.complete_tx(tx);

    // Before verify_tx, so a moved transaction reports the context it needs
    // rather than an opaque ContextMismatch.
    assert_context_matches_fixtures(&tx);

    let cycles = ctx
        .verify_tx(&tx, MAX_CYCLES)
        .expect("bound lock should accept a proof bound to this transaction");
    println!("success_path consumed {cycles} cycles");
}

// A lock runs once per group of inputs sharing it, so a second cell with the
// same args joins the group and is spent under the one proof in the group's
// witness. While the digest covered only `GroupInput[0]` and `Output[0]` that
// cell rode along free, accepted at the same cycle count as `success_path`.
//
// The attack is purely additive, which is the point: under `tx_hash` adding
// anything changes the hash, so the committed scalar stops matching.
#[test]
fn second_cell_with_same_args_rejects() {
    let mut ctx = Context::default();

    let contract = contract_bytes(&mut ctx);
    let script_op = pinned_dep(&mut ctx, PINNED_CONTRACT_DEP_TX_HASH, contract);
    let vk_op = pinned_dep(
        &mut ctx,
        PINNED_VK_DEP_TX_HASH,
        Bytes::from(BOUND_VK_BYTES.to_vec()),
    );
    let lock_script = ctx
        .build_script_with_hash_type(
            &script_op,
            ScriptHashType::Data1,
            args_bytes(bound_vk_hash(), bound_body_commitment()),
        )
        .expect("script");

    // Cell A: exactly the cell success_path's proof is bound to.
    let a_out_point = OutPoint::new_builder()
        .tx_hash(PINNED_INPUT_TX_HASH.pack())
        .index(0u32)
        .build();
    ctx.create_cell_with_out_point(
        a_out_point.clone(),
        CellOutput::new_builder()
            .capacity(1000u64)
            .lock(lock_script.clone())
            .build(),
        Bytes::new(),
    );

    // Cell B: a second cell of the victim at the same address. Same args, so
    // the same lock script hash, so the same script group.
    let b_out_point = OutPoint::new_builder()
        .tx_hash([0xDDu8; 32].pack())
        .index(0u32)
        .build();
    ctx.create_cell_with_out_point(
        b_out_point.clone(),
        CellOutput::new_builder()
            .capacity(1000u64)
            .lock(lock_script)
            .build(),
        Bytes::new(),
    );

    // Byte-identical to what the proof bound. Enough under the old digest, not
    // under tx_hash, which is the difference this test records.
    let output_cell = pinned_output_cell();

    // Output 1 takes cell B's capacity.
    let thief_lock = Script::new_builder()
        .code_hash([0xEEu8; 32].pack())
        .hash_type(ScriptHashType::Data1)
        .args(Bytes::from(vec![0xEFu8; 20]).pack())
        .build();
    let thief_cell = CellOutput::new_builder()
        .capacity(1500u64)
        .lock(thief_lock)
        .build();

    let witness_args = WitnessArgs::new_builder()
        .lock(Some(bound_witness_lock()).pack())
        .build();

    let tx = TransactionBuilder::default()
        // Order matters: A first, so GroupInput[0] is the cell the proof bound.
        .input(
            CellInput::new_builder()
                .previous_output(a_out_point)
                .build(),
        )
        .input(
            CellInput::new_builder()
                .previous_output(b_out_point)
                .build(),
        )
        .outputs(vec![output_cell, thief_cell])
        .outputs_data([Bytes::new(), Bytes::new()].pack())
        .witness(witness_args.as_bytes().pack())
        .witness(Bytes::new().pack())
        .cell_dep(CellDep::new_builder().out_point(vk_op).build())
        .build();
    let tx = ctx.complete_tx(tx);

    assert_rejects_with(&ctx, &tx, E_CONTEXT_MISMATCH);
}

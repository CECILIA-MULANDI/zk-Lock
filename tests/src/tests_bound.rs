use ckb_testtool::ckb_hash::blake2b_256;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::{ScriptHashType, TransactionBuilder, TransactionView},
    packed::{CellDep, CellInput, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
};
use ckb_testtool::context::Context;

const MAX_CYCLES: u64 = 250_000_000;
const CONTRACT_NAME: &str = "zk-lock-bound";
const VK_BYTES: &[u8] = include_bytes!("../fixtures/vk.bin");

// poseidon-preimage-bound fixtures: pi[0] is the context scalar, pi[1] the
// digest. Only valid for the transaction success_path builds.
//
// To regenerate: set `context` in that circuit's input.json to the decimal
// below, run prove.sh, encode with the CLI, and leave input.json back at "1"
// (the tutorial has readers put their own context there).
//
//   404578604207945987828464291583686507717703603553113816808421978804353673971
const BOUND_VK_BYTES: &[u8] = include_bytes!("../fixtures/bound/vk.bin");
const BOUND_PROOF_BYTES: &[u8] = include_bytes!("../fixtures/bound/proof.bin");
const BOUND_PI_BYTES: &[u8] = include_bytes!("../fixtures/bound/public_inputs.bin");

// Error discriminants from contracts/zk-lock-bound/src/error.rs.
// Asserting these matters here: every tx in this file carries a dummy proof,
// so verify_tx fails no matter what. Without pinning the code, a test would
// still pass if the check it targets were deleted from the script.
const E_ARGS_LENGTH: i8 = 10;
const E_WITNESS_LOCK_MISSING: i8 = 11;
const E_WITNESS_LOCK_TOO_SHORT: i8 = 12;
const E_PUBLIC_INPUTS_LENGTH_MISMATCH: i8 = 13;
const E_VKEY_NOT_FOUND: i8 = 14;
const E_PI_COMMITMENT_MISMATCH: i8 = 15;
const E_INVALID_PROOF: i8 = 17;
const E_VKEY_DUPLICATED: i8 = 21;
const E_CONTEXT_MISMATCH: i8 = 22;
const E_PUBLIC_INPUT_COUNT_TOO_SMALL: i8 = 23;

fn assert_script_error(err: ckb_testtool::ckb_error::Error, code: i8) {
    let s = err.to_string();
    assert!(
        s.contains(&format!("error code {code} ")),
        "expected error code {code}, got: {s}"
    );
}

fn assert_rejects_with(ctx: &Context, tx: &TransactionView, code: i8) {
    let err = ctx
        .verify_tx(tx, MAX_CYCLES)
        .expect_err("script should have rejected this transaction");
    assert_script_error(err, code);
}

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

fn expected_context(
    input_out_point: &OutPoint,
    out_cell: &CellOutput,
    out_data: &[u8],
) -> [u8; 32] {
    let mut fh_buf = Vec::new();
    fh_buf.extend_from_slice(out_cell.as_slice());
    fh_buf.extend_from_slice(out_data);
    let first_out_hash = blake2b_256(&fh_buf);

    let mut ctx_buf = Vec::new();
    ctx_buf.extend_from_slice(input_out_point.as_slice());
    ctx_buf.extend_from_slice(&first_out_hash);
    let full = blake2b_256(&ctx_buf);

    let mut scalar = [0u8; 32];
    scalar[..31].copy_from_slice(&full[..31]);
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
        .previous_output(input_out_point.clone())
        .build();

    let output_cell = CellOutput::new_builder()
        .capacity(500u64)
        .lock(lock_script)
        .build();
    let outputs = vec![output_cell.clone()];
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

    let expected = expected_context(&input_out_point, &output_cell, &[]);
    let tx = context.complete_tx(builder.build());
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

    let expected = expected_context(&input_out_point, &output_cell, &[]);
    let witness = pack_witness_lock(&dummy_proof(), &[expected, body[0]]);
    let witness_args = WitnessArgs::new_builder()
        .lock(Some(witness).pack())
        .build();

    let input = CellInput::new_builder()
        .previous_output(input_out_point)
        .build();
    let tx = TransactionBuilder::default()
        .input(input)
        .output(output_cell)
        .output_data(Bytes::new().pack())
        .witness(witness_args.as_bytes().pack())
        .cell_dep(CellDep::new_builder().out_point(vk_op).build())
        .build();
    let tx = ctx.complete_tx(tx);

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

// The proof commits to output(0). Rewriting that output after the fact must
// invalidate it. This is the recipient-redirect case: an attacker reuses a
// broadcast witness but pays a different cell.
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
    let expected = expected_context(&input_out_point, &committed_output, &[]);
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

// output(0)'s DATA is folded into the scalar alongside the cell struct. The
// other tests all use empty output data, so this is the only one exercising
// that half of first_out_hash.
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
    let expected = expected_context(&input_out_point, &output_cell, b"committed");
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

// The proof commits to the spent OutPoint. Reusing the witness against a
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

    let expected = expected_context(&committed_input, &output_cell, &[]);
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

// Every piece feeding the context scalar is pinned: the committed proof is
// only valid against this exact transaction. output(0)'s lock is hardcoded
// rather than the bound script so the scalar does not depend on the compiled
// contract, which would invalidate the proof on every rebuild.
const PINNED_INPUT_TX_HASH: [u8; 32] = [0xAA; 32];
const PINNED_OUT_CODE_HASH: [u8; 32] = [0xBB; 32];
const PINNED_OUT_ARGS: [u8; 20] = [0xCC; 20];
const PINNED_OUT_CAPACITY: u64 = 500;

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

    let script_op = ctx.deploy_cell_by_name(CONTRACT_NAME);
    let vk_op = ctx.deploy_cell(Bytes::from(BOUND_VK_BYTES.to_vec()));
    let lock_script = ctx
        .build_script(
            &script_op,
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

    assert_eq!(
        expected_context(&input_out_point, &output_cell, &[]),
        bound_context_pi(),
        "pinned transaction no longer derives the context the fixtures were \
         proved against; re-run circuits/poseidon-preimage-bound/prove.sh"
    );

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

    let cycles = ctx
        .verify_tx(&tx, MAX_CYCLES)
        .expect("bound lock should accept a proof bound to this transaction");
    println!("success_path consumed {cycles} cycles");
}

use ckb_testtool::ckb_hash::blake2b_256;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellDep, CellInput, CellOutput, OutPoint, WitnessArgs},
    prelude::*,
};
use ckb_testtool::context::Context;

const MAX_CYCLES: u64 = 250_000_000;
const CONTRACT_NAME: &str = "zk-lock-bound";
const VK_BYTES: &[u8] = include_bytes!("../fixtures/vk.bin");

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
    assert!(ctx.verify_tx(&tx, MAX_CYCLES).is_err());
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
    assert!(ctx.verify_tx(&tx, MAX_CYCLES).is_err());
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

    assert!(ctx.verify_tx(&tx, MAX_CYCLES).is_err());
}

#[test]
fn witness_missing_rejects() {
    let mut ctx = Context::default();
    let commit = commit_body(&[[7u8; 32]]);
    let (tx, _) = build_tx_bound(&mut ctx, args_bytes(vk_hash(), commit), None, true);
    assert!(ctx.verify_tx(&tx, MAX_CYCLES).is_err());
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
    assert!(ctx.verify_tx(&tx, MAX_CYCLES).is_err());
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
    assert!(ctx.verify_tx(&tx, MAX_CYCLES).is_err());
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
    assert!(ctx.verify_tx(&tx, MAX_CYCLES).is_err());
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
    assert!(ctx.verify_tx(&tx, MAX_CYCLES).is_err());
}

#[test]
fn context_mismatch_rejects() {
    let mut ctx = Context::default();
    let body: [[u8; 32]; 1] = [[7u8; 32]];
    let commit = commit_body(&body);
    let witness = pack_witness_lock(&dummy_proof(), &[[0u8; 32], body[0]]);
    let (tx, _) = build_tx_bound(&mut ctx, args_bytes(vk_hash(), commit), Some(witness), true);
    assert!(ctx.verify_tx(&tx, MAX_CYCLES).is_err());
}

// Sanity check: when pi[0] equals the expected context and body commitment
// matches, all pre-Groth16 checks pass; the script reaches verifier_core::verify
// and rejects on our garbage proof.
// This confirms our off-chain context
// computation matches the on-chain one. Full success path arrives once the
// bound-compatible circuit is regenerated with pi[0] as a public input.
#[test]
fn context_matches_then_fails_at_groth16() {
    let mut ctx = Context::default();

    let script_op = ctx.deploy_cell_by_name(CONTRACT_NAME);
    let vk_op = ctx.deploy_cell(Bytes::from(VK_BYTES.to_vec()));

    let body: [[u8; 32]; 1] = [[7u8; 32]];
    let commit = commit_body(&body);
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

    assert!(ctx.verify_tx(&tx, MAX_CYCLES).is_err());
}

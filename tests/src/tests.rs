use ckb_testtool::ckb_hash::blake2b_256;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellDep, CellInput, CellOutput, WitnessArgs},
    prelude::*,
};
use ckb_testtool::context::Context;

const MAX_CYCLES: u64 = 250_000_000;

const VK_BYTES: &[u8] = include_bytes!("../fixtures/vk.bin");
const PROOF_BYTES: &[u8] = include_bytes!("../fixtures/proof.bin");
const PI_BYTES: &[u8] = include_bytes!("../fixtures/public_inputs.bin");

fn vk_hash() -> [u8; 32] {
    blake2b_256(VK_BYTES)
}

fn pi_commitment() -> [u8; 32] {
    blake2b_256(&PI_BYTES[4..])
}

fn valid_args() -> Bytes {
    let mut buf = Vec::with_capacity(64);
    buf.extend_from_slice(&vk_hash());
    buf.extend_from_slice(&pi_commitment());
    Bytes::from(buf)
}

fn valid_witness_lock() -> Bytes {
    let mut buf = Vec::with_capacity(PROOF_BYTES.len() + PI_BYTES.len());
    buf.extend_from_slice(PROOF_BYTES);
    buf.extend_from_slice(PI_BYTES);
    Bytes::from(buf)
}

fn build_tx(
    context: &mut Context,
    args: Bytes,
    witness_lock: Option<Bytes>,
    include_vk_cell_dep: bool,
) -> ckb_testtool::ckb_types::core::TransactionView {
    let script_op = context.deploy_cell_by_name("zk-lock");
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

    let outputs = vec![
        CellOutput::new_builder()
            .capacity(500u64)
            .lock(lock_script)
            .build(),
    ];
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

    context.complete_tx(builder.build())
}

#[test]
fn success_path() {
    let mut context = Context::default();
    let tx = build_tx(&mut context, valid_args(), Some(valid_witness_lock()), true);
    let cycles = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("valid Groth16 proof must verify");
    println!("verified at {} cycles", cycles);
}

#[test]
fn args_len_rejects() {
    let mut context = Context::default();
    let args = Bytes::from(vec![0u8; 63]);
    let tx = build_tx(&mut context, args, None, false);
    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}

#[test]
fn vkey_not_found_rejects() {
    let mut context = Context::default();
    let tx = build_tx(
        &mut context,
        valid_args(),
        Some(valid_witness_lock()),
        false,
    );
    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}

#[test]
fn witness_missing_rejects() {
    let mut context = Context::default();
    let tx = build_tx(&mut context, valid_args(), None, true);
    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}

#[test]
fn witness_lock_too_short_rejects() {
    let mut context = Context::default();
    let short = Bytes::from(vec![0u8; 100]);
    let tx = build_tx(&mut context, valid_args(), Some(short), true);
    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}

#[test]
fn pi_length_mismatch_rejects() {
    let mut context = Context::default();
    let mut buf = Vec::new();
    buf.extend_from_slice(PROOF_BYTES);
    buf.extend_from_slice(&99u32.to_le_bytes());
    buf.extend_from_slice(&[0u8; 32]);
    let tx = build_tx(&mut context, valid_args(), Some(Bytes::from(buf)), true);
    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}

#[test]
fn pi_commitment_mismatch_rejects() {
    let mut context = Context::default();
    let mut buf = Vec::new();
    buf.extend_from_slice(PROOF_BYTES);
    buf.extend_from_slice(&1u32.to_le_bytes());
    buf.extend_from_slice(&[0xFFu8; 32]);
    let tx = build_tx(&mut context, valid_args(), Some(Bytes::from(buf)), true);
    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}

#[test]
fn verification_failed_rejects() {
    let mut context = Context::default();
    let mut proof = PROOF_BYTES.to_vec();
    proof[0] ^= 0xFF;
    let mut buf = Vec::new();
    buf.extend_from_slice(&proof);
    buf.extend_from_slice(PI_BYTES);
    let tx = build_tx(&mut context, valid_args(), Some(Bytes::from(buf)), true);
    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}
#[test]
fn vkey_duplicate_rejects() {
    let mut context = Context::default();
    let script_op = context.deploy_cell_by_name("zk-lock");
    let lock_script = context
        .build_script(&script_op, valid_args())
        .expect("script");

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

    let outputs = vec![
        CellOutput::new_builder()
            .capacity(500u64)
            .lock(lock_script)
            .build(),
    ];
    let outputs_data = vec![Bytes::new(); outputs.len()];

    let witness_args = WitnessArgs::new_builder()
        .lock(Some(valid_witness_lock()).pack())
        .build();

    // Two cell_deps carrying the same vk bytes -> same data_hash -> duplicate.
    let vk_op_a = context.deploy_cell(Bytes::from(VK_BYTES.to_vec()));
    let vk_op_b = context.deploy_cell(Bytes::from(VK_BYTES.to_vec()));

    let tx = TransactionBuilder::default()
        .input(input)
        .outputs(outputs)
        .outputs_data(outputs_data.pack())
        .witness(witness_args.as_bytes().pack())
        .cell_dep(CellDep::new_builder().out_point(vk_op_a).build())
        .cell_dep(CellDep::new_builder().out_point(vk_op_b).build())
        .build();
    let tx = context.complete_tx(tx);

    assert!(context.verify_tx(&tx, MAX_CYCLES).is_err());
}

use ckb_testtool::ckb_hash::blake2b_256;
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellDep, CellInput, CellOutput, WitnessArgs},
    prelude::*,
};
use ckb_testtool::context::Context;

use crate::{
    E_ARGS_LENGTH, E_INVALID_PROOF, E_PI_COMMITMENT_MISMATCH, E_PUBLIC_INPUTS_LENGTH_MISMATCH,
    E_VKEY_DUPLICATED, E_VKEY_NOT_FOUND, E_WITNESS_LOCK_MISSING, E_WITNESS_LOCK_TOO_SHORT,
    MAX_CYCLES, assert_rejects_with,
};

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
    vk_cell_deps: usize,
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

    // Deploying the same bytes twice gives two cell deps with one data_hash,
    // which is what the duplicate-vk case needs.
    for _ in 0..vk_cell_deps {
        let vk_op = context.deploy_cell(Bytes::from(VK_BYTES.to_vec()));
        builder = builder.cell_dep(CellDep::new_builder().out_point(vk_op).build());
    }

    context.complete_tx(builder.build())
}

#[test]
fn success_path() {
    let mut context = Context::default();
    let tx = build_tx(&mut context, valid_args(), Some(valid_witness_lock()), 1);
    let cycles = context
        .verify_tx(&tx, MAX_CYCLES)
        .expect("valid Groth16 proof must verify");
    println!("verified at {} cycles", cycles);
}

#[test]
fn args_len_rejects() {
    let mut context = Context::default();
    let args = Bytes::from(vec![0u8; 63]);
    let tx = build_tx(&mut context, args, None, 0);
    assert_rejects_with(&context, &tx, E_ARGS_LENGTH);
}

#[test]
fn vkey_not_found_rejects() {
    let mut context = Context::default();
    let tx = build_tx(&mut context, valid_args(), Some(valid_witness_lock()), 0);
    assert_rejects_with(&context, &tx, E_VKEY_NOT_FOUND);
}

#[test]
fn witness_missing_rejects() {
    let mut context = Context::default();
    let tx = build_tx(&mut context, valid_args(), None, 1);
    assert_rejects_with(&context, &tx, E_WITNESS_LOCK_MISSING);
}

#[test]
fn witness_lock_too_short_rejects() {
    let mut context = Context::default();
    let short = Bytes::from(vec![0u8; 100]);
    let tx = build_tx(&mut context, valid_args(), Some(short), 1);
    assert_rejects_with(&context, &tx, E_WITNESS_LOCK_TOO_SHORT);
}

#[test]
fn pi_length_mismatch_rejects() {
    let mut context = Context::default();
    let mut buf = Vec::new();
    buf.extend_from_slice(PROOF_BYTES);
    buf.extend_from_slice(&99u32.to_le_bytes());
    buf.extend_from_slice(&[0u8; 32]);
    let tx = build_tx(&mut context, valid_args(), Some(Bytes::from(buf)), 1);
    assert_rejects_with(&context, &tx, E_PUBLIC_INPUTS_LENGTH_MISMATCH);
}

#[test]
fn pi_commitment_mismatch_rejects() {
    let mut context = Context::default();
    let mut buf = Vec::new();
    buf.extend_from_slice(PROOF_BYTES);
    buf.extend_from_slice(&1u32.to_le_bytes());
    buf.extend_from_slice(&[0xFFu8; 32]);
    let tx = build_tx(&mut context, valid_args(), Some(Bytes::from(buf)), 1);
    assert_rejects_with(&context, &tx, E_PI_COMMITMENT_MISMATCH);
}

// InvalidProof, not VerificationFailed: flipping a byte of pi_a changes x, and
// the result is almost never a point on the curve, so this is rejected while
// deserializing rather than at the pairing. Nothing here covers a well-formed
// proof that fails the pairing; that needs a second proving run to produce.
#[test]
fn malformed_proof_rejects() {
    let mut context = Context::default();
    let mut proof = PROOF_BYTES.to_vec();
    proof[0] ^= 0xFF;
    let mut buf = Vec::new();
    buf.extend_from_slice(&proof);
    buf.extend_from_slice(PI_BYTES);
    let tx = build_tx(&mut context, valid_args(), Some(Bytes::from(buf)), 1);
    assert_rejects_with(&context, &tx, E_INVALID_PROOF);
}

#[test]
fn vkey_duplicate_rejects() {
    let mut context = Context::default();
    let tx = build_tx(&mut context, valid_args(), Some(valid_witness_lock()), 2);
    assert_rejects_with(&context, &tx, E_VKEY_DUPLICATED);
}

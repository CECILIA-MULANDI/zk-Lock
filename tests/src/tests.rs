use ckb_testtool::ckb_types::{bytes::Bytes, core::TransactionBuilder, packed::*, prelude::*};
use ckb_testtool::context::Context;

// Include your tests here
// See https://github.com/xxuejie/ckb-native-build-sample/blob/main/tests/src/tests.rs for more examples

// generated unit test for contract zk-lock

const MAX_CYCLES: u64 = 10_000_000;

fn build_tx_with_args(
    context: &mut Context,
    args: Bytes,
    witness_lock: Option<Bytes>,
) -> ckb_testtool::ckb_types::core::TransactionView {
    let out_point = context.deploy_cell_by_name("zk-lock");
    let lock_script = context.build_script(&out_point, args).expect("script");

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
    let transaction = TransactionBuilder::default()
        .input(input)
        .outputs(outputs)
        .outputs_data(outputs_data.pack())
        .witness(witness_args.as_bytes().pack())
        .build();

    context.complete_tx(transaction)
}

fn valid_witness_lock(pi_count: u32, pi_bytes: &[u8]) -> Bytes {
    let mut buf = Vec::with_capacity(128 + 4 + pi_bytes.len());
    buf.extend_from_slice(&[0u8; 128]);
    buf.extend_from_slice(&pi_count.to_le_bytes());
    buf.extend_from_slice(pi_bytes);
    Bytes::from(buf)
}

#[test]
fn success_path() {
    let mut context = Context::default();
    let args = Bytes::from(vec![0u8; 64]);
    let witness_lock = valid_witness_lock(0, &[]);
    let transaction = build_tx_with_args(&mut context, args, Some(witness_lock));

    let cycles = context
        .verify_tx(&transaction, MAX_CYCLES)
        .expect("A well-formed witness MUST pass this shape check!!");
    println!("consume cycle: {}", cycles);
}

#[test]
fn args_len_rejects() {
    let mut context = Context::default();
    let args = Bytes::from(vec![0u8; 63]);
    let transaction = build_tx_with_args(&mut context, args, None);
    let res = context.verify_tx(&transaction, MAX_CYCLES);
    assert!(
        res.is_err(),
        "We expect that verification here will fail because args are 63-bytes"
    )
}
#[test]
fn witness_missing_rejects() {
    let mut context = Context::default();
    let args = Bytes::from(vec![0u8; 64]);
    let transaction = build_tx_with_args(&mut context, args, None);
    let res = context.verify_tx(&transaction, MAX_CYCLES);
    assert!(res.is_err(), "WitnessArgs.lock = None must fail");
}

#[test]
fn witness_lock_too_short_rejects() {
    let mut context = Context::default();
    let args = Bytes::from(vec![0u8; 64]);
    let witness_lock = Bytes::from(vec![0u8; 100]);
    let transaction = build_tx_with_args(&mut context, args, Some(witness_lock));
    let res = context.verify_tx(&transaction, MAX_CYCLES);
    assert!(res.is_err(), "witness lock under 132 bytes must fail");
}

#[test]
fn pi_length_mismatch_rejects() {
    let mut context = Context::default();
    let args = Bytes::from(vec![0u8; 64]);
    // says pi_count = 2 but only one 32-byte field element follows
    let witness_lock = valid_witness_lock(2, &[0u8; 32]);
    let transaction = build_tx_with_args(&mut context, args, Some(witness_lock));
    let res = context.verify_tx(&transaction, MAX_CYCLES);
    assert!(
        res.is_err(),
        "declared vs actual pi length mismatch must fail"
    );
}

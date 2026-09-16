use anyhow::{Context, Result};
use ckb_hash::blake2b_256;
use ckb_sdk::{CkbRpcClient, NetworkInfo};
use ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellDep, CellInput, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
};

const FEE_RATE_SHANNONS_PER_KB: u64 = 1_500;
const PROOF_LEN: usize = 128;

pub fn compute_context(
    cell: OutPoint,
    contract_dep: OutPoint,
    vk_dep: OutPoint,
    recipient: &Script,
    pi_bytes: &[u8],
) -> Result<[u8; 32]> {
    let network = NetworkInfo::testnet();
    let rpc = CkbRpcClient::new(network.url.as_str());

    let cell_json: ckb_jsonrpc_types::OutPoint = cell.clone().into();
    let live = rpc
        .get_live_cell(cell_json, false)
        .context("get_live_cell RPC failed")?;
    if live.status != "live" {
        anyhow::bail!("cell is not live: status = {}", live.status);
    }
    let input_info = live.cell.context("live cell has no info returned")?;
    let input_capacity: u64 = input_info.output.capacity.into();

    // Placeholder witness that size-matches what unlock-bound will submit.
    let mut witness_lock = Vec::with_capacity(PROOF_LEN + pi_bytes.len());
    witness_lock.extend_from_slice(&[0u8; PROOF_LEN]);
    witness_lock.extend_from_slice(pi_bytes);
    let witness_args = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(witness_lock)).pack())
        .build();

    let build_tx = |output_capacity: u64| {
        let input = CellInput::new_builder()
            .previous_output(cell.clone())
            .build();
        let capacity_packed: ckb_types::packed::Uint64 = output_capacity.pack();
        let output = CellOutput::new_builder()
            .capacity(capacity_packed)
            .lock(recipient.clone())
            .build();
        let contract_cell_dep = CellDep::new_builder()
            .out_point(contract_dep.clone())
            .build();
        let vk_cell_dep = CellDep::new_builder().out_point(vk_dep.clone()).build();
        TransactionBuilder::default()
            .input(input)
            .output(output)
            .output_data(Bytes::new().pack())
            .witness(witness_args.as_bytes().pack())
            .cell_dep(contract_cell_dep)
            .cell_dep(vk_cell_dep)
            .build()
    };

    let placeholder = build_tx(input_capacity);
    let tx_size_bytes = placeholder.data().as_slice().len() as u64;
    let fee = (tx_size_bytes * FEE_RATE_SHANNONS_PER_KB).div_ceil(1000);
    let output_capacity = input_capacity
        .checked_sub(fee)
        .context("cell capacity is too small to cover the computed fee")?;

    let capacity_packed: ckb_types::packed::Uint64 = output_capacity.pack();
    let output = CellOutput::new_builder()
        .capacity(capacity_packed)
        .lock(recipient.clone())
        .build();

    let first_out_hash = blake2b_256(output.as_slice());
    let mut ctx_buf = Vec::with_capacity(cell.as_slice().len() + 32);
    ctx_buf.extend_from_slice(cell.as_slice());
    ctx_buf.extend_from_slice(&first_out_hash);
    let expected = blake2b_256(&ctx_buf);

    let mut scalar = [0u8; 32];
    scalar[..31].copy_from_slice(&expected[..31]);
    Ok(scalar)
}

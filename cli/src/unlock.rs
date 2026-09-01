use anyhow::{Context, Result};
use ckb_sdk::{CkbRpcClient, NetworkInfo};
use ckb_types::{
    H256,
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellDep, CellInput, CellOutput, OutPoint, Script, WitnessArgs},
    prelude::*,
};
const FEE_SHANNONS: u64 = 1_000;
pub fn unlock(
    recipient: &Script,
    cell: OutPoint,
    contract_dep: OutPoint,
    vk_dep: OutPoint,
    proof: Vec<u8>,
    pi_bytes: Vec<u8>,
) -> Result<H256> {
    let network = NetworkInfo::testnet();
    let rpc = CkbRpcClient::new(network.url.as_str());

    let cell_json: ckb_jsonrpc_types::OutPoint = cell.clone().into();

    let live = rpc
        .get_live_cell(cell_json, false)
        .context("get_live_cell RPC failed")?;

    if live.status != "live" {
        anyhow::bail!("zk-lock cell is not live: status = {}", live.status);
    }

    let input_info = live.cell.context("live cell has no info returned")?;

    let input_capacity: u64 = input_info.output.capacity.into();

    let output_capacity = input_capacity
        .checked_sub(FEE_SHANNONS)
        .context("cell capacity is too small to cover the fee")?;

    let mut witness_lock = Vec::with_capacity(proof.len() + pi_bytes.len());
    witness_lock.extend_from_slice(&proof);
    witness_lock.extend_from_slice(&pi_bytes);

    let witness_args = WitnessArgs::new_builder()
        .lock(Some(Bytes::from(witness_lock)).pack())
        .build();

    // zk-lock cell we are spending
    let input = CellInput::new_builder().previous_output(cell).build();
    let capacity_packed: ckb_types::packed::Uint64 = output_capacity.pack();
    //Output thus capacity - fee --> this is what we send to recipient's lock
    let output = CellOutput::new_builder()
        .capacity(capacity_packed)
        .lock(recipient.clone())
        .build();

    let contract_cell_dep = CellDep::new_builder().out_point(contract_dep).build();
    let vk_cell_dep = CellDep::new_builder().out_point(vk_dep).build();

    let tx = TransactionBuilder::default()
        .input(input)
        .output(output)
        .output_data(Bytes::new().pack())
        .witness(witness_args.as_bytes().pack())
        .cell_dep(contract_cell_dep)
        .cell_dep(vk_cell_dep)
        .build();
    let json_tx = ckb_jsonrpc_types::TransactionView::from(tx);
    let tx_hash = rpc
        .send_transaction(json_tx.inner, None)
        .context("send_transaction failed")?;

    Ok(tx_hash)
}

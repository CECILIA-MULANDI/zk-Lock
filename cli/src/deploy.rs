use anyhow::{Context, Result};
use ckb_sdk::{
    Address, AddressPayload, CkbRpcClient, NetworkInfo, NetworkType, ScriptId,
    constants::TYPE_ID_CODE_HASH,
    transaction::{
        TransactionBuilderConfiguration,
        builder::{CkbTransactionBuilder, SimpleTransactionBuilder},
        input::InputIterator,
        signer::{SignContexts, TransactionSigner},
    },
};
use ckb_types::{
    H256,
    core::Capacity,
    packed::{CellOutput, Script},
    prelude::*,
};
use secp256k1::SecretKey;
/// Deploy an arbitrary byte blob as a data cell locked by the `sender`
/// Set `with_type_id = true` for upgradeable code cells/contracts
/// false for immutable data like vkey bytes
/// Returns (tx_hash, output_index_of_new_cell)
pub fn deploy_data(
    sk: &SecretKey,
    sender: &Script,
    data: Vec<u8>,
    with_type_id: bool,
) -> anyhow::Result<(H256, u32)> {
    // Network config i.e bundle rpc url + genesis cell deps
    let network = NetworkInfo::testnet();
    let cfg = TransactionBuilderConfiguration::new_with_network(network.clone())?;

    // Wrap the sender Script as ckb-sdk Address
    let deployer = Address::new(
        NetworkType::Testnet,
        AddressPayload::from(sender.clone()),
        true,
    );

    // Build the output cell
    let (output, output_data) = build_output_and_data(sender, &data, with_type_id)?;

    // Auto collect live cells from the deployer so as to fund the tx
    let iterator = InputIterator::new_with_address(&[deployer], &network);
    let mut builder = SimpleTransactionBuilder::new(cfg, iterator);
    builder.add_output_and_data(output, output_data);

    // We do the assembling here
    let mut tx_with_groups = builder.build(&Default::default())?;
    let outputs: Vec<CellOutput> = tx_with_groups.get_tx_view().outputs().into_iter().collect();
    if let Some(type_script) = outputs[0].type_().to_opt() {
        println!("code_hash (type): {:#x}", type_script.calc_script_hash());
    }
    // sign input grps with our secp key
    let pk_h256 =
        H256::from_slice(sk.as_ref()).context("secret key -> H256 conversion failed!!!")?;
    TransactionSigner::new(&network).sign_transaction(
        &mut tx_with_groups,
        &SignContexts::new_sighash_h256(vec![pk_h256])?,
    )?;

    let view = tx_with_groups.get_tx_view().clone();
    let json_tx = ckb_jsonrpc_types::TransactionView::from(view);
    let tx_hash = CkbRpcClient::new(network.url.as_str())
        .send_transaction(json_tx.inner, None)
        .context("send_transaction RPC failed!")?;

    Ok((tx_hash, 0))
}

fn build_output_and_data(
    sender: &Script,
    data: &[u8],
    with_type_id: bool,
) -> Result<(CellOutput, ckb_types::packed::Bytes)> {
    let data_capacity = Capacity::bytes(data.len())?;

    let type_script = if with_type_id {
        Some(ScriptId::new_type(TYPE_ID_CODE_HASH.clone()).dummy_type_id_script())
    } else {
        None
    };

    let dummy_output = CellOutput::new_builder()
        .lock(sender.clone())
        .type_(type_script.pack())
        .build();

    let capacity = dummy_output.occupied_capacity(data_capacity)?.pack();
    let output = dummy_output.as_builder().capacity(capacity).build();

    Ok((output, data.to_vec().pack()))
}

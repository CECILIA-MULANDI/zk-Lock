use anyhow::{Context, Result};
use ckb_sdk::{
    Address, AddressPayload, CkbRpcClient, NetworkInfo, NetworkType,
    transaction::{
        TransactionBuilderConfiguration,
        builder::{CkbTransactionBuilder, SimpleTransactionBuilder},
        input::InputIterator,
        signer::{SignContexts, TransactionSigner},
    },
};
use ckb_types::{
    H256,
    bytes::Bytes,
    core::ScriptHashType,
    packed::{Bytes as PackedBytes, CellOutput, Script},
    prelude::*,
};
use secp256k1::SecretKey;

/// Send `capacity_ckb` CKB into a new cell locked by zk-lock.
/// Returns (tx_hash, output_index_of_the_locked_cell).
pub fn lock(
    sk: &SecretKey,
    sender: &Script,
    code_hash: H256,
    vk_hash: [u8; 32],
    pi_commitment: [u8; 32],
    capacity_ckb: u64,
) -> Result<(H256, u32)> {
    let network = NetworkInfo::testnet();
    let cfg = TransactionBuilderConfiguration::new_with_network(network.clone())?;
    let deployer = Address::new(
        NetworkType::Testnet,
        AddressPayload::from(sender.clone()),
        true,
    );

    let mut args = Vec::with_capacity(64);
    args.extend_from_slice(&vk_hash);
    args.extend_from_slice(&pi_commitment);
    let hash_type: ckb_types::packed::Byte = ScriptHashType::Type.into();
    let zk_lock = Script::new_builder()
        .code_hash(code_hash.pack())
        .hash_type(hash_type)
        .args(Bytes::from(args).pack())
        .build();

    let capacity_shannons: u64 = capacity_ckb
        .checked_mul(100_000_000)
        .context("capacity overflow")?;
    let capacity_packed: ckb_types::packed::Uint64 = capacity_shannons.pack();
    let output = CellOutput::new_builder()
        .capacity(capacity_packed)
        .lock(zk_lock)
        .build();
    let output_data: PackedBytes = Bytes::new().pack();

    let iterator = InputIterator::new_with_address(&[deployer], &network);
    let mut builder = SimpleTransactionBuilder::new(cfg, iterator);
    builder.add_output_and_data(output, output_data);
    let mut tx_with_groups = builder.build(&Default::default())?;

    let pk_h256 = H256::from_slice(sk.as_ref()).context("secret key -> H256 conversion failed")?;
    TransactionSigner::new(&network).sign_transaction(
        &mut tx_with_groups,
        &SignContexts::new_sighash_h256(vec![pk_h256])?,
    )?;

    let view = tx_with_groups.get_tx_view().clone();
    let json_tx = ckb_jsonrpc_types::TransactionView::from(view);
    let tx_hash = CkbRpcClient::new(network.url.as_str())
        .send_transaction(json_tx.inner, None)
        .context("send_transaction failed")?;

    Ok((tx_hash, 0))
}

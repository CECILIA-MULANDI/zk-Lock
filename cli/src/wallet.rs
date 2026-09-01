use ckb_hash::blake2b_256;
use ckb_sdk::constants::SIGHASH_TYPE_HASH;
use ckb_types::{bytes::Bytes, core::ScriptHashType, packed::Script, prelude::*};
use secp256k1::{PublicKey, Secp256k1};
pub fn parse_privkey(input: &str) -> anyhow::Result<secp256k1::SecretKey> {
    let cleaned = input.trim().trim_start_matches("0x");
    let cleaned_bytes =
        hex::decode(cleaned).map_err(|e| anyhow::anyhow!("privkey not valid hex: {e}"))?;
    if cleaned_bytes.len() != 32 {
        anyhow::bail!("privkey must be 32 bytes. got {}", cleaned_bytes.len());
    }
    secp256k1::SecretKey::from_slice(&cleaned_bytes)
        .map_err(|e| anyhow::anyhow!("invalid secp256k1 key: {e}"))
}

pub fn sender_lock(sk: &secp256k1::SecretKey) -> Script {
    let secp = Secp256k1::new();
    let pubkey = PublicKey::from_secret_key(&secp, sk);
    let pubkey_bytes = pubkey.serialize();
    let hash = blake2b_256(pubkey_bytes);
    let blake160 = &hash[..20];
    let hash_type: ckb_types::packed::Byte = ScriptHashType::Type.into();
    Script::new_builder()
        .code_hash(SIGHASH_TYPE_HASH.pack())
        .hash_type(hash_type)
        .args(Bytes::from(blake160.to_vec()).pack())
        .build()
}

use anyhow::Context;

use clap::{Parser, Subcommand};
use std::path::PathBuf;
mod context;
mod deploy;
mod encode;
mod lock;
mod unlock;
mod wallet;
#[derive(Parser)]
#[command(name = "zk-lock", about = "CLI for the zk-lock CKB script")]
struct Cli {
    /// CKB's json-rpc endpoint
    #[arg(long, global = true, default_value = "https://testnet.ckb.dev/")]
    rpc: String,
    #[arg(long, global = true, env = "CKB_PRIVKEY")]
    privkey: Option<String>,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    DeployContract {
        binary: PathBuf,
    },

    DeployVk {
        vk: PathBuf,
    },
    /// Send ckb to a new locked cell(locked by zk-lock)
    Lock {
        code_hash: String,
        vk_hash: String,
        pi_commitment: String,
        capacity_ckb: u64,
    },
    /// Consume a zk-lock cell when you supply a Groth16 proof in the witness
    Unlock {
        cell: String,
        contract_dep: String,
        vk_dep: String,
        proof: PathBuf,
        public_inputs: PathBuf,
    },
    /// Same as `lock` but wired for the tx-context-bound zk-lock variant.
    LockBound {
        code_hash: String,
        vk_hash: String,
        pi_commitment: String,
        capacity_ckb: u64,
    },
    /// Same as `unlock` but for the bound variant. `--recipient` overrides self-spend.
    UnlockBound {
        cell: String,
        contract_dep: String,
        vk_dep: String,
        proof: PathBuf,
        public_inputs: PathBuf,
        #[arg(long)]
        recipient: Option<String>,
    },
    /// Compute the expected pi[0] context scalar for a bound-variant unlock.
    ContextHash {
        cell: String,
        contract_dep: String,
        vk_dep: String,
        public_inputs: PathBuf,
        #[arg(long)]
        recipient: Option<String>,
    },
    /// Prints blake2b_256(vk_bytes)
    HashVk {
        vk: PathBuf,
    },

    /// Prints blake2b_256(pi_bytes[4..])
    HashPi {
        public_inputs: PathBuf,
    },
    Verify {
        vk: PathBuf,
        proof: PathBuf,
        public_inputs: PathBuf,
    },
    /// Encode snarkjs vk.json
    EncodeVk {
        vk_json: PathBuf,
        out: PathBuf,
    },
    /// Encode snarkjs proof.json
    EncodeProof {
        proof_json: PathBuf,
        out: PathBuf,
    },
    /// Encode snarkjs public.json
    EncodePi {
        public_json: PathBuf,
        out: PathBuf,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    // Offline commands need no wallet.
    // NO NEED FOR CKB_PRIVKEY.
    match &cli.command {
        Command::Verify {
            vk,
            proof,
            public_inputs,
        } => {
            let vk_bytes = std::fs::read(vk).context("read vk file")?;
            let proof_bytes = std::fs::read(proof).context("read proof file")?;
            let pi_bytes = std::fs::read(public_inputs).context("read pi file")?;
            return match verifier_core::verify(&vk_bytes, &proof_bytes, &pi_bytes) {
                Ok(()) => {
                    println!("verified OK");
                    Ok(())
                }
                Err(e) => Err(anyhow::anyhow!("verify FAILED: {:?}", e)),
            };
        }
        Command::HashVk { vk } => {
            let data = std::fs::read(vk)?;
            let hash = ckb_hash::blake2b_256(&data);
            println!("vk_hash: 0x{}", hex::encode(hash));
            return Ok(());
        }
        Command::HashPi { public_inputs } => {
            let data = std::fs::read(public_inputs)?;
            if data.len() < 4 {
                anyhow::bail!("The pi file MUST have a 4-byte count prefix");
            }
            let hash = ckb_hash::blake2b_256(&data[4..]);
            println!("pi_commitment: 0x{}", hex::encode(hash));
            return Ok(());
        }
        Command::EncodeVk { vk_json, out } => {
            return encode::encode_vk(vk_json, out);
        }
        Command::EncodeProof { proof_json, out } => {
            return encode::encode_proof(proof_json, out);
        }
        Command::EncodePi { public_json, out } => {
            return encode::encode_public_inputs(public_json, out);
        }
        _ => {}
    }

    let pk_hex = cli
        .privkey
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("CKB_PRIVKEY not set"))?;
    let sk = wallet::parse_privkey(pk_hex)?;
    let sender = wallet::sender_lock(&sk);
    println!("sender lock hash: {:#x}", sender.calc_script_hash());

    match cli.command {
        Command::DeployContract { binary } => {
            let data = std::fs::read(&binary)?;
            let (tx, idx) = deploy::deploy_data(&sk, &sender, data, true)?;
            println!("contract deployed");
            println!("tx_hash:   {:#x}", tx);
            println!("out_point: {:#x}:{}", tx, idx);
        }
        Command::DeployVk { vk } => {
            let data = std::fs::read(&vk)?;
            let (tx, idx) = deploy::deploy_data(&sk, &sender, data, false)?;
            println!("vk deployed");
            println!("tx_hash:   {:#x}", tx);
            println!("out_point: {:#x}:{}", tx, idx);
        }
        Command::Lock {
            code_hash,
            vk_hash,
            pi_commitment,
            capacity_ckb,
        } => {
            let code_hash = parse_h256(&code_hash).context("code_hash")?;
            let vk_hash = parse_bytes32(&vk_hash).context("vk_hash")?;
            let pi_commitment = parse_bytes32(&pi_commitment).context("pi_commitment")?;
            let (tx, idx) = lock::lock(
                &sk,
                &sender,
                code_hash,
                vk_hash,
                pi_commitment,
                capacity_ckb,
            )?;
            println!("locked cell created");
            println!("tx_hash:   {:#x}", tx);
            println!("out_point: {:#x}:{}", tx, idx);
        }

        Command::Unlock {
            cell,
            contract_dep,
            vk_dep,
            proof,
            public_inputs,
        } => {
            let cell = parse_outpoint(&cell).context("cell")?;
            let contract_dep = parse_outpoint(&contract_dep).context("contract_dep")?;
            let vk_dep = parse_outpoint(&vk_dep).context("vk_dep")?;
            let proof_bytes = std::fs::read(&proof).context("read proof file")?;
            let pi_bytes = std::fs::read(&public_inputs).context("read pi file")?;

            let tx = unlock::unlock(&sender, cell, contract_dep, vk_dep, proof_bytes, pi_bytes)?;
            println!("unlocked");
            println!("tx_hash:   {:#x}", tx);
        }
        Command::LockBound {
            code_hash,
            vk_hash,
            pi_commitment,
            capacity_ckb,
        } => {
            let code_hash = parse_h256(&code_hash).context("code_hash")?;
            let vk_hash = parse_bytes32(&vk_hash).context("vk_hash")?;
            let pi_commitment = parse_bytes32(&pi_commitment).context("pi_commitment")?;
            let (tx, idx) = lock::lock(
                &sk,
                &sender,
                code_hash,
                vk_hash,
                pi_commitment,
                capacity_ckb,
            )?;
            println!("bound locked cell created");
            println!("tx_hash:   {:#x}", tx);
            println!("out_point: {:#x}:{}", tx, idx);
        }
        Command::UnlockBound {
            cell,
            contract_dep,
            vk_dep,
            proof,
            public_inputs,
            recipient,
        } => {
            let cell = parse_outpoint(&cell).context("cell")?;
            let contract_dep = parse_outpoint(&contract_dep).context("contract_dep")?;
            let vk_dep = parse_outpoint(&vk_dep).context("vk_dep")?;
            let recipient_script = parse_recipient(recipient.as_deref(), &sender)?;
            let proof_bytes = std::fs::read(&proof).context("read proof file")?;
            let pi_bytes = std::fs::read(&public_inputs).context("read pi file")?;

            let tx = unlock::unlock(
                &recipient_script,
                cell,
                contract_dep,
                vk_dep,
                proof_bytes,
                pi_bytes,
            )?;
            println!("bound unlocked");
            println!("tx_hash:   {:#x}", tx);
        }
        Command::ContextHash {
            cell,
            contract_dep,
            vk_dep,
            public_inputs,
            recipient,
        } => {
            let cell = parse_outpoint(&cell).context("cell")?;
            let contract_dep = parse_outpoint(&contract_dep).context("contract_dep")?;
            let vk_dep = parse_outpoint(&vk_dep).context("vk_dep")?;
            let recipient_script = parse_recipient(recipient.as_deref(), &sender)?;
            let pi_bytes = std::fs::read(&public_inputs).context("read pi file")?;

            let scalar = context::compute_context(
                cell,
                contract_dep,
                vk_dep,
                &recipient_script,
                &pi_bytes,
            )?;
            println!("context: 0x{}", hex::encode(scalar));
        }
        Command::HashVk { vk } => {
            let data = std::fs::read(&vk)?;
            let hash = ckb_hash::blake2b_256(&data);
            println!("vk_hash: 0x{}", hex::encode(hash));
        }
        Command::HashPi { public_inputs } => {
            let data = std::fs::read(&public_inputs)?;
            if data.len() < 4 {
                anyhow::bail!("The pi file MUST have a 4-byte count prefix");
            }
            let hash = ckb_hash::blake2b_256(&data[4..]);
            println!("pi_commitment: 0x{}", hex::encode(hash));
        }
        Command::Verify {
            vk,
            proof,
            public_inputs,
        } => {
            let vk_bytes = std::fs::read(&vk).context("read vk file")?;
            let proof_bytes = std::fs::read(&proof).context("read proof file")?;
            let pi_bytes = std::fs::read(&public_inputs).context("read pi file")?;
            match verifier_core::verify(&vk_bytes, &proof_bytes, &pi_bytes) {
                Ok(()) => println!("verified OK"),
                Err(e) => {
                    println!("verify FAILED: {:?}", e);
                    std::process::exit(1);
                }
            }
        }
        Command::EncodeVk { vk_json, out } => {
            return encode::encode_vk(&vk_json, &out);
        }
        Command::EncodeProof { proof_json, out } => {
            return encode::encode_proof(&proof_json, &out);
        }
        Command::EncodePi { public_json, out } => {
            return encode::encode_public_inputs(&public_json, &out);
        }
    }

    Ok(())
}

// helpers
fn parse_h256(s: &str) -> anyhow::Result<ckb_types::H256> {
    let clean = s.trim().trim_start_matches("0x");
    let bytes = hex::decode(clean)?;
    ckb_types::H256::from_slice(&bytes).map_err(Into::into)
}

fn parse_bytes32(s: &str) -> anyhow::Result<[u8; 32]> {
    let clean = s.trim().trim_start_matches("0x");
    let bytes = hex::decode(clean)?;
    if bytes.len() != 32 {
        anyhow::bail!("must be 32 bytes, got {}", bytes.len());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}
fn parse_outpoint(s: &str) -> anyhow::Result<ckb_types::packed::OutPoint> {
    use ckb_types::prelude::*;
    let (tx_hash, idx) = s
        .split_once(':')
        .ok_or_else(|| anyhow::anyhow!("outpoint must be tx_hash:index, got {}", s))?;
    let tx_hash = parse_h256(tx_hash)?;
    let idx: u32 = idx.parse().context("outpoint index must be a u32")?;
    let idx_packed: ckb_types::packed::Uint32 = idx.pack();
    Ok(ckb_types::packed::OutPoint::new_builder()
        .tx_hash(tx_hash.pack())
        .index(idx_packed)
        .build())
}

fn parse_recipient(
    s: Option<&str>,
    sender: &ckb_types::packed::Script,
) -> anyhow::Result<ckb_types::packed::Script> {
    use std::str::FromStr;
    match s {
        None => Ok(sender.clone()),
        Some(addr_str) => {
            let addr = ckb_sdk::Address::from_str(addr_str)
                .map_err(|e| anyhow::anyhow!("invalid recipient address: {}", e))?;
            Ok((&addr).into())
        }
    }
}

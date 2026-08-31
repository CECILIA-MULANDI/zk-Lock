use anyhow::Context;

use clap::{Parser, Subcommand};
use std::path::PathBuf;
mod deploy;
mod lock;
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
        vk_dep: String,
        proof: PathBuf,
        public_inputs: PathBuf,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
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
            vk_dep,
            proof,
            public_inputs,
        } => {
            println!(
                "unlock on {} cell={} vk_dep={} proof={:?} pi={:?}",
                cli.rpc, cell, vk_dep, proof, public_inputs
            );
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

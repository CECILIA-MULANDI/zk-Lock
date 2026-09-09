use std::path::Path;

use anyhow::{Context, Result, bail};
use ark_bn254::{Fq, Fq2, Fr, G1Affine, G2Affine};
use ark_ff::PrimeField;
use ark_serialize::{CanonicalSerialize, Compress};
use num_bigint::BigUint;
use serde::Deserialize;

// This represents the Wire structs that match
// what the onchain verifier expects in the byte layout
// In the verifier-core I have done the deserialization of these same structs
#[derive(CanonicalSerialize)]
struct WireVk {
    alpha: G1Affine,
    beta: G2Affine,
    gamma: G2Affine,
    delta: G2Affine,
    ic: Vec<G1Affine>,
}

#[derive(CanonicalSerialize)]
struct WireProof {
    a: G1Affine,
    b: G2Affine,
    c: G1Affine,
}

// The shape that snarkjs json takes
#[derive(Deserialize)]
struct SnarkjsVk {
    protocol: String,
    curve: String,
    #[serde(rename = "nPublic")]
    n_public: usize,
    vk_alpha_1: [String; 3],
    vk_beta_2: [[String; 2]; 3],
    vk_gamma_2: [[String; 2]; 3],
    vk_delta_2: [[String; 2]; 3],
    #[serde(rename = "IC")]
    ic: Vec<[String; 3]>,
}

#[derive(Deserialize)]
struct SnarkjsProof {
    protocol: String,
    curve: String,
    pi_a: [String; 3],
    pi_b: [[String; 2]; 3],
    pi_c: [String; 3],
}

fn parse_fq(s: &str, field: &str) -> Result<Fq> {
    let big: BigUint = s.parse().with_context(|| format!("{field}: parse Fq"))?;
    Ok(Fq::from_le_bytes_mod_order(&big.to_bytes_le()))
}

fn parse_fr(s: &str, field: &str) -> Result<Fr> {
    let big: BigUint = s.parse().with_context(|| format!("{field}: parse Fr"))?;
    Ok(Fr::from_le_bytes_mod_order(&big.to_bytes_le()))
}

fn parse_g1(p: &[String; 3], where_: &str) -> Result<G1Affine> {
    if p[2] != "1" {
        bail!("{where_}: expected affine (z=1), got z={}", p[2]);
    }
    let x = parse_fq(&p[0], &format!("{where_}.x"))?;
    let y = parse_fq(&p[1], &format!("{where_}.y"))?;
    Ok(G1Affine::new_unchecked(x, y))
}

fn parse_g2(p: &[[String; 2]; 3], where_: &str) -> Result<G2Affine> {
    if p[2][0] != "1" || p[2][1] != "0" {
        bail!(
            "{where_}: expected affine (z=1+0u), got {}+{}u",
            p[2][0],
            p[2][1]
        );
    }
    let x_c0 = parse_fq(&p[0][0], &format!("{where_}.x.c0"))?;
    let x_c1 = parse_fq(&p[0][1], &format!("{where_}.x.c1"))?;
    let y_c0 = parse_fq(&p[1][0], &format!("{where_}.y.c0"))?;
    let y_c1 = parse_fq(&p[1][1], &format!("{where_}.y.c1"))?;
    Ok(G2Affine::new_unchecked(
        Fq2::new(x_c0, x_c1),
        Fq2::new(y_c0, y_c1),
    ))
}

fn assert_groth16_bn254(protocol: &str, curve: &str, where_: &str) -> Result<()> {
    if protocol != "groth16" {
        bail!("{where_}: protocol must be \"groth16\", got \"{protocol}\"");
    }
    if curve != "bn128" {
        bail!("{where_}: curve must be \"bn128\", got \"{curve}\"");
    }
    Ok(())
}

pub fn encode_vk(vk_json: &Path, out: &Path) -> Result<()> {
    let text = std::fs::read_to_string(vk_json).context("read vk.json")?;
    let vk: SnarkjsVk = serde_json::from_str(&text).context("parse vk.json")?;
    assert_groth16_bn254(&vk.protocol, &vk.curve, "vk")?;
    if vk.ic.len() != vk.n_public + 1 {
        bail!(
            "vk.IC length {} does not match nPublic+1 = {}",
            vk.ic.len(),
            vk.n_public + 1
        );
    }
    let wire = WireVk {
        alpha: parse_g1(&vk.vk_alpha_1, "vk.vk_alpha_1")?,
        beta: parse_g2(&vk.vk_beta_2, "vk.vk_beta_2")?,
        gamma: parse_g2(&vk.vk_gamma_2, "vk.vk_gamma_2")?,
        delta: parse_g2(&vk.vk_delta_2, "vk.vk_delta_2")?,
        ic: vk
            .ic
            .iter()
            .enumerate()
            .map(|(i, p)| parse_g1(p, &format!("vk.IC[{i}]")))
            .collect::<Result<_>>()?,
    };
    let mut bytes = Vec::with_capacity(wire.serialized_size(Compress::Yes));
    wire.serialize_compressed(&mut bytes)
        .map_err(|e| anyhow::anyhow!("serialize vk: {e}"))?;
    std::fs::write(out, &bytes).context("write vk.bin")?;
    println!("wrote {} bytes to {}", bytes.len(), out.display());
    Ok(())
}

pub fn encode_proof(proof_json: &Path, out: &Path) -> Result<()> {
    let text = std::fs::read_to_string(proof_json).context("read proof.json")?;
    let proof: SnarkjsProof = serde_json::from_str(&text).context("parse proof.json")?;
    assert_groth16_bn254(&proof.protocol, &proof.curve, "proof")?;
    let wire = WireProof {
        a: parse_g1(&proof.pi_a, "proof.pi_a")?,
        b: parse_g2(&proof.pi_b, "proof.pi_b")?,
        c: parse_g1(&proof.pi_c, "proof.pi_c")?,
    };
    let mut bytes = Vec::with_capacity(wire.serialized_size(Compress::Yes));
    wire.serialize_compressed(&mut bytes)
        .map_err(|e| anyhow::anyhow!("serialize proof: {e}"))?;
    std::fs::write(out, &bytes).context("write proof.bin")?;
    println!("wrote {} bytes to {}", bytes.len(), out.display());
    Ok(())
}

pub fn encode_public_inputs(public_json: &Path, out: &Path) -> Result<()> {
    let text = std::fs::read_to_string(public_json).context("read public.json")?;
    let signals: Vec<String> = serde_json::from_str(&text).context("parse public.json")?;
    let n: u32 = signals
        .len()
        .try_into()
        .context("public inputs count exceeds u32")?;
    let mut bytes = Vec::with_capacity(4 + signals.len() * 32);
    bytes.extend_from_slice(&n.to_le_bytes());
    for (i, s) in signals.iter().enumerate() {
        let fr = parse_fr(s, &format!("public[{i}]"))?;
        fr.serialize_compressed(&mut bytes)
            .map_err(|e| anyhow::anyhow!("serialize public[{i}]: {e}"))?;
    }
    std::fs::write(out, &bytes).context("write pi.bin")?;
    println!("wrote {} bytes to {}", bytes.len(), out.display());
    Ok(())
}

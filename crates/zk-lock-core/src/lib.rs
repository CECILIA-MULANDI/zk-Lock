#![cfg_attr(not(any(feature = "library", test)), no_std)]

//! The spend check shared by both zk-Lock scripts.
//!
//! zk-Lock is one lock with two binding modes, not two locks. Both modes read
//! the same `lock.args` (`vk_hash ‖ pi_commitment`, 64 bytes), find the
//! verifying key in a cell dep by data hash, parse the same `witness.lock`
//! (`proof(128) ‖ pi_count(u32 LE) ‖ pi_count × 32`), and finish with the same
//! Groth16 pairing check. They differ only in whether public input 0 is
//! reserved for a transaction-context scalar, which [`Binding`] selects.
//!
//! This crate exists so that difference is the *only* difference. The two
//! scripts previously held their own copies of the whole flow, which meant a
//! fix to the public-input parsing path had to be remembered twice. The
//! binaries in `contracts/` are now thin: they pick a [`Binding`], call
//! [`verify_spend`], and map the result to an exit code.

extern crate alloc;

mod error;
pub use error::Error;

use blake2b_ref::Blake2bBuilder;
use ckb_std::ckb_constants::Source;
use ckb_std::high_level::{
    QueryIter, load_cell_data, load_cell_data_hash, load_script, load_tx_hash, load_witness_args,
};

const PROOF_LEN: usize = 128;

/// Whether public input 0 is reserved for the transaction-context scalar.
///
/// This is a compile-time choice per script, not a runtime option a spender
/// can pick: each binary in `contracts/` passes one literal, and the two
/// deployed `code_hash`es are what commit a locked cell to a mode. A cell
/// cannot be downgraded from [`Transaction`](Binding::Transaction) to
/// [`None`](Binding::None) without changing its lock script, which changes
/// its address.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Binding {
    /// Every public input belongs to the circuit author, and `pi_commitment`
    /// in `lock.args` covers all of them. A valid proof spends the cell in any
    /// transaction, so witnesses are replayable by anyone who sees them.
    None,
    /// Public input 0 is the transaction-context scalar, checked here against
    /// the transaction doing the spending, and `pi_commitment` covers inputs
    /// `1..n` only. This is what stops mempool witness-copy and
    /// recipient-redirect attacks, at the cost of requiring the prover to know
    /// the spending transaction before proving.
    ///
    /// The scalar is `tx_hash`, so it covers every input, output, output data
    /// field and dep at once, leaving nothing for a spender to vary.
    Transaction,
}

/// Run the spend check for `binding`, returning the exit code's error on
/// failure.
///
/// The order of the checks is observable: a transaction that fails more than
/// one reports the first, and tooling matches on that code. Do not reorder.
pub fn verify_spend(binding: Binding) -> Result<(), Error> {
    let script = load_script()?;
    let args = script.args();
    let args_bytes = args.raw_data();

    if args_bytes.len() != 64 {
        return Err(Error::ArgsLength);
    }

    let mut vk_hash = [0u8; 32];
    vk_hash.copy_from_slice(&args_bytes[..32]);

    let mut pi_commitment = [0u8; 32];
    pi_commitment.copy_from_slice(&args_bytes[32..]);

    // Exactly one cell dep may carry the verifying key. Two deps with the same
    // data hash is rejected rather than resolved by position, so a transaction
    // cannot quietly point the script at a second copy.
    let mut vk_index: Option<usize> = None;
    for (i, hash) in QueryIter::new(load_cell_data_hash, Source::CellDep).enumerate() {
        if hash == vk_hash {
            if vk_index.is_some() {
                return Err(Error::VKeyDuplicated);
            }
            vk_index = Some(i);
        }
    }
    let vk_index = vk_index.ok_or(Error::VKeyNotFound)?;

    let vkey_bytes = load_cell_data(vk_index, Source::CellDep)?;

    let witness_args = load_witness_args(0, Source::GroupInput)?;
    let lock_bytes = witness_args
        .lock()
        .to_opt()
        .ok_or(Error::WitnessLockMissing)?;

    let witness_lock = lock_bytes.raw_data();
    if witness_lock.len() < PROOF_LEN + 4 {
        return Err(Error::WitnessLockTooShort);
    }
    let proof_bytes = &witness_lock[..PROOF_LEN];
    let pi_bytes = &witness_lock[PROOF_LEN..];

    let pi_count = u32::from_le_bytes(pi_bytes[..4].try_into().unwrap()) as usize;

    if pi_bytes.len() != 4 + pi_count * 32 {
        return Err(Error::PublicInputsLengthMismatch);
    }

    let pi_field_elements = &pi_bytes[4..];

    // Split off the context scalar before hashing, because `pi_commitment` is
    // a commitment to the circuit author's inputs and input 0 is not one of
    // them under `Binding::Transaction`.
    let (context_pi, body_pi) = match binding {
        Binding::None => (None, pi_field_elements),
        Binding::Transaction => {
            // `split_at(32)` below needs an element to split off.
            if pi_count == 0 {
                return Err(Error::PublicInputCountTooSmall);
            }
            let (context, body) = pi_field_elements.split_at(32);
            (Some(context), body)
        }
    };

    if ckb_blake2b_256(body_pi) != pi_commitment {
        return Err(Error::PiCommitmentMismatch);
    }

    if let Some(context_pi) = context_pi {
        check_tx_context(context_pi)?;
    }

    // The pairing check gets the whole public-input field, context scalar
    // included: the proof is only valid for the exact vector the prover used.
    verifier_core::verify(&vkey_bytes, proof_bytes, pi_bytes)?;
    Ok(())
}

/// Recompute the transaction-context scalar and compare it to the value the
/// proof committed to.
///
/// The scalar is `tx_hash` with its top byte cleared, which keeps the
/// little-endian value below the BN254 scalar modulus so neither side reduces.
///
/// `tx_hash` excludes the witnesses, and that is what keeps proving against it
/// non-circular: the proof lands in `witness.lock` without disturbing the value
/// it committed to.
fn check_tx_context(context_pi: &[u8]) -> Result<(), Error> {
    let tx_hash = load_tx_hash()?;

    let mut expected_scalar = [0u8; 32];
    expected_scalar[..31].copy_from_slice(&tx_hash[..31]);

    if context_pi != expected_scalar {
        return Err(Error::ContextMismatch);
    }
    Ok(())
}

fn ckb_blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut hasher = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

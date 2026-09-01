#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

#[cfg(any(feature = "library", test))]
extern crate alloc;

#[cfg(not(any(feature = "library", test)))]
ckb_std::entry!(program_entry);
#[cfg(not(any(feature = "library", test)))]
// By default, the following heap configuration is used:
// * 16KB fixed heap
// * 1.2MB(rounded up to be 16-byte aligned) dynamic heap
// * Minimal memory block in dynamic heap is 64 bytes
// For more details, please refer to ckb-std's default_alloc macro
// and the buddy-alloc alloc implementation.
ckb_std::default_alloc!(16384, 1258306, 64);
use blake2b_ref::Blake2bBuilder;
use ckb_std::ckb_constants::Source;
use ckb_std::high_level::{
    QueryIter, load_cell_data, load_cell_data_hash, load_script, load_witness_args,
};
#[path = "error.rs"]
mod error;
use error::Error;
const PROOF_LENGTH: usize = 128;
pub fn program_entry() -> i8 {
    match main() {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}
fn main() -> Result<(), Error> {
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
    if witness_lock.len() < PROOF_LENGTH + 4 {
        return Err(Error::WitnessLockTooShort);
    }
    let proof_bytes = &witness_lock[..PROOF_LENGTH];
    let pi_bytes = &witness_lock[PROOF_LENGTH..];

    let pi_count = u32::from_le_bytes(pi_bytes[..4].try_into().unwrap()) as usize;

    if pi_bytes.len() != 4 + pi_count * 32 {
        return Err(Error::PublicInputsLengthMismatch);
    }

    let pi_field_elements = &pi_bytes[4..];
    if ckb_blake2b_256(pi_field_elements) != pi_commitment {
        return Err(Error::PiCommitmentMismatch);
    }
    verifier_core::verify(&vkey_bytes, proof_bytes, pi_bytes)?;
    Ok(())
}

// Helper functions
fn ckb_blake2b_256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    let mut hasher = Blake2bBuilder::new(32)
        .personal(b"ckb-default-hash")
        .build();
    hasher.update(data);
    hasher.finalize(&mut out);
    out
}

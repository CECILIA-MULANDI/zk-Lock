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
use ckb_std::ckb_constants::Source;
use ckb_std::high_level::{load_script, load_witness_args};
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
    let _vk_hash = &args_bytes[..32];
    let _pi_commitment = &args_bytes[32..];

    let witness_args = load_witness_args(0, Source::GroupInput)?;
    let lock_bytes = witness_args
        .lock()
        .to_opt()
        .ok_or(Error::WitnessLockMissing)?;

    let witness_lock = lock_bytes.raw_data();
    if witness_lock.len() < PROOF_LENGTH + 4 {
        return Err(Error::WitnessLockTooShort);
    }
    let _proof_bytes = &witness_lock[..PROOF_LENGTH];
    let pi_bytes = &witness_lock[PROOF_LENGTH..];

    let pi_count = u32::from_le_bytes(pi_bytes[..4].try_into().unwrap()) as usize;

    if pi_bytes.len() != 4 + pi_count * 32 {
        return Err(Error::PublicInputsLengthMismatch);
    }

    let _pi_field_elements = &pi_bytes[4..];
    Ok(())
}

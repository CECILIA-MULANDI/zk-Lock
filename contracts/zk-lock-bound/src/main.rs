#![cfg_attr(not(any(feature = "library", test)), no_std)]
#![cfg_attr(not(test), no_main)]

//! The transaction-binding zk-Lock script: as the generic script, except that
//! public input 0 must equal a scalar derived from the spending transaction,
//! which stops mempool witness-copy and recipient-redirect attacks.
//!
//! The spend check itself lives in `zk-lock-core`, shared with
//! `contracts/zk-lock`. This binary only picks the binding mode.

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

use zk_lock_core::Binding;

pub fn program_entry() -> i8 {
    match zk_lock_core::verify_spend(Binding::Transaction) {
        Ok(()) => 0,
        Err(e) => e as i8,
    }
}

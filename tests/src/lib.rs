use ckb_testtool::{
    ckb_error::Error,
    ckb_types::{
        bytes::Bytes,
        core::{Cycle, TransactionView},
    },
    context::Context,
};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::str::FromStr;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_bound;

pub const MAX_CYCLES: u64 = 250_000_000;

/// Error discriminants from `crates/zk-lock-core/src/error.rs`.
///
/// Both test modules pin these rather than asserting a bare `is_err()`. A
/// transaction that is wrong in one way is usually wrong in several, so without
/// the code a test would still pass if the check it targets were deleted from
/// the script.
pub const E_ARGS_LENGTH: i8 = 10;
pub const E_WITNESS_LOCK_MISSING: i8 = 11;
pub const E_WITNESS_LOCK_TOO_SHORT: i8 = 12;
pub const E_PUBLIC_INPUTS_LENGTH_MISMATCH: i8 = 13;
pub const E_VKEY_NOT_FOUND: i8 = 14;
pub const E_PI_COMMITMENT_MISMATCH: i8 = 15;
pub const E_INVALID_PROOF: i8 = 17;
pub const E_VKEY_DUPLICATED: i8 = 21;
pub const E_CONTEXT_MISMATCH: i8 = 22;
pub const E_PUBLIC_INPUT_COUNT_TOO_SMALL: i8 = 23;

pub fn assert_rejects_with(ctx: &Context, tx: &TransactionView, code: i8) {
    let err = ctx
        .verify_tx(tx, MAX_CYCLES)
        .expect_err("script should have rejected this transaction")
        .to_string();
    assert!(
        err.contains(&format!("error code {code} ")),
        "expected error code {code}, got: {err}"
    );
}

// The exact same Loader code from capsule's template, except that
// now we use MODE as the environment variable
const TEST_ENV_VAR: &str = "MODE";

pub enum TestEnv {
    Debug,
    Release,
}

impl FromStr for TestEnv {
    type Err = &'static str;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "debug" => Ok(TestEnv::Debug),
            "release" => Ok(TestEnv::Release),
            _ => Err("no match"),
        }
    }
}

pub struct Loader(PathBuf);

impl Default for Loader {
    fn default() -> Self {
        let test_env = match env::var(TEST_ENV_VAR) {
            Ok(val) => val.parse().expect("test env"),
            Err(_) => TestEnv::Release,
        };
        Self::with_test_env(test_env)
    }
}

impl Loader {
    fn with_test_env(env: TestEnv) -> Self {
        let load_prefix = match env {
            TestEnv::Debug => "debug",
            TestEnv::Release => "release",
        };
        let mut base_path = match env::var("TOP") {
            Ok(val) => {
                let mut base_path: PathBuf = val.into();
                base_path.push("build");
                base_path
            }
            Err(_) => {
                let mut base_path = PathBuf::new();
                // cargo may use a different cwd when running tests, for example:
                // when running debug in vscode, it will use workspace root as cwd by default,
                // when running test by `cargo test`, it will use tests directory as cwd,
                // so we need a fallback path
                base_path.push("build");
                if !base_path.exists() {
                    base_path.pop();
                    base_path.push("..");
                    base_path.push("build");
                }
                base_path
            }
        };

        base_path.push(load_prefix);
        Loader(base_path)
    }

    pub fn load_binary(&self, name: &str) -> Bytes {
        let mut path = self.0.clone();
        path.push(name);
        let result = fs::read(&path);
        if result.is_err() {
            panic!("Binary {path:?} is missing!");
        }
        result.unwrap().into()
    }
}

// This helper method runs Context::verify_tx, but in case error happens,
// it also dumps current transaction to failed_txs folder.
pub fn verify_and_dump_failed_tx(
    context: &Context,
    tx: &TransactionView,
    max_cycles: u64,
) -> Result<Cycle, Error> {
    let result = context.verify_tx(tx, max_cycles);
    if result.is_err() {
        let mut path = env::current_dir().expect("current dir");
        path.push("failed_txs");
        std::fs::create_dir_all(&path).expect("create failed_txs dir");
        let mock_tx = context.dump_tx(tx).expect("dump failed tx");
        let json = serde_json::to_string_pretty(&mock_tx).expect("json");
        path.push(format!("0x{:x}.json", tx.hash()));
        println!("Failed tx written to {path:?}");
        std::fs::write(path, json).expect("write");
    }
    result
}

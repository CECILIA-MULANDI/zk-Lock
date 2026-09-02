# zk-Lock

A reusable CKB lock script that conditions cell spending on a valid Groth16 proof. Commit to a circuit's verifying key, lock CKB behind it, and unlock only by supplying a proof that satisfies the circuit.

## How it works

Each locked cell carries two 32-byte commitments in its `lock.args`: a hash of the verifying key and a hash of the public inputs. To spend the cell, a transaction must include:

- The verifying key bytes in a cell dep (its `data_hash` must match the vk commitment).
- The Groth16 proof and the raw public inputs in `witness.lock`.

The on-chain script re-checks the public inputs commitment, then verifies the proof against the vk and inputs. No secp signature is required; the proof is the sole authorization.

## Build

    make build
    cargo test

## CLI

The `cli` crate exposes deploy, hash, lock, and unlock subcommands. Set your private key for the shell session:

    export CKB_PRIVKEY=0x<your-hex>

Deploy the contract binary to a testnet:

    cargo run -p cli --release -- deploy-contract build/release/zk-lock

Deploy a verifying key:

    cargo run -p cli --release -- deploy-vk path/to/vk.bin

Compute the two commitments that `lock` requires:

    cargo run -p cli --release -- hash-vk path/to/vk.bin
    cargo run -p cli --release -- hash-pi path/to/public_inputs.bin

Lock CKB behind a circuit (capacity is in CKB, not shannons):

    cargo run -p cli --release -- lock <code_hash> <vk_hash> <pi_commitment> <capacity>

Unlock the cell by presenting the proof:

    cargo run -p cli --release -- unlock <cell> <contract_dep> <vk_dep> <proof> <public_inputs>

`<cell>`, `<contract_dep>`, and `<vk_dep>` are OutPoints in `tx_hash:index` form.

## Pudge testnet

If you want to reuse the deployed contract instead of running your own `deploy-contract`:

- Contract cell out_point: `0x7d80c7a2781328cc766497f9d67b036a4d1295bda9f1de0d329bf08afd0e06fb:0` ([explorer](https://pudge.explorer.nervos.org/transaction/0x7d80c7a2781328cc766497f9d67b036a4d1295bda9f1de0d329bf08afd0e06fb))
- Contract `code_hash` (type): `0x24172f2dc2ebd6634fe925a6f0beda7cfd4cdb9aab1214f2e1cbd3127ea1fa7b`
- Sample vk cell from `tests/fixtures/vk.bin`: `0xdd37e6f384e7e906b7107747811bd30e9483048aee1367c2302d1d16b3a4e1a5:0`

## Repository layout

- `contracts/zk-lock/`: the on-chain lock script.
- `cli/`: command-line tool for deploying, locking, and unlocking.
- `tests/`: integration tests over the built contract binary.
- `native-simulators/zk-lock-sim/`: native-target simulator for debugging.

# zk-Lock

A reusable CKB lock script that conditions cell spending on a valid Groth16 proof. Commit to a circuit's verifying key, lock CKB behind it, and unlock only by supplying a proof that satisfies the circuit.

**New here?** Follow the [end-to-end tutorial](docs/tutorial.md). It walks from a Circom circuit to a locked and unlocked Pudge testnet cell using the TypeScript SDK or the Rust CLI.

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

Encode snarkjs artifacts into the on-chain byte layout:

    cargo run -p cli --release -- encode-vk    path/to/vk.json     path/to/vk.bin
    cargo run -p cli --release -- encode-proof path/to/proof.json  path/to/proof.bin
    cargo run -p cli --release -- encode-pi    path/to/public.json path/to/pi.bin

Sanity-check the encoded bytes off-chain (runs the same deserializer and pairing check the on-chain script uses):

    cargo run -p cli --release -- verify path/to/vk.bin path/to/proof.bin path/to/pi.bin

Compute the two commitments that `lock` requires:

    cargo run -p cli --release -- hash-vk path/to/vk.bin
    cargo run -p cli --release -- hash-pi path/to/public_inputs.bin

Lock CKB behind a circuit (capacity is in CKB, not shannons):

    cargo run -p cli --release -- lock <code_hash> <vk_hash> <pi_commitment> <capacity>

Unlock the cell by presenting the proof:

    cargo run -p cli --release -- unlock <cell> <contract_dep> <vk_dep> <proof> <public_inputs>

`<cell>`, `<contract_dep>`, and `<vk_dep>` are OutPoints in `tx_hash:index` form.

## TypeScript SDK

`sdk/ts/` provides the same off-chain surface as a TypeScript package (`@zk-lock/sdk`, unpublished, used from the cloned repo). It exports `encodeVerifyingKey`, `encodeProof`, `encodePublicInputs`, `hashVk`, `hashPi`, `deployVk`, `lock`, and `unlock`. The tutorial's TypeScript path uses it end to end.

## Pudge testnet

If you want to reuse the deployed contract instead of running your own `deploy-contract`:

- Contract cell out_point: `0x7d80c7a2781328cc766497f9d67b036a4d1295bda9f1de0d329bf08afd0e06fb:0` ([explorer](https://pudge.explorer.nervos.org/transaction/0x7d80c7a2781328cc766497f9d67b036a4d1295bda9f1de0d329bf08afd0e06fb))
- Contract `code_hash` (type): `0x24172f2dc2ebd6634fe925a6f0beda7cfd4cdb9aab1214f2e1cbd3127ea1fa7b`
- Poseidon-preimage vk cell (used by the tutorial): `0x6c72cc8ad1746aa1a8bc86483cda5a579a9490241011ddaac38b400ff670a2e6:0`

Reference transactions built with the current SDK against the Poseidon-preimage circuit:

- Lock: [`0xfa4d3f1d5a67ea93aaadbd360a28e76794fcd207d05354e07c60c934f0265ef0`](https://pudge.explorer.nervos.org/transaction/0xfa4d3f1d5a67ea93aaadbd360a28e76794fcd207d05354e07c60c934f0265ef0)
- Unlock: [`0x7cc857323e8d41668378ea95c6f0abdbc9f84697ce11b63ae8e18f1529264d65`](https://pudge.explorer.nervos.org/transaction/0x7cc857323e8d41668378ea95c6f0abdbc9f84697ce11b63ae8e18f1529264d65)

## Repository layout

- `contracts/zk-lock/`: the on-chain lock script.
- `cli/`: command-line tool for encoding, deploying, locking, and unlocking.
- `sdk/ts/`: TypeScript SDK covering the same off-chain surface as the CLI.
- `circuits/poseidon-preimage/`: reproducible Circom circuit used by the tutorial.
- `docs/tutorial.md`: end-to-end walkthrough from circuit to unlocked cell.
- `tests/`: integration tests over the built contract binary.
- `native-simulators/zk-lock-sim/`: native-target simulator for debugging.

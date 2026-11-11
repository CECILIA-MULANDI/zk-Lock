# zk-Lock

[![ci](https://github.com/CECILIA-MULANDI/zk-Lock/actions/workflows/ci.yml/badge.svg)](https://github.com/CECILIA-MULANDI/zk-Lock/actions/workflows/ci.yml)
[![circuit-vk-hash](https://github.com/CECILIA-MULANDI/zk-Lock/actions/workflows/circuit-vk-hash.yml/badge.svg)](https://github.com/CECILIA-MULANDI/zk-Lock/actions/workflows/circuit-vk-hash.yml)

A reusable CKB lock script that conditions cell spending on a valid Groth16 proof. Commit to a circuit's verifying key, lock CKB behind it, and unlock only by supplying a proof that satisfies the circuit.

**Want to try it first?** Open the [live demo](https://zk-lock.vercel.app/). Type a secret word, watch your browser build the proof, and spend a real Pudge testnet cell with it. No wallet, no faucet, no install. Source in [web/](web/).

**Not a developer?** Read [zk-Lock explained without code](docs/explainer.md). It covers what this does and why it is useful, with no code and no CKB background assumed, and it is honest about the limits.

**New here and want to build?** Follow the [end-to-end tutorial](docs/tutorial.md). It walks from a Circom circuit to a locked and unlocked Pudge testnet cell using the TypeScript SDK or the Rust CLI.

## How it works

Each locked cell carries two 32-byte commitments in its `lock.args`: a hash of the verifying key and a hash of the public inputs. To spend the cell, a transaction must include:

- The verifying key bytes in a cell dep (its `data_hash` must match the vk commitment).
- The Groth16 proof and the raw public inputs in `witness.lock`.

The on-chain script re-checks the public inputs commitment, then verifies the proof against the vk and inputs. No secp signature is required; the proof is the sole authorization.

The byte layout of `witness.lock` and of the verifying key in cell data is specified in [docs/encoding-rationale.md](docs/encoding-rationale.md), which also covers why the encoding is flat and positional rather than Molecule, and which parts of that decision are still open.

The check above runs in two binding modes, not as two lock designs. `contracts/zk-lock/` and `contracts/zk-lock-bound/` are the same spend check from `crates/zk-lock-core/`, called with `Binding::None` and `Binding::Transaction`. Binding adds one check and removes none: it reserves the first public input for a transaction-context scalar and constrains it on chain, which stops mempool witness-copy and recipient-redirect attacks. Because the two modes need different circuits, a proof made for one is never accepted by the other. See [Section 11 of the tutorial](docs/tutorial.md#11-transaction-binding-recommended-for-production) for the end-to-end flow.

The scalar is `tx_hash` with its top byte cleared, so it covers every input, output, output data field and dep in one value. This is the same digest CKB's default lock signs, which means a bound zk-Lock spend authorises exactly the scope a signed spend does, and a circuit author has no layout convention to learn beyond "public input 0 is the transaction". An earlier revision hashed only the first group input and the first output, which left any additional same-group input outside the authorisation scope. A partial digest obliges an explicit cardinality rule, because a hash can pin the bytes of what it covers but cannot say "and nothing else". Widening the digest removed the hole and the rule together.

## Build

    make build
    cargo test

CI runs `cargo fmt --check`, `make build`, `make test`, and clippy with warnings denied, then builds, typechecks, and tests the SDK. A second workflow rebuilds both Circom circuits from source, re-encodes the verifying key, and fails if the hash no longer matches the value pinned in `expected_vk_hash.txt`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full local workflow, including coverage and reproducible builds.

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

Under transaction binding, use `lock-bound` / `unlock-bound` in place of `lock` / `unlock`, and derive the tx-context scalar with `context-hash` before re-proving:

    cargo run -p cli --release -- lock-bound   <code_hash> <vk_hash> <pi_commitment_body> <capacity>
    cargo run -p cli --release -- context-hash <cell> <contract_dep> <vk_dep> <public_inputs>
    cargo run -p cli --release -- unlock-bound <cell> <contract_dep> <vk_dep> <proof> <public_inputs>

## TypeScript SDK

`sdk/ts/` provides the same off-chain surface as a TypeScript package (`@zk-lock/sdk`, unpublished, used from the cloned repo). It exports `encodeVerifyingKey`, `encodeProof`, `encodePublicInputs`, `hashVk`, `hashPi`, `verify`, `deployVk`, `lock`, and `unlock` for the generic script, plus `boundContextScalar`, `lockBound`, `computeContextHash`, `unlockBound`, and the pure `planBoundUnlock` and `buildBoundUnlockTx` for the transaction-binding mode. `boundContextScalar` is the primitive: it takes any `ccc.Transaction` and returns the scalar to prove against, so an application is not limited to the one-input, one-output shape the convenience helpers build. `verify` runs the same deserializer the on-chain script uses plus a Groth16 pairing check locally, so a TypeScript-only user can pre-flight their bytes without touching the Rust CLI. The tutorial's TypeScript path uses it end to end.

## Pudge testnet

If you want to reuse the deployed contracts instead of running your own `deploy-contract`:

### Generic `zk-lock`

- Contract cell out_point: `0x7d80c7a2781328cc766497f9d67b036a4d1295bda9f1de0d329bf08afd0e06fb:0` ([explorer](https://pudge.explorer.nervos.org/transaction/0x7d80c7a2781328cc766497f9d67b036a4d1295bda9f1de0d329bf08afd0e06fb))
- Contract `code_hash` (type): `0x24172f2dc2ebd6634fe925a6f0beda7cfd4cdb9aab1214f2e1cbd3127ea1fa7b`
- Poseidon-preimage vk cell (used by the tutorial): `0x6c72cc8ad1746aa1a8bc86483cda5a579a9490241011ddaac38b400ff670a2e6:0`

Reference transactions built with the current SDK against the Poseidon-preimage circuit:

- Lock: [`0xfa4d3f1d5a67ea93aaadbd360a28e76794fcd207d05354e07c60c934f0265ef0`](https://pudge.explorer.nervos.org/transaction/0xfa4d3f1d5a67ea93aaadbd360a28e76794fcd207d05354e07c60c934f0265ef0)
- Unlock: [`0x7cc857323e8d41668378ea95c6f0abdbc9f84697ce11b63ae8e18f1529264d65`](https://pudge.explorer.nervos.org/transaction/0x7cc857323e8d41668378ea95c6f0abdbc9f84697ce11b63ae8e18f1529264d65)

### Transaction-binding `zk-lock-bound`

- Contract cell out_point: `0x5f21b4d1e6b8a7fa3d0e739fbc7b6d42e660d7e1ef02a857c6ab249f5b004011:0` ([explorer](https://pudge.explorer.nervos.org/transaction/0x5f21b4d1e6b8a7fa3d0e739fbc7b6d42e660d7e1ef02a857c6ab249f5b004011))
- Contract `code_hash` (type): `0xfbb4acb5c3f8fc8b24216dc8dc8d6bb8f8d3ea9aab4b29a210571959a1f9028e`
- Poseidon-preimage-bound vk cell (used by Section 11 of the tutorial): `0x90d0db44dc418db45e7cfe68cbc92ee5cfe79809f106df9879a8981d83d6d8c3:0`

Both cells are verifiable against this checkout. The contract cell's `data_hash` is `0x21f2173b72484484e5fb095e2f5d3b11b9379535cbfbd0e4f592d6244f191c2d`, which is `blake2b_256` of `build/release/zk-lock-bound`, and the vk cell's is `0x5773886c51273f909f1408e5822aeff6271aafaaa013e81ce84f83de2329f620`, the value pinned in `expected_vk_hash.txt`.

Reference transactions against the Poseidon-preimage-bound circuit, built with the Rust CLI:

- Lock: [`0x056725c96fc8bd7aaff016b36619e3a8f670aa856666b5344f3158dcd10c0659`](https://pudge.explorer.nervos.org/transaction/0x056725c96fc8bd7aaff016b36619e3a8f670aa856666b5344f3158dcd10c0659)
- Unlock: [`0x013b0946b00ac5db51da4342803b4c81f2460d72802852753b93f7b18b372f85`](https://pudge.explorer.nervos.org/transaction/0x013b0946b00ac5db51da4342803b4c81f2460d72802852753b93f7b18b372f85)

That unlock is worth reading closely, because the binding is visible in the hashes themselves. The context scalar the proof committed to was

```
0x013b0946b00ac5db51da4342803b4c81f2460d72802852753b93f7b18b372f00
```

and the transaction it was spent in hashes to

```
0x013b0946b00ac5db51da4342803b4c81f2460d72802852753b93f7b18b372f85
```

The same 31 bytes, differing only in the top byte the script clears. The proof was made for that transaction and no other.

The previous deployment at `0x9cf1e0a6...:0` is superseded. It derived its context scalar from the first group input and the first output rather than from `tx_hash`, so do not lock value behind it.

## Repository layout

- `crates/zk-lock-core/`: the spend check both scripts run, and the error codes they share.
- `contracts/zk-lock/`: on-chain binary for the generic mode.
- `contracts/zk-lock-bound/`: on-chain binary for the transaction-binding mode.
- `cli/`: command-line tool for encoding, deploying, locking, and unlocking.
- `sdk/ts/`: TypeScript SDK covering the same off-chain surface as the CLI.
- `circuits/poseidon-preimage/`: reproducible Circom circuit used by the tutorial.
- `circuits/poseidon-preimage-bound/`: the same circuit with a reserved context input, required by the transaction-binding mode.
- `docs/tutorial.md`: end-to-end walkthrough from circuit to unlocked cell.
- `docs/encoding-rationale.md`: the witness and vk byte layout, and the reasoning behind it.
- `tests/`: integration tests over the built contract binary.
- `native-simulators/zk-lock-sim/`: native-target simulator for the generic script.
- `native-simulators/zk-lock-bound-sim/`: native-target simulator for the bound script.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the build, test, and pull request workflow.

## License

Dual-licensed under either of

- Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE))
- MIT License ([LICENSE-MIT](LICENSE-MIT))

at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in this project by you shall be dual-licensed as above, without
any additional terms or conditions.

# Contributing to zk-Lock

zk-Lock is a reusable CKB lock script that conditions cell spending on a valid Groth16 proof. All contributions are welcome. Feel free to discuss, suggest and open issues.

Questions, suggestions and bug reports are all welcome as issues; there is no separate discussion forum. I file issues as work surfaces, so the tracker will fill out as the project moves, and anything self-contained enough to pick up cold gets labelled `good first issue`. If nothing open fits and you want somewhere concrete to start, say so in an issue and I will point you at something.

## What is in here

| Path                       | What it is                                                                     |
| -------------------------- | ------------------------------------------------------------------------------ |
| `contracts/zk-lock/`       | The generic on-chain lock script                                               |
| `contracts/zk-lock-bound/` | Transaction-binding sibling; reserves `pi[0]` for a transaction-context scalar |
| `native-simulators/`       | Native-target simulators for both scripts, used by the test suite              |
| `tests/`                   | Integration tests against both scripts                                         |
| `cli/`                     | Rust CLI: encode snarkjs artifacts, hash, deploy, lock, unlock                 |
| `sdk/ts/`                  | TypeScript SDK (`@zk-lock/sdk`) built on CCC                                   |
| `circuits/`                | Reproducible Circom circuits with pinned ptau                                  |
| `docs/`                    | End-to-end tutorial, and design notes as they get written                      |

## Setting up

You need a stable Rust toolchain and clang 16 or newer. `rust-toolchain.toml` pins the channel and the `riscv64imac-unknown-none-elf` target, so rustup installs both the first time you build. The contracts use edition 2024, which needs Rust 1.85 or newer.

Clang is needed because `ckb-std` compiles the CKB C standard library from source; there is no C in this repository. `scripts/find_clang` locates it. If it cannot find yours, pass it explicitly:

    make build CLANG=/path/to/clang

`make prepare` runs `rustup target add` for the RISC-V target. It is a no-op if rustup already honoured `rust-toolchain.toml`.

## Building and testing

    make build
    make test

`make build` cleans `build/$(MODE)` first, builds each contract for RISC-V, then builds the native simulators. `make test` is a plain `cargo test`. There are also `make check`, `make clippy` and `make fmt`, which wrap the matching cargo commands over the workspace.

To build one contract instead of all of them:

    make build CONTRACT=zk-lock

Coverage runs through the native simulators and needs `llvm-tools-preview`:

    make coverage-install
    make coverage          # text report
    make coverage-html     # HTML report

For reproducible-build checks:

    make checksum          # writes build/checksums-release.txt

## The TypeScript SDK

    cd sdk/ts
    npm ci
    npm run build
    npm test               # vitest
    npm run typecheck

Node 20 or newer. `npm run e2e` runs the end-to-end Pudge script and needs a funded testnet key, so it is not part of the normal test run.

## Circuits

Each circuit under `circuits/` is self-contained, with its own `package.json`, a `build.sh` that pins the ptau file by hash, and an `expected_vk_hash.txt`. The `circuit-vk-hash.yml` workflow rebuilds every circuit on each push and pull request and fails if the resulting `vk_hash` does not match the pinned value. That is deliberate: the on-chain verifying key cell has to stay reproducible from source.

If you change a circuit, the vk_hash will change. Rebuild it, update `expected_vk_hash.txt`, and say so in the pull request, because it means any deployed verifying key cell for that circuit is now stale.

## Adding your own circuit

The tutorial at [docs/tutorial.md](docs/tutorial.md) walks the whole path from a Circom circuit to an unlocked cell on Pudge testnet, in both TypeScript and Rust. Start there rather than from the source. If you follow it and something does not work, that is a bug worth filing, and the tutorial itself is the thing being tested.

## Pull requests

- Keep `make build && make test` green locally. CI currently runs only the circuit vk_hash job, so nothing checks the build or the test suite for you yet.
- One concern per pull request. The witness layout, the CLI and the SDK can usually move independently.
- Anything that changes the witness byte layout is a breaking change. It means a new contract binary, a fresh testnet deployment, new reference transactions, and updates to the tutorial and the SDK. Say so explicitly, because the README pins the currently deployed contract cells.
- Negative tests are as welcome as features. If you can make a script accept something it should reject, that is the most useful contribution there is.

## Design decisions

Some choices in here have reasons that are not obvious from the source, and I write those up in `docs/` as they come up. If you disagree with one, open an issue rather than a pull request first, so the reasoning ends up written down where the next person finds it.

Design notes that came out of review from outside the project are credited to whoever raised the question. If your review changes the code or the reasoning, you get the same.

## License

zk-Lock is dual-licensed under either the MIT License or the Apache License 2.0, at your option. See [LICENSE-MIT](LICENSE-MIT) and [LICENSE-APACHE](LICENSE-APACHE).

By contributing, you agree that your contributions are licensed under those same terms, as described in Apache License 2.0 section 5. You keep the copyright on what you wrote; the license is what lets the project ship it.

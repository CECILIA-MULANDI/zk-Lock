# zk-Lock

A reusable CKB lock script that conditions cell spending on a valid Groth16 proof. Commit to a Circom circuit's verifying key, lock CKB behind it, and spend only by supplying a proof that satisfies the circuit.

## Status

- M1: lock script core, local tests pass

## Build

    make build
    cargo test

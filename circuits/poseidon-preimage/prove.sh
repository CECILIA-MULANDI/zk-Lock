#!/usr/bin/env bash
set -eou pipefail

BUILD_DIR="build"
INPUT_FILE="input.json"

echo "Computing the witness....."
npx snarkjs wtns calculate \
    "${BUILD_DIR}/circuit_js/circuit.wasm" \
    "${INPUT_FILE}" \
    "${BUILD_DIR}/witness.wtns"


echo "Generating proof...."
npx snarkjs groth16 prove \
    "${BUILD_DIR}/circuit_0000.zkey" \
    "${BUILD_DIR}/witness.wtns" \
    "${BUILD_DIR}/proof.json" \
    "${BUILD_DIR}/public.json"
echo "Verifying proof off-chain..."
npx snarkjs groth16 verify \
    "${BUILD_DIR}/vk.json" \
    "${BUILD_DIR}/public.json" \
    "${BUILD_DIR}/proof.json"

echo ""
echo "Done. Proof artifacts:"
ls -1 "${BUILD_DIR}/proof.json" "${BUILD_DIR}/public.json"
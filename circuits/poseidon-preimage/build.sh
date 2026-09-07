#!/usr/bin/env bash
set -euo pipefail

# Reproducible build for the zk-Lock Poseidon preimage tutorial circuit
BUILD_DIR="build"
PTAU_FILE="ptau/powersOfTau28_hez_final_12.ptau"

# Canonical blake2b-512 hash of the Hermez pot12 file, per the snarkjs README.
# Verifying on every build catches any accidental corruption or tampering of
# the committed ptau before it can produce a bad zkey.
PTAU_EXPECTED_HASH="ded2694169b7b08e898f736d5de95af87c3f1a64594013351b1a796dbee393bd825f88f9468c84505ddd11eb0b1465ac9b43b9064aa8ec97f2b73e04758b8a4a"



mkdir -p "${BUILD_DIR}"

echo "Verifying ${PTAU_FILE}..."
actual_hash=$(b2sum "${PTAU_FILE}" | awk '{print $1}')
if [ "${actual_hash}" != "${PTAU_EXPECTED_HASH}" ]; then
    echo "ERROR: ${PTAU_FILE} hash mismatch"
    echo "  expected: ${PTAU_EXPECTED_HASH}"
    echo "  actual:   ${actual_hash}"
    exit 1
fi

# Compile the circom src

echo "Compiling the circuit.circom..."
circom circuit.circom \
    --r1cs \
    --wasm \
    --sym \
    -l node_modules \
    -o "${BUILD_DIR}"


# Do the groth16 setup
# r1cs + ptau -----> zkey
# Here I did skip the MPC contribution for the purposes of this tutorial
# I use the initial zkey directly
# NOTE: IN PROD WE MUST RUN A PROPER CEREMONY WITH MULTIPLE INDEPENDT CONTRIBUTORS

echo "Running Groth16 setup..."
npx snarkjs groth16 setup \
    "${BUILD_DIR}/circuit.r1cs" \
    "${PTAU_FILE}" \
    "${BUILD_DIR}/circuit_0000.zkey" 


# Export the vkey as a JSON
echo "Exporting the vk.json...."
npx snarkjs zkey export verificationkey \
    "${BUILD_DIR}/circuit_0000.zkey" \
    "${BUILD_DIR}/vk.json"


echo ""
echo "Done. Artifacts:"
ls -1 "${BUILD_DIR}"
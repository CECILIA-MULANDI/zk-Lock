pragma circom 2.2.1;
include "circomlib/circuits/poseidon.circom";

template PoseidonPreimageBound() {
    signal input context;
    signal input digest;
    signal input preimage;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== preimage;
    hasher.out === digest;

    // The lock script checks `context`, so this circuit has no condition to
    // impose on it. It still has to appear in some constraint: a public input
    // used nowhere can get a zero IC point from the setup, and the pairing
    // check would then accept any value in that slot. snarkjs happens to pad
    // the QAP and bind it anyway; this states it instead.
    signal ctxSq;
    ctxSq <== context * context;
}

component main {public [context, digest]} = PoseidonPreimageBound();

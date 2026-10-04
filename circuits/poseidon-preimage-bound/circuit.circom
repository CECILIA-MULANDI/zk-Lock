pragma circom 2.2.1;
include "circomlib/circuits/poseidon.circom";

template PoseidonPreimageBound() {
    signal input context;
    signal input digest;
    signal input preimage;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== preimage;
    hasher.out === digest;
}

component main {public [context, digest]} = PoseidonPreimageBound();

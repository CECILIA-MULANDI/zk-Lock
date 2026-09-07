pragma circom 2.2.1;

include "circomlib/circuits/poseidon.circom";

template PoseidonPreimage() {
    signal input preimage;
    signal output digest;

    component hasher = Poseidon(1);
    hasher.inputs[0] <== preimage;
    digest <== hasher.out;
}

component main = PoseidonPreimage();

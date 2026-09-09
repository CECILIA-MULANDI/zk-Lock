# How to lock a cell behind your own Circom circuit

## 1. What you'll build

zk-Lock is a CKB lock script that spends a cell only when the spender presents a valid Groth16 proof against a committed verifying key and a committed set of public inputs.

This tutorial walks the full flow end to end. The example circuit is a Poseidon preimage: it proves "I know a value `x` such that `Poseidon(x)` equals a public digest," without revealing `x`. Locking CKB behind this circuit means anyone who knows `x` can spend the cell; anyone else provably cannot.

By the end you will have locked and unlocked a cell on Pudge testnet, with published tx hashes to confirm.

You can follow the tutorial with either the TypeScript SDK or the Rust CLI. Both live in this repository and are used from the cloned checkout. Neither is published to npm or crates.io yet. The first half is shared: compiling the circuit, generating a proof, and encoding the artifacts into the on-chain byte format. The second half forks into two parallel paths, one per language, covering the three on-chain transactions. Pick whichever you prefer.

## 2. Prerequisites

Toolchain:

- Node.js 22.x
- circom 2.2.x. Install via `cargo install --git https://github.com/iden3/circom.git --tag v2.2.1`, or grab a release binary from the [circom releases page](https://github.com/iden3/circom/releases) and put it on your PATH.
- `b2sum` (GNU coreutils; preinstalled on most Linux distros, `brew install coreutils` on macOS).
- Rust toolchain (only if you plan to follow the CLI path in Section 6B onward).

CKB:

- A Pudge testnet address funded with at least 300 CKB. Request testnet CKB from the [Nervos faucet](https://faucet.nervos.org/).
- The private key for that address should be exported as an environment variable:

  ```
  export CKB_PRIVKEY=0x<your-64-hex-private-key>
  ```

Repository:

- Clone the zk-Lock repository and enter it:

  ```
  git clone https://github.com/CECILIA-MULANDI/zk-lock-official.git
  cd zk-lock-official
  ```

You will not need to install `snarkjs` globally. It is picked up from the circuit package's `devDependencies` in the next section.

## 3. Compile the circuit and run trusted setup

The Poseidon-preimage circuit lives at `circuits/poseidon-preimage/`. Compile it and run a Groth16 setup:

```
cd circuits/poseidon-preimage
npm install
npm run build
```

`npm run build` runs `build.sh`, which:

1. Verifies the pinned pot12 ptau file by comparing its blake2b-512 hash against a hard-coded expected value. If the ptau has been tampered with or corrupted, the build fails here.
2. Compiles `circuit.circom` with `circom --r1cs --wasm --sym`.
3. Runs `snarkjs groth16 setup` against the pot12 ptau to produce a zkey.
4. Exports the verifying key as JSON.

Expected artifacts under `build/`:

```
circuit.r1cs
circuit.sym
circuit_0000.zkey
circuit_js/circuit.wasm
vk.json
```

`vk.json` is the verifying key you will later commit to a CKB cell as `vk_hash`. It is deterministic given the pinned circom, snarkjs, circomlib, and ptau versions in `package.json`, so every reader who runs this step will get the same `vk_hash`. A CI job pins the expected hash to catch drift.

> **On the trusted setup.** `build.sh` uses the initial zkey directly without an MPC contribution round. That is fine for this tutorial because the zkey's secret trapdoor is not sensitive here. For production use, run a proper multi-contributor ceremony so no single party knows the trapdoor.

## 4. Generate a proof

The prover reads a witness from `input.json`:

```
{ "preimage": "42" }
```

That is the value you claim to know a Poseidon preimage of. You can change it to any BN254 scalar and re-prove. Then:

```
npm run prove
```

`prove.sh` calculates the witness from the input, produces a Groth16 proof against the zkey, and also verifies the proof off-chain with snarkjs to catch obvious mistakes before you spend gas.

Expected artifacts under `build/`:

```
proof.json       # a, b, c points on the curve
public.json      # the public inputs, in this circuit a single field element: Poseidon(preimage)
witness.wtns
```

Check what `public.json` contains:

```
cat build/public.json
```

That single number is `Poseidon(42)`, and it is the digest anyone else would need to see to be convinced you know its preimage. Along with the proof, this is what you will submit on-chain to unlock a cell.

## 5. Encode artifacts and derive commitments

The on-chain script does not read snarkjs JSON directly. You need to convert the verifying key, proof, and public inputs into the arkworks-compressed byte layout the CKB verifier expects. There are two ways to do this; both produce byte-identical output:

- **Rust CLI**: `zk-lock encode-vk`, `encode-proof`, `encode-pi`
- **TypeScript SDK**: `encodeVerifyingKey`, `encodeProof`, `encodePublicInputs`

Return to the repo root and create an output directory:

```
cd ../..
mkdir -p tmp
```

### Encode via the Rust CLI

```
cargo run --release -p cli -- encode-vk    circuits/poseidon-preimage/build/vk.json     tmp/vk.bin
cargo run --release -p cli -- encode-proof circuits/poseidon-preimage/build/proof.json  tmp/proof.bin
cargo run --release -p cli -- encode-pi    circuits/poseidon-preimage/build/public.json tmp/pi.bin
```

Expected sizes for this circuit: `vk.bin` 296 B, `proof.bin` 128 B, `pi.bin` 36 B.

### Encode via the TypeScript SDK

```
cd sdk/ts
npm install
```

Create `sdk/ts/encode.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import {
  encodeVerifyingKey,
  encodeProof,
  encodePublicInputs,
} from "./src/index.js";

const CIRCUIT = "../../circuits/poseidon-preimage/build";
const OUT = "../../tmp";

writeFileSync(
  `${OUT}/vk.bin`,
  encodeVerifyingKey(JSON.parse(readFileSync(`${CIRCUIT}/vk.json`, "utf8"))),
);
writeFileSync(
  `${OUT}/proof.bin`,
  encodeProof(JSON.parse(readFileSync(`${CIRCUIT}/proof.json`, "utf8"))),
);
writeFileSync(
  `${OUT}/pi.bin`,
  encodePublicInputs(JSON.parse(readFileSync(`${CIRCUIT}/public.json`, "utf8"))),
);

console.log("wrote vk.bin, proof.bin, pi.bin to", OUT);
```

Run it:

```
npx tsx encode.ts
cd ../..
```

### Sanity-check the encoding

Whichever encoder you used, run the on-chain verifier's exact deserializer plus a pairing check against your bytes:

```
cargo run --release -p cli -- verify tmp/vk.bin tmp/proof.bin tmp/pi.bin
```

Expect `verified OK`. If you see anything else, your snarkjs artifacts are not what the verifier expects. Regenerate `proof.json` and `public.json` from a fresh witness and encode again.

### Derive the on-chain commitments

The zk-Lock script's `lock.args` is 64 bytes: `blake2b(vk_bytes) || blake2b(public_inputs_bytes[4..])`. Compute them.

Via the CLI:

```
cargo run --release -p cli -- hash-vk tmp/vk.bin
cargo run --release -p cli -- hash-pi tmp/pi.bin
```

Via the SDK, extend `sdk/ts/encode.ts` and rerun `npx tsx encode.ts`:

```ts
import { hashVk, hashPi } from "./src/index.js";

const vkBytes = readFileSync(`${OUT}/vk.bin`);
const piBytes = readFileSync(`${OUT}/pi.bin`);
console.log("vk_hash:", hashVk(vkBytes));
console.log("pi_commitment:", hashPi(piBytes));
```

Save the two 32-byte hashes. You will pass them to the `lock` command in the next section.

---

From here the tutorial forks. Sections 6A/7A/8A show the TypeScript SDK path. Sections 6B/7B/8B show the Rust CLI path. Both land you at the same place: a locked cell on Pudge that you unlock with a Groth16 proof. Pick either and skip the other, or read both.

## 6A. Deploy the verifying key (TypeScript)

The verifying key needs to live on chain in its own cell before you can lock CKB behind it. All zk-Lock cells that share a circuit will reuse this one vk cell as a `cell_dep`.

Create `sdk/ts/deploy-vk.ts`:

```ts
import { readFileSync } from "node:fs";
import { ccc } from "@ckb-ccc/core";
import { deployVk } from "./src/index.js";

const client = new ccc.ClientPublicTestnet();
const signer = new ccc.SignerCkbPrivateKey(client, process.env.CKB_PRIVKEY!);

const vkBytes = readFileSync("../../tmp/vk.bin");
const { txHash, index } = await deployVk(signer, vkBytes);

console.log("vk deployed");
console.log("tx_hash:", txHash);
console.log("out_point:", `${txHash}:${index}`);
```

Run it:

```
cd sdk/ts
npx tsx deploy-vk.ts
```

Once mined, note the `out_point`. This is your `vkDep` for the unlock in Section 8A.

## 7A. Lock a cell (TypeScript)

Send some CKB to a new cell locked by zk-Lock. The `lock.args` is the two 32-byte commitments you computed in Section 5, concatenated.

Create `sdk/ts/lock-cell.ts`:

```ts
import { ccc } from "@ckb-ccc/core";
import { lock } from "./src/index.js";

const CODE_HASH =
  "0x24172f2dc2ebd6634fe925a6f0beda7cfd4cdb9aab1214f2e1cbd3127ea1fa7b";
const VK_HASH = "0x<paste-your-vk-hash>";
const PI_COMMITMENT = "0x<paste-your-pi-commitment>";
const CAPACITY_CKB = 200n;

const client = new ccc.ClientPublicTestnet();
const signer = new ccc.SignerCkbPrivateKey(client, process.env.CKB_PRIVKEY!);

const { txHash, index } = await lock(signer, {
  codeHash: CODE_HASH,
  vkHash: VK_HASH,
  piCommitment: PI_COMMITMENT,
  capacityCkb: CAPACITY_CKB,
});

console.log("cell locked");
console.log("out_point:", `${txHash}:${index}`);
```

Run it:

```
npx tsx lock-cell.ts
```

Wait for the tx to confirm. The `out_point` is your `cell` for the unlock.

## 8A. Unlock the cell (TypeScript)

To spend the locked cell, submit the proof plus public inputs in the witness.

Create `sdk/ts/unlock-cell.ts`:

```ts
import { readFileSync } from "node:fs";
import { ccc } from "@ckb-ccc/core";
import { unlock } from "./src/index.js";

const CONTRACT_DEP = {
  txHash:
    "0x7d80c7a2781328cc766497f9d67b036a4d1295bda9f1de0d329bf08afd0e06fb",
  index: 0,
};
const VK_DEP = { txHash: "0x<paste-your-vk-deploy-tx-hash>", index: 0 };
const CELL = { txHash: "0x<paste-your-lock-tx-hash>", index: 0 };

const client = new ccc.ClientPublicTestnet();
const signer = new ccc.SignerCkbPrivateKey(client, process.env.CKB_PRIVKEY!);

const proofBytes = readFileSync("../../tmp/proof.bin");
const piBytes = readFileSync("../../tmp/pi.bin");

const txHash = await unlock(signer, {
  cell: CELL,
  contractDep: CONTRACT_DEP,
  vkDep: VK_DEP,
  proofBytes,
  piBytes,
});

console.log("cell unlocked");
console.log("tx_hash:", txHash);
```

Run:

```
npx tsx unlock-cell.ts
```

If the proof and public inputs match the committed vk and pi_commitment, the transaction lands and your CKB moves back to your default lock. If you get an error, see Section 10.

## 6B. Deploy the verifying key (Rust CLI)

From the repo root:

```
cargo run -p cli --release -- deploy-vk tmp/vk.bin
```

Output shows the deploy tx hash and out_point. Note the out_point. It is your `vk_dep` for the unlock in Section 8B.

## 7B. Lock a cell (Rust CLI)

Substitute the `vk_hash` and `pi_commitment` you computed in Section 5, and pick a capacity in CKB (at least 63 for minimum cell size, 200 is comfortable):

```
cargo run -p cli --release -- lock \
    0x24172f2dc2ebd6634fe925a6f0beda7cfd4cdb9aab1214f2e1cbd3127ea1fa7b \
    <vk_hash> \
    <pi_commitment> \
    200
```

Output shows the lock tx hash and out_point. Note the out_point. It is your `cell` for the unlock.

## 8B. Unlock the cell (Rust CLI)

```
cargo run -p cli --release -- unlock \
    <lock-tx-hash>:0 \
    0x7d80c7a2781328cc766497f9d67b036a4d1295bda9f1de0d329bf08afd0e06fb:0 \
    <vk-deploy-tx-hash>:0 \
    tmp/proof.bin \
    tmp/pi.bin
```

Output shows the unlock tx hash. If the proof and public inputs match the committed vk and pi_commitment, the transaction lands. If you get an error, see Section 10.

## 9. What you have

At this point you have three tx hashes on Pudge:

1. A vk deployment tx: a cell holding your verifying key as its data.
2. A lock tx: your CKB locked behind `blake2b(vk_bytes) || blake2b(pi_bytes[4..])`.
3. An unlock tx: the same CKB back in your control, spent via a Groth16 proof.

Look each up on the [Pudge explorer](https://pudge.explorer.nervos.org/).

The interesting one is the unlock. Its witness contains 128 bytes of proof followed by a length-prefixed public-inputs vector. The lock script pulled the vk out of the vk cell (matched by `blake2b(data) == vk_hash`), pulled the public inputs out of the witness (matched against `pi_commitment`), and ran a full Groth16 pairing check. The unlock succeeded because the proof was valid.

## 10. Troubleshooting

**`verify FAILED: InvalidProof`, `InvalidVk`, or `InvalidPublicInputs`**
Byte format mismatch. Re-run the encoder against fresh snarkjs artifacts. Because the off-chain `verify` subcommand uses the exact same deserializer as the on-chain script, a successful off-chain `verified OK` guarantees the same bytes are accepted on chain.

**`verify FAILED: VerificationFailed`**
The proof was well-formed but did not satisfy the circuit for the given public inputs. Regenerate `proof.json` and `public.json` from a fresh `witness.wtns`. Common cause: you changed `input.json` and forgot to re-prove.

**Unlock tx rejected with `PublicInputCountMismatch`**
The number of public inputs you submitted does not equal `vk.IC.len() - 1`. Snarkjs generates `public.json` with exactly the right count; if you hand-edited it, undo.

**Unlock tx rejected because the referenced vk cell does not match `vk_hash`**
The vk cell you referenced does not contain the bytes matching `vk_hash`. Either your `vk_dep` outpoint is wrong, or the vk cell was deployed with different bytes than the ones you hashed. Deploy a fresh vk cell and try again.

**`CKB_PRIVKEY not set`**
Export the env var: `export CKB_PRIVKEY=0x<64-hex>`. If you are running a script from `sdk/ts/`, either export it in the same shell or pass `--env-file=../../.env` to the `tsx` command.

**`insufficient capacity`**
Your Pudge address does not have enough CKB. Request more from [the faucet](https://faucet.nervos.org/). Locking a cell needs at least ~63 CKB (minimum cell size) plus a small fee.

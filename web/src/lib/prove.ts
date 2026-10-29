/**
 * Browser-side proving for the Poseidon-preimage circuit.
 *
 * The secret is read here, fed to the wasm witness calculator, and never sent
 * anywhere. Nothing in this module issues a request carrying it: the only
 * fetches are for the three public artifacts below.
 */

// Synced out of circuits/poseidon-preimage/build by `npm run sync:circuit`.
const WASM_URL = "/circuit/circuit.wasm";
const ZKEY_URL = "/circuit/circuit.zkey";
const VK_URL = "/circuit/vk.json";

/** BN254 scalar field modulus. A secret must be a residue below this. */
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Longest secret guaranteed to fit under FIELD_MODULUS, since 2^248 < r. */
export const MAX_SECRET_BYTES = 31;

/**
 * snarkjs is ~310 kB and nothing needs it until the visitor commits to
 * proving, so it loads on demand.
 *
 * Unlike the Node scripts, the browser never terminates the BN128 worker pool:
 * it is worth keeping warm, and nothing is waiting to exit.
 */
async function snarkGroth16() {
  const { groth16 } = await import("snarkjs");
  return groth16;
}

/**
 * The SDK pulls in @ckb-ccc/core for its blake2b, another ~270 kB gzipped.
 * Loaded alongside the prover rather than on the critical path.
 */
async function sdk() {
  return import("@zk-lock/sdk");
}

export type Stage =
  | "mapping"
  | "loading"
  | "proving"
  | "verifying"
  | "encoding"
  | "done";

/** Everything one proving attempt produces, in the order the UI reveals it. */
export type Attempt = {
  /** What the visitor typed. */
  word: string;
  /** The word as a field element, the circuit's private input. */
  field: bigint;
  /** The circuit's single public output, Poseidon(field), as a decimal string. */
  digest: string;
  /** snarkjs-shaped proof, before arkworks-compressed encoding. */
  proof: unknown;
  publicSignals: string[];
  /** 128 bytes: pi_a (32) || pi_b (64) || pi_c (32). */
  proofBytes: Uint8Array;
  /** 36 bytes: u32 LE count || one 32-byte field element. */
  piBytes: Uint8Array;
  /** 164 bytes, exactly what goes into witness.lock. */
  witnessLock: Uint8Array;
  /** blake2b_256 of the public-input bytes, excluding the count prefix. */
  piCommitment: `0x${string}`;
  /** Whether the proof checks out against the same vk the chain loads. */
  verifiedLocally: boolean;
  proveMs: number;
};

/**
 * Maps a secret word to a field element, big-endian over its UTF-8 bytes.
 * Capped at 31 bytes so the result is always below the modulus without a
 * reduction, which would silently make two different words collide.
 */
export function wordToField(word: string): bigint {
  const bytes = new TextEncoder().encode(word);
  if (bytes.length === 0) {
    throw new Error("Type a secret word first.");
  }
  if (bytes.length > MAX_SECRET_BYTES) {
    throw new Error(
      `That is ${bytes.length} bytes. ${MAX_SECRET_BYTES} is the most that fits in one field element.`
    );
  }
  let acc = 0n;
  for (const byte of bytes) {
    acc = (acc << 8n) | BigInt(byte);
  }
  if (acc === 0n || acc >= FIELD_MODULUS) {
    throw new Error("That word does not map to a valid field element.");
  }
  return acc;
}

/**
 * Runs one full attempt: map, prove, verify, encode.
 *
 * `onStage` fires with the stage about to start. Stages are only those that can
 * actually be observed: snarkjs computes witness and proof in one call, so
 * "proving" covers both rather than faking sub-progress.
 */
export async function runAttempt(
  word: string,
  onStage?: (stage: Stage) => void
): Promise<Attempt> {
  onStage?.("mapping");
  const field = wordToField(word);

  onStage?.("loading");
  const [groth16, { encodeProof, encodePublicInputs, hashPi }] =
    await Promise.all([snarkGroth16(), sdk()]);

  onStage?.("proving");
  const startedAt = performance.now();
  const { proof, publicSignals } = await groth16.fullProve(
    { preimage: field.toString() },
    WASM_URL,
    ZKEY_URL
  );
  const proveMs = Math.round(performance.now() - startedAt);

  onStage?.("verifying");
  const vk = await fetch(VK_URL).then((r) => r.json());
  const verifiedLocally = await groth16.verify(vk, publicSignals, proof);

  onStage?.("encoding");
  const proofBytes = encodeProof(proof as never);
  const piBytes = encodePublicInputs(publicSignals);
  const witnessLock = new Uint8Array(proofBytes.length + piBytes.length);
  witnessLock.set(proofBytes, 0);
  witnessLock.set(piBytes, proofBytes.length);

  onStage?.("done");
  return {
    word,
    field,
    digest: publicSignals[0],
    proof,
    publicSignals,
    proofBytes,
    piBytes,
    witnessLock,
    piCommitment: hashPi(piBytes),
    verifiedLocally,
    proveMs,
  };
}

export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

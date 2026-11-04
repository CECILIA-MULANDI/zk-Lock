// Validates the browser demo's pipeline end to end, in Node, against the real
// circuit artifacts: word -> field element -> Groth16 proof -> local verify ->
// 164-byte witness.lock -> pi commitment.
//
// Everything here is what the browser does, minus the browser. Run after
// `npm run sync:circuit`.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { groth16 } from "snarkjs";
import { encodeProof, encodePublicInputs, hashPi } from "@zk-lock/sdk";

const here = dirname(fileURLToPath(import.meta.url));
const circuit = join(here, "..", "public", "circuit");

const MAX_SECRET_BYTES = 31;
const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

function wordToField(word) {
  const bytes = new TextEncoder().encode(word);
  if (bytes.length === 0) throw new Error("The secret is empty.");
  if (bytes.length > MAX_SECRET_BYTES) {
    throw new Error(`The secret is ${bytes.length} bytes, max ${MAX_SECRET_BYTES}.`);
  }
  let acc = 0n;
  for (const byte of bytes) acc = (acc << 8n) | BigInt(byte);
  return acc;
}

const hex = (u8) => Buffer.from(u8).toString("hex");

const SECRET = process.argv[2] ?? "nervos";
const field = wordToField(SECRET);

console.log(`secret word     : "${SECRET}"`);
console.log(`field element   : ${field}`);
console.log(`under modulus   : ${field < FIELD_MODULUS}`);

const t0 = performance.now();
const { proof, publicSignals } = await groth16.fullProve(
  { preimage: field.toString() },
  join(circuit, "circuit.wasm"),
  join(circuit, "circuit.zkey")
);
const proveMs = Math.round(performance.now() - t0);

const vk = JSON.parse(await readFile(join(circuit, "vk.json"), "utf8"));
const verified = await groth16.verify(vk, publicSignals, proof);

const proofBytes = encodeProof(proof);
const piBytes = encodePublicInputs(publicSignals);
const witnessLock = new Uint8Array(proofBytes.length + piBytes.length);
witnessLock.set(proofBytes, 0);
witnessLock.set(piBytes, proofBytes.length);

console.log(`digest (public) : ${publicSignals[0]}`);
console.log(`proved in       : ${proveMs}ms`);
console.log(`verifies        : ${verified}`);
console.log(`proof bytes     : ${proofBytes.length}`);
console.log(`pi bytes        : ${piBytes.length}`);
console.log(`witness.lock    : ${witnessLock.length}`);
console.log(`pi_commitment   : ${hashPi(piBytes)}`);
console.log(`\nwitness.lock hex:\n${hex(witnessLock)}`);

const problems = [];
if (!verified) problems.push("proof does not verify");
if (proofBytes.length !== 128) problems.push(`proof is ${proofBytes.length} bytes, expected 128`);
if (piBytes.length !== 36) problems.push(`pi is ${piBytes.length} bytes, expected 36`);
if (witnessLock.length !== 164) problems.push(`witness is ${witnessLock.length} bytes, expected 164`);
if (hex(piBytes.slice(0, 4)) !== "01000000") problems.push("pi_count is not 1 in u32 LE");

// snarkjs spins up a BN128 worker pool and never closes it, so a Node process
// that has proved once will hang on exit unless the curve is terminated. The
// browser does not need this: there the pool is worth keeping warm between
// proofs, and nothing is waiting to exit.
await globalThis.curve_bn128?.terminate();

if (problems.length) {
  console.error(`\nFAILED:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("\nOK: the browser pipeline is sound.");
process.exit(0);

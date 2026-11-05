// Copies the proving artifacts the browser needs out of the circuit build into
// public/circuit/, so they are served as static assets and always match the
// circuit in this repo.
//
// public/circuit/ is committed. It has to be: a deploy runs on a machine with
// no circom and no snarkjs, and regenerating the key there would be worse than
// useless anyway, because the verifying key is pinned on chain. A rebuilt zkey
// that differed by a byte would change vk_hash and every unlock would be
// rejected. The artifacts are reproducible (build.sh skips the MPC
// contribution and CI re-derives the hash), so committing them costs nothing
// but the 1.8 MB.
//
// So this script refreshes them when a local circuit build exists, and stands
// aside when it does not.
import { mkdir, copyFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const circuitBuild = join(here, "..", "..", "circuits", "poseidon-preimage", "build");
const dest = join(here, "..", "public", "circuit");

const artifacts = [
  { from: join(circuitBuild, "circuit_js", "circuit.wasm"), to: "circuit.wasm" },
  { from: join(circuitBuild, "circuit_0000.zkey"), to: "circuit.zkey" },
  { from: join(circuitBuild, "vk.json"), to: "vk.json" },
];

const sizeOf = async (path) => {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
};

await mkdir(dest, { recursive: true });

const missingSources = [];
for (const { from } of artifacts) {
  if ((await sizeOf(from)) === null) missingSources.push(from);
}

if (missingSources.length > 0) {
  // No local circuit build. Fine if the committed copies are in place, which
  // is the normal case for a clone and for every CI and deploy build.
  const haveAll = (
    await Promise.all(artifacts.map(({ to }) => sizeOf(join(dest, to))))
  ).every((size) => size !== null && size > 0);

  if (haveAll) {
    console.log("No local circuit build; using the committed artifacts in public/circuit/.");
    process.exit(0);
  }

  console.error(`\nMissing circuit artifacts, and public/circuit/ is empty too.`);
  console.error(`Not found: ${missingSources[0]}`);
  console.error("Build the circuit first:");
  console.error("  cd ../circuits/poseidon-preimage && npm install && npm run build\n");
  process.exit(1);
}

let total = 0;
for (const { from, to } of artifacts) {
  const size = await sizeOf(from);
  await copyFile(from, join(dest, to));
  total += size;
  console.log(`  ${to.padEnd(14)} ${(size / 1024).toFixed(0).padStart(5)} KB`);
}

console.log(`\ncircuit artifacts synced: ${(total / 1024 / 1024).toFixed(2)} MB total`);

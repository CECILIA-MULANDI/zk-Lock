// Copies the proving artifacts the browser needs out of the circuit build into
// public/circuit/, so they are served as static assets and always match the
// circuit in this repo. They are generated, so public/circuit/ is gitignored.
//
// Run `npm run build` in circuits/poseidon-preimage first if this fails.
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

await mkdir(dest, { recursive: true });

let total = 0;
for (const { from, to } of artifacts) {
  let size;
  try {
    size = (await stat(from)).size;
  } catch {
    console.error(`\nMissing circuit artifact: ${from}`);
    console.error("Build the circuit first:");
    console.error("  cd ../circuits/poseidon-preimage && npm install && npm run build\n");
    process.exit(1);
  }
  await copyFile(from, join(dest, to));
  total += size;
  console.log(`  ${to.padEnd(14)} ${(size / 1024).toFixed(0).padStart(5)} KB`);
}

console.log(`\ncircuit artifacts synced: ${(total / 1024 / 1024).toFixed(2)} MB total`);

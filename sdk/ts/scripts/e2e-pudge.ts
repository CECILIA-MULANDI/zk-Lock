import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { ccc } from "@ckb-ccc/core";

import {
  encodeVerifyingKey,
  encodeProof,
  encodePublicInputs,
  hashVk,
  hashPi,
  deployVk,
  lock,
  unlock,
  type SnarkjsProof,
  type SnarkjsVerifyingKey,
} from "../src/index.js";

// Pre-deployed zk-lock contract on Pudge
const CONTRACT_OUTPOINT = {
  txHash: "0x7d80c7a2781328cc766497f9d67b036a4d1295bda9f1de0d329bf08afd0e06fb",
  index: 0,
} as const;
const CONTRACT_CODE_HASH =
  "0x24172f2dc2ebd6634fe925a6f0beda7cfd4cdb9aab1214f2e1cbd3127ea1fa7b" as `0x${string}`;

const LOCK_CAPACITY_CKB = 200n;
const WAIT_TIMEOUT_MS = 300_000;

async function main() {
  const privkey = process.env.CKB_PRIVKEY;
  if (!privkey) throw new Error("CKB_PRIVKEY not set");

  const here = dirname(fileURLToPath(import.meta.url));
  const build = resolve(here, "../../../circuits/poseidon-preimage/build");
  const readJson = (name: string) =>
    JSON.parse(readFileSync(resolve(build, name), "utf8"));

  const vkJson = readJson("vk.json") as SnarkjsVerifyingKey;
  const proofJson = readJson("proof.json") as SnarkjsProof;
  const publicSignals = readJson("public.json") as string[];

  const vkBytes = encodeVerifyingKey(vkJson);
  const proofBytes = encodeProof(proofJson);
  const piBytes = encodePublicInputs(publicSignals);
  const vkH = hashVk(vkBytes);
  const piComm = hashPi(piBytes);

  console.log(`vk bytes:       ${vkBytes.length}B`);
  console.log(`proof bytes:    ${proofBytes.length}B`);
  console.log(`pi bytes:       ${piBytes.length}B`);
  console.log(`vk_hash:        ${vkH}`);
  console.log(`pi_commitment:  ${piComm}`);

  const client = new ccc.ClientPublicTestnet();
  const signer = new ccc.SignerCkbPrivateKey(client, privkey);
  console.log(`sender address: ${await signer.getRecommendedAddress()}`);

  console.log("\n=== deploy vk ===");
  const { txHash: vkTx, index: vkIdx } = await deployVk(signer, vkBytes);
  console.log(`tx:             ${vkTx}`);
  console.log(`vk outpoint:    ${vkTx}:${vkIdx}`);
  console.log("waiting for confirmation...");
  await client.waitTransaction(vkTx, 0, WAIT_TIMEOUT_MS);

  console.log("\n=== lock ===");
  const { txHash: lockTx, index: lockIdx } = await lock(signer, {
    codeHash: CONTRACT_CODE_HASH,
    vkHash: vkH,
    piCommitment: piComm,
    capacityCkb: LOCK_CAPACITY_CKB,
  });
  console.log(`tx:             ${lockTx}`);
  console.log(`locked cell:    ${lockTx}:${lockIdx}`);
  console.log("waiting for confirmation...");
  await client.waitTransaction(lockTx, 0, WAIT_TIMEOUT_MS);

  console.log("\n=== unlock ===");
  const unlockTx = await unlock(signer, {
    cell: { txHash: lockTx, index: lockIdx },
    contractDep: CONTRACT_OUTPOINT,
    vkDep: { txHash: vkTx, index: vkIdx },
    proofBytes,
    piBytes,
  });
  console.log(`tx:             ${unlockTx}`);
  console.log("waiting for confirmation...");
  await client.waitTransaction(unlockTx, 0, WAIT_TIMEOUT_MS);

  console.log("\ndone. All three transactions confirmed on Pudge.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

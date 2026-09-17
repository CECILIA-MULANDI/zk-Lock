import { bn254 } from "@noble/curves/bn254.js";
import {
  decodeProof,
  decodePublicInputs,
  decodeVerifyingKey,
} from "./decode.js";

const { Fp12 } = bn254.fields;

export type VerifyResult =
  | { ok: true }
  | { ok: false; error: string };

export function verify(
  vkBytes: Uint8Array,
  proofBytes: Uint8Array,
  piBytes: Uint8Array,
): VerifyResult {
  let vk, proof, pi;
  try {
    vk = decodeVerifyingKey(vkBytes);
  } catch (e) {
    return { ok: false, error: `InvalidVk: ${(e as Error).message}` };
  }
  try {
    proof = decodeProof(proofBytes);
  } catch (e) {
    return { ok: false, error: `InvalidProof: ${(e as Error).message}` };
  }
  try {
    pi = decodePublicInputs(piBytes);
  } catch (e) {
    return { ok: false, error: `InvalidPublicInputs: ${(e as Error).message}` };
  }

  if (pi.length !== vk.ic.length - 1) {
    return {
      ok: false,
      error: `PublicInputCountMismatch: got ${pi.length}, vk expects ${vk.ic.length - 1}`,
    };
  }

  let vkX = vk.ic[0];
  for (let i = 0; i < pi.length; i++) {
    vkX = vkX.add(vk.ic[i + 1].multiply(pi[i]));
  }

  const result = bn254.pairingBatch([
    { g1: proof.a.negate(), g2: proof.b },
    { g1: vk.alpha, g2: vk.beta },
    { g1: vkX, g2: vk.gamma },
    { g1: proof.c, g2: vk.delta },
  ]);

  if (Fp12.eql(result, Fp12.ONE)) {
    return { ok: true };
  }
  return { ok: false, error: "VerificationFailed" };
}

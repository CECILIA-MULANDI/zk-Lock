import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  encodeProof,
  encodePublicInputs,
  encodeVerifyingKey,
  type SnarkjsProof,
  type SnarkjsVerifyingKey,
} from "../src/encode.js";
import { verify } from "../src/verify.js";
import { VK_HEADER } from "../src/decode.js";

const here = dirname(fileURLToPath(import.meta.url));
const build = resolve(here, "../../../circuits/poseidon-preimage/build");
const readJson = (name: string) =>
  JSON.parse(readFileSync(resolve(build, name), "utf8"));

function fixtures() {
  const vk = encodeVerifyingKey(readJson("vk.json") as SnarkjsVerifyingKey);
  const proof = encodeProof(readJson("proof.json") as SnarkjsProof);
  const pi = encodePublicInputs(readJson("public.json") as string[]);
  return { vk, proof, pi };
}

describe("verify (TS parity with Rust CLI)", () => {
  it("accepts a valid Groth16 proof against arkworks-compressed bytes", () => {
    const { vk, proof, pi } = fixtures();
    expect(verify(vk, proof, pi)).toEqual({ ok: true });
  });

  it("rejects a proof whose pi_a carries the infinity flag", () => {
    const { vk, proof, pi } = fixtures();
    const badProof = new Uint8Array(proof);
    // pi_a is the first 32 bytes of the proof; its flag byte is byte 31.
    // Setting the infinity flag makes decodeG1 reject deterministically.
    badProof[31] |= 0x40;
    expect(verify(vk, badProof, pi)).toEqual({
      ok: false,
      error: "InvalidProof: G1 point at infinity is rejected by zk-lock",
    });
  });

  it("rejects a vk whose IC[1] carries the infinity flag", () => {
    const { vk, proof, pi } = fixtures();
    const badVk = new Uint8Array(vk);
    // Skip the fixed header and IC[0] (one G1 = 32 bytes); the flag byte sits at
    // offset 31 within IC[1]. Derived from VK_HEADER so the offset can't drift.
    const ic1FlagByte = VK_HEADER + 32 + 31;
    badVk[ic1FlagByte] |= 0x40;
    expect(verify(badVk, proof, pi)).toEqual({
      ok: false,
      error: "InvalidVk: G1 point at infinity is rejected by zk-lock",
    });
  });

  it("rejects mismatched public inputs with VerificationFailed", () => {
    const { vk, proof, pi } = fixtures();
    const badPi = new Uint8Array(pi);
    // Flip the low bit of pi[0]. Stays a valid Fr element; changes vk_x; pairing rejects.
    badPi[4] ^= 0x01;
    expect(verify(vk, proof, badPi)).toEqual({
      ok: false,
      error: "VerificationFailed",
    });
  });

  it("rejects a wrong-length public-input vector", () => {
    const { vk, proof } = fixtures();
    const emptyPi = new Uint8Array(4);
    const result = verify(vk, proof, emptyPi);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/PublicInputCountMismatch/);
  });
});

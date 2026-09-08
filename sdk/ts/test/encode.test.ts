import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { hashVk, hashPi } from "../src/hash.js";

import {
  encodeProof,
  encodePublicInputs,
  encodeVerifyingKey,
  type SnarkjsProof,
  type SnarkjsVerifyingKey,
} from "../src/encode.js";

const here = dirname(fileURLToPath(import.meta.url));
const build = resolve(here, "../../../circuits/poseidon-preimage/build");
const readJson = (name: string) =>
  JSON.parse(readFileSync(resolve(build, name), "utf8"));
const tmp = resolve(here, "../tmp");

describe("encoder size sanity", () => {
  beforeAll(() => mkdirSync(tmp, { recursive: true }));

  it("encodes vk.json to the arkworks-expected byte length", () => {
    const vk = readJson("vk.json") as SnarkjsVerifyingKey;
    const bytes = encodeVerifyingKey(vk);
    writeFileSync(resolve(tmp, "vk.bin"), bytes);
    const expected = 32 + 3 * 64 + 8 + vk.IC.length * 32;
    expect(bytes.length).toBe(expected);
    expect(bytes.length).toBe(296);
  });

  it("encodes proof.json to exactly 128 bytes", () => {
    const proof = readJson("proof.json") as SnarkjsProof;
    const bytes = encodeProof(proof);
    writeFileSync(resolve(tmp, "proof.bin"), bytes);
    expect(bytes.length).toBe(128);
  });

  it("encodes public.json to 4 + N*32 bytes", () => {
    const publicSignals = readJson("public.json") as string[];
    const bytes = encodePublicInputs(publicSignals);
    writeFileSync(resolve(tmp, "pi.bin"), bytes);
    expect(bytes.length).toBe(4 + publicSignals.length * 32);
    expect(bytes.length).toBe(36);
  });
});

describe("encoder size sanity", () => {
  it("encodes vk.json to the arkworks-expected byte length", () => {
    const vk = readJson("vk.json") as SnarkjsVerifyingKey;
    const bytes = encodeVerifyingKey(vk);
    // 32 (alpha) + 3*64 (beta/gamma/delta) + 8 (u64 IC len) + IC.length*32
    const expected = 32 + 3 * 64 + 8 + vk.IC.length * 32;
    expect(bytes.length).toBe(expected);
    // For our Poseidon circuit (nPublic=1, IC.length=2), that is 296.
    expect(bytes.length).toBe(296);
  });

  it("encodes proof.json to exactly 128 bytes", () => {
    const proof = readJson("proof.json") as SnarkjsProof;
    expect(encodeProof(proof).length).toBe(128);
  });

  it("encodes public.json to 4 + N*32 bytes", () => {
    const publicSignals = readJson("public.json") as string[];
    const bytes = encodePublicInputs(publicSignals);
    expect(bytes.length).toBe(4 + publicSignals.length * 32);
    // Poseidon circuit has one public output (the digest).
    expect(bytes.length).toBe(36);
  });
});

describe("hash helpers match Rust CLI", () => {
  it("hashVk matches cli hash-vk", () => {
    const vk = readJson("vk.json") as SnarkjsVerifyingKey;
    const bytes = encodeVerifyingKey(vk);

    const hex = hashVk(bytes);
    expect(hex).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("hashPi matches cli hash-pi", () => {
    const publicSignals = readJson("public.json") as string[];
    const bytes = encodePublicInputs(publicSignals);
    const hex = hashPi(bytes);
    expect(hex).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
describe("hash helpers match Rust CLI", () => {
  it("hashVk matches cli hash-vk", () => {
    const vk = readJson("vk.json") as SnarkjsVerifyingKey;
    const bytes = encodeVerifyingKey(vk);
    expect(hashVk(bytes)).toBe(
      "0x1f0424a56478f21e3890d5101ead7c3c4eaee7394dae31ed56c15e965fe82fa7"
    );
  });

  it("hashPi matches cli hash-pi", () => {
    const publicSignals = readJson("public.json") as string[];
    const bytes = encodePublicInputs(publicSignals);
    expect(hashPi(bytes)).toBe(
      "0x1139c5766559f4aa0e8ff9c5ef8f9ed4d8ed2c6ec4d4a5c9bc917ef6de421c45"
    );
  });
});

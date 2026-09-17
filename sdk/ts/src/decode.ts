import { bn254 } from "@noble/curves/bn254.js";

const { Fp, Fp2, Fr } = bn254.fields;
const P = Fp.ORDER;
const R = Fr.ORDER;
const G1Point = bn254.G1.Point;
const G2Point = bn254.G2.Point;
type G1PointT = InstanceType<typeof G1Point>;
type G2PointT = InstanceType<typeof G2Point>;
type Fp2Elem = { c0: bigint; c1: bigint };

const B_TWIST: Fp2Elem = Fp2.mulByB(Fp2.ONE);

function fp2IsNegative(a: Fp2Elem): boolean {
  if (a.c1 > HALF_P) return true;
  if (a.c1 === 0n && a.c0 > HALF_P) return true;
  return false;
}

const HALF_P = (P - 1n) / 2n;
const FLAG_INFINITY = 0x40;
const FLAG_Y_NEGATIVE = 0x80;

function le32ToBigInt(bytes: Uint8Array, off: number): bigint {
  let v = 0n;
  for (let i = 31; i >= 0; i--) {
    v = (v << 8n) | BigInt(bytes[off + i]);
  }
  return v;
}

export function decodeG1(bytes: Uint8Array, off = 0): G1PointT {
  if (bytes.length < off + 32) {
    throw new Error(`G1: need 32 bytes at offset ${off}, got ${bytes.length - off}`);
  }
  const flagByte = bytes[off + 31];
  const isInfinity = (flagByte & FLAG_INFINITY) !== 0;
  const yIsNegative = (flagByte & FLAG_Y_NEGATIVE) !== 0;

  const clean = new Uint8Array(32);
  clean.set(bytes.subarray(off, off + 32));
  clean[31] &= ~(FLAG_INFINITY | FLAG_Y_NEGATIVE);

  if (isInfinity) {
    throw new Error("G1 point at infinity is rejected by zk-lock");
  }
  const x = le32ToBigInt(clean, 0);
  if (x >= P) {
    throw new Error(`G1 x = ${x} is not a valid Fp element (>= P)`);
  }

  const rhs = Fp.add(Fp.mul(Fp.mul(x, x), x), 3n);
  let yCand: bigint;
  try {
    yCand = Fp.sqrt(rhs);
  } catch {
    throw new Error(`G1 x = ${x} is not on curve (x^3 + 3 has no square root)`);
  }
  const candIsNegative = yCand > HALF_P;
  const y = candIsNegative === yIsNegative ? yCand : P - yCand;

  const point = G1Point.fromAffine({ x, y });
  point.assertValidity();
  return point;
}

export function decodeG2(bytes: Uint8Array, off = 0): G2PointT {
  if (bytes.length < off + 64) {
    throw new Error(`G2: need 64 bytes at offset ${off}, got ${bytes.length - off}`);
  }
  const flagByte = bytes[off + 63];
  const isInfinity = (flagByte & FLAG_INFINITY) !== 0;
  const yIsNegative = (flagByte & FLAG_Y_NEGATIVE) !== 0;

  const clean = new Uint8Array(64);
  clean.set(bytes.subarray(off, off + 64));
  clean[63] &= ~(FLAG_INFINITY | FLAG_Y_NEGATIVE);

  if (isInfinity) {
    throw new Error("G2 point at infinity is rejected by zk-lock");
  }
  const xC0 = le32ToBigInt(clean, 0);
  const xC1 = le32ToBigInt(clean, 32);
  if (xC0 >= P || xC1 >= P) {
    throw new Error(`G2 x coordinate out of range`);
  }
  const x: Fp2Elem = { c0: xC0, c1: xC1 };

  const rhs = Fp2.add(Fp2.mul(Fp2.mul(x, x), x), B_TWIST);
  let yCand: Fp2Elem;
  try {
    yCand = Fp2.sqrt(rhs);
  } catch {
    throw new Error(`G2 x is not on twist (x^3 + b' has no square root in Fp2)`);
  }
  const candIsNegative = fp2IsNegative(yCand);
  const y = candIsNegative === yIsNegative ? yCand : Fp2.neg(yCand);

  const point = G2Point.fromAffine({ x, y });
  point.assertValidity();
  return point;
}

export interface DecodedProof {
  a: G1PointT;
  b: G2PointT;
  c: G1PointT;
}

export interface DecodedVerifyingKey {
  alpha: G1PointT;
  beta: G2PointT;
  gamma: G2PointT;
  delta: G2PointT;
  ic: G1PointT[];
}

export function decodeProof(bytes: Uint8Array): DecodedProof {
  if (bytes.length !== 128) {
    throw new Error(`proof bytes: expected 128, got ${bytes.length}`);
  }
  return {
    a: decodeG1(bytes, 0),
    b: decodeG2(bytes, 32),
    c: decodeG1(bytes, 96),
  };
}

export const VK_HEADER = 32 + 64 * 3 + 8;

export function decodeVerifyingKey(bytes: Uint8Array): DecodedVerifyingKey {
  if (bytes.length < VK_HEADER) {
    throw new Error(`vk bytes: too short (${bytes.length} < ${VK_HEADER})`);
  }
  const alpha = decodeG1(bytes, 0);
  const beta = decodeG2(bytes, 32);
  const gamma = decodeG2(bytes, 96);
  const delta = decodeG2(bytes, 160);

  let icLen = 0n;
  for (let i = 0; i < 8; i++) {
    icLen |= BigInt(bytes[224 + i]) << BigInt(i * 8);
  }
  if (icLen > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`vk IC length ${icLen} is unreasonable`);
  }
  const n = Number(icLen);
  const expected = VK_HEADER + n * 32;
  if (bytes.length !== expected) {
    throw new Error(
      `vk bytes length ${bytes.length} != ${expected} (header + ${n}*32)`,
    );
  }

  const ic: G1PointT[] = [];
  for (let i = 0; i < n; i++) {
    ic.push(decodeG1(bytes, VK_HEADER + i * 32));
  }
  return { alpha, beta, gamma, delta, ic };
}

export function decodePublicInputs(bytes: Uint8Array): bigint[] {
  if (bytes.length < 4) {
    throw new Error("pi bytes too short: missing 4-byte length prefix");
  }
  const n = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  const expected = 4 + n * 32;
  if (bytes.length !== expected) {
    throw new Error(
      `pi bytes length ${bytes.length} != 4 + ${n}*32 = ${expected}`
    );
  }
  const out: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const v = le32ToBigInt(bytes, 4 + i * 32);
    if (v >= R) {
      throw new Error(`public[${i}] = ${v} is not a valid Fr element (>= R)`);
    }
    out.push(v);
  }
  return out;
}

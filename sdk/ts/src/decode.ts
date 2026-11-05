import { bn254 } from "@noble/curves/bn254.js";
import {
  FR_LEN,
  G1_LEN,
  G2_LEN,
  PI_PREFIX_LEN,
  PROOF_LEN,
  VK_IC_PREFIX_LEN,
} from "./encode.js";

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
  if (bytes.length < off + G1_LEN) {
    throw new Error(
      `G1: need ${G1_LEN} bytes at offset ${off}, got ${bytes.length - off}`,
    );
  }
  const flagByte = bytes[off + 31];
  const isInfinity = (flagByte & FLAG_INFINITY) !== 0;
  const yIsNegative = (flagByte & FLAG_Y_NEGATIVE) !== 0;

  const clean = new Uint8Array(G1_LEN);
  clean.set(bytes.subarray(off, off + G1_LEN));
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
  if (bytes.length < off + G2_LEN) {
    throw new Error(
      `G2: need ${G2_LEN} bytes at offset ${off}, got ${bytes.length - off}`,
    );
  }
  const flagByte = bytes[off + 63];
  const isInfinity = (flagByte & FLAG_INFINITY) !== 0;
  const yIsNegative = (flagByte & FLAG_Y_NEGATIVE) !== 0;

  const clean = new Uint8Array(G2_LEN);
  clean.set(bytes.subarray(off, off + G2_LEN));
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
  if (bytes.length !== PROOF_LEN) {
    throw new Error(`proof bytes: expected ${PROOF_LEN}, got ${bytes.length}`);
  }
  return {
    a: decodeG1(bytes, 0),
    b: decodeG2(bytes, G1_LEN),
    c: decodeG1(bytes, G1_LEN + G2_LEN),
  };
}

export const VK_HEADER = G1_LEN + G2_LEN * 3 + VK_IC_PREFIX_LEN;

export function decodeVerifyingKey(bytes: Uint8Array): DecodedVerifyingKey {
  if (bytes.length < VK_HEADER) {
    throw new Error(`vk bytes: too short (${bytes.length} < ${VK_HEADER})`);
  }
  const alpha = decodeG1(bytes, 0);
  const beta = decodeG2(bytes, G1_LEN);
  const gamma = decodeG2(bytes, G1_LEN + G2_LEN);
  const delta = decodeG2(bytes, G1_LEN + G2_LEN * 2);

  const icLenOff = VK_HEADER - VK_IC_PREFIX_LEN;
  let icLen = 0n;
  for (let i = 0; i < VK_IC_PREFIX_LEN; i++) {
    icLen |= BigInt(bytes[icLenOff + i]) << BigInt(i * 8);
  }
  if (icLen > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`vk IC length ${icLen} is unreasonable`);
  }
  const n = Number(icLen);
  const expected = VK_HEADER + n * G1_LEN;
  if (bytes.length !== expected) {
    throw new Error(
      `vk bytes length ${bytes.length} != ${expected} (header + ${n}*${G1_LEN})`,
    );
  }

  const ic: G1PointT[] = [];
  for (let i = 0; i < n; i++) {
    ic.push(decodeG1(bytes, VK_HEADER + i * G1_LEN));
  }
  return { alpha, beta, gamma, delta, ic };
}

export function decodePublicInputs(bytes: Uint8Array): bigint[] {
  if (bytes.length < PI_PREFIX_LEN) {
    throw new Error(
      `pi bytes too short: missing ${PI_PREFIX_LEN}-byte length prefix`,
    );
  }
  const n = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
  const expected = PI_PREFIX_LEN + n * FR_LEN;
  if (bytes.length !== expected) {
    throw new Error(
      `pi bytes length ${bytes.length} != ${PI_PREFIX_LEN} + ${n}*${FR_LEN} = ${expected}`
    );
  }
  const out: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const v = le32ToBigInt(bytes, PI_PREFIX_LEN + i * FR_LEN);
    if (v >= R) {
      throw new Error(`public[${i}] = ${v} is not a valid Fr element (>= R)`);
    }
    out.push(v);
  }
  return out;
}

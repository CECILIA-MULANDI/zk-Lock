// BN254 base field mod(Fq): [0,P]
// This where all curve coordinatesx, y live
const P = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47n;
// BN254 scalar field mod(Fr)
// Where public inputs and Fr elements live
const R = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n;

const HALF_P = (P - 1n) / 2n;

// flag bits
const FLAG_INFINITY = 0x40;
const FLAG_Y_NEGATIVE = 0x80;

type G1Proj = [string, string, string];
type G2Proj = [[string, string], [string, string], [string, string]];

export interface SnarkjsProof {
  pi_a: G1Proj;
  pi_b: G2Proj;
  pi_c: G1Proj;
  protocol: string;
  curve: string;
}
export interface SnarkjsVerifyingKey {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: G1Proj;
  vk_beta_2: G2Proj;
  vk_gamma_2: G2Proj;
  vk_delta_2: G2Proj;
  IC: G1Proj[];
  // vk_alphabeta_12 is a precomputed pairing value
  //  the on-chain verifier
  // recomputes it, so here I intentionally do not encode it.
}

// Serialize a canonical field element (any BigInt in [0, modulus)) as 32 bytes
// little-endian.
function bigIntToLe32(x: bigint, modulus: bigint): Uint8Array {
  if (x < 0n || x >= modulus) {
    throw new Error(`field element out of range: ${x}`);
  }
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 0; i < 32; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// snarkjs writes coords as decimal strings.
// Parse defensively anything else
// is/should be either a bug in the JSON or a curve/format mismatch.
function parseDecString(s: unknown, field: string): bigint {
  if (typeof s !== "string") {
    throw new Error(`${field}: expected decimal string, got ${typeof s}`);
  }
  return BigInt(s);
}

function fpIsNegative(y: bigint): boolean {
  return y > HALF_P;
}

function fp2IsNegative(c0: bigint, c1: bigint): boolean {
  if (c1 > HALF_P) return true;
  if (c1 === 0n && c0 > HALF_P) return true;
  return false;
}

export function encodeG1(x: bigint, y: bigint): Uint8Array {
  if (x < 0n || x >= P || y < 0n || y >= P) {
    throw new Error("G1 coordinate out of range");
  }
  if (x === 0n && y === 0n) {
    throw new Error("G1 point at infinity is rejected by zk-lock");
  }
  const bytes = bigIntToLe32(x, P);
  if (fpIsNegative(y)) bytes[31] |= FLAG_Y_NEGATIVE;
  return bytes;
}

export function encodeG2(
  xC0: bigint,
  xC1: bigint,
  yC0: bigint,
  yC1: bigint
): Uint8Array {
  for (const v of [xC0, xC1, yC0, yC1]) {
    if (v < 0n || v >= P) throw new Error("G2 coordinate out of range");
  }
  if (xC0 === 0n && xC1 === 0n && yC0 === 0n && yC1 === 0n) {
    throw new Error("G2 point at infinity is rejected by zk-lock");
  }
  const out = new Uint8Array(64);
  out.set(bigIntToLe32(xC0, P), 0);
  out.set(bigIntToLe32(xC1, P), 32);
  if (fp2IsNegative(yC0, yC1)) out[63] |= FLAG_Y_NEGATIVE;
  return out;
}

export function encodeFr(v: bigint): Uint8Array {
  return bigIntToLe32(v, R);
}

function assertGroth16Bn254(
  o: { protocol: string; curve: string },
  where: string
) {
  if (o.protocol !== "groth16") {
    throw new Error(
      `${where}: protocol must be "groth16", got "${o.protocol}"`
    );
  }
  if (o.curve !== "bn128") {
    throw new Error(`${where}: curve must be "bn128", got "${o.curve}"`);
  }
}

function parseG1(p: G1Proj, where: string): { x: bigint; y: bigint } {
  if (!Array.isArray(p) || p.length !== 3) {
    throw new Error(`${where}: expected [x, y, z] triple`);
  }
  const z = parseDecString(p[2], `${where}.z`);
  if (z !== 1n) {
    throw new Error(`${where}: expected affine point (z=1), got z=${z}`);
  }
  return {
    x: parseDecString(p[0], `${where}.x`),
    y: parseDecString(p[1], `${where}.y`),
  };
}

function parseG2(
  p: G2Proj,
  where: string
): {
  xC0: bigint;
  xC1: bigint;
  yC0: bigint;
  yC1: bigint;
} {
  if (!Array.isArray(p) || p.length !== 3) {
    throw new Error(`${where}: expected [[x0,x1],[y0,y1],[z0,z1]] triple`);
  }
  const [x, y, z] = p;
  const z0 = parseDecString(z[0], `${where}.z0`);
  const z1 = parseDecString(z[1], `${where}.z1`);
  if (z0 !== 1n || z1 !== 0n) {
    throw new Error(
      `${where}: expected affine point (z=1+0u), got ${z0}+${z1}u`
    );
  }
  return {
    xC0: parseDecString(x[0], `${where}.x.c0`),
    xC1: parseDecString(x[1], `${where}.x.c1`),
    yC0: parseDecString(y[0], `${where}.y.c0`),
    yC1: parseDecString(y[1], `${where}.y.c1`),
  };
}
// Proof bytes: pi_a (G1, 32B) || pi_b (G2, 64B) || pi_c (G1, 32B) = 128B.
export function encodeProof(proof: SnarkjsProof): Uint8Array {
  assertGroth16Bn254(proof, "proof");
  const a = parseG1(proof.pi_a, "proof.pi_a");
  const b = parseG2(proof.pi_b, "proof.pi_b");
  const c = parseG1(proof.pi_c, "proof.pi_c");

  const out = new Uint8Array(128);
  out.set(encodeG1(a.x, a.y), 0);
  out.set(encodeG2(b.xC0, b.xC1, b.yC0, b.yC1), 32);
  out.set(encodeG1(c.x, c.y), 96);
  return out;
}

// Public-input bytes: u32 LE count || count * 32B Fr elements.
// snarkjs's public.json is a top-level array of decimal strings.
export function encodePublicInputs(publicSignals: string[]): Uint8Array {
  const n = publicSignals.length;
  const out = new Uint8Array(4 + n * 32);
  // u32 LE length prefix
  out[0] = n & 0xff;
  out[1] = (n >>> 8) & 0xff;
  out[2] = (n >>> 16) & 0xff;
  out[3] = (n >>> 24) & 0xff;
  for (let i = 0; i < n; i++) {
    out.set(
      encodeFr(parseDecString(publicSignals[i], `public[${i}]`)),
      4 + i * 32
    );
  }
  return out;
}

// Verifying key bytes:
//   alpha (G1, 32B) || beta (G2, 64B) || gamma (G2, 64B) || delta (G2, 64B)
//   || u64 LE ic_len || ic_len * G1 (32B each)
// For our 1-public-input Poseidon circuit: ic_len = 2, total = 296 bytes.
export function encodeVerifyingKey(vk: SnarkjsVerifyingKey): Uint8Array {
  assertGroth16Bn254(vk, "vk");
  if (vk.IC.length !== vk.nPublic + 1) {
    throw new Error(
      `vk.IC length ${vk.IC.length} does not match nPublic+1 = ${
        vk.nPublic + 1
      }`
    );
  }

  const alpha = parseG1(vk.vk_alpha_1, "vk.vk_alpha_1");
  const beta = parseG2(vk.vk_beta_2, "vk.vk_beta_2");
  const gamma = parseG2(vk.vk_gamma_2, "vk.vk_gamma_2");
  const delta = parseG2(vk.vk_delta_2, "vk.vk_delta_2");
  const ic = vk.IC.map((p, i) => parseG1(p, `vk.IC[${i}]`));

  const total = 32 + 64 * 3 + 8 + ic.length * 32;
  const out = new Uint8Array(total);
  let off = 0;
  out.set(encodeG1(alpha.x, alpha.y), off);
  off += 32;
  out.set(encodeG2(beta.xC0, beta.xC1, beta.yC0, beta.yC1), off);
  off += 64;
  out.set(encodeG2(gamma.xC0, gamma.xC1, gamma.yC0, gamma.yC1), off);
  off += 64;
  out.set(encodeG2(delta.xC0, delta.xC1, delta.yC0, delta.yC1), off);
  off += 64;

  // u64 LE length prefix for the IC vector
  const icLen = BigInt(ic.length);
  for (let i = 0; i < 8; i++) {
    out[off + i] = Number((icLen >> BigInt(i * 8)) & 0xffn);
  }
  off += 8;

  for (const p of ic) {
    out.set(encodeG1(p.x, p.y), off);
    off += 32;
  }
  return out;
}

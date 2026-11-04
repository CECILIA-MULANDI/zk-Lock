import { describe, expect, it } from "vitest";
import { ccc } from "@ckb-ccc/core";
import {
  buildBoundUnlockTx,
  planBoundUnlock,
  type BoundPlan,
} from "../src/ckb.js";

/**
 * Regression cover for the bound unlock.
 *
 * The bug these exist for: the context hash was computed against
 * `inputCapacity - fee` while the transaction shipped output 0 at
 * `inputCapacity`, because the fee was paid by `completeFeeBy` adding a change
 * output instead of shrinking output 0. Every bound unlock was rejected on
 * chain with ContextMismatch.
 *
 * Nothing here needs a node: the planning and building steps are pure.
 */

const SHAPE = {
  cell: {
    txHash:
      "0x929a6507c43f0a19921844ef1aa157c622890946877f69a423ceb03814d0ecd5",
    index: 0,
  },
  contractDep: {
    txHash:
      "0x9cf1e0a6ecc8eeb2705a894a828c07898e77a68a0b9d42b4ff8953bd7c569f5f",
    index: 0,
  },
  vkDep: {
    txHash:
      "0x2adb611b833126ec59234cb8e8645a2da91209fb4450187427fdbf5dc6dad1b9",
    index: 0,
  },
  recipient: {
    codeHash:
      "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
    hashType: "type" as const,
    args: "0x62fa2b3c8f6b9e45a1d07a0c3b5e8d41f29c6a7b",
  },
};

/** 1 public input slot for the context, plus 1 body element: 4 + 32 + 32. */
const PI_BYTES = (() => {
  const bytes = new Uint8Array(4 + 64);
  bytes[0] = 2; // u32 LE count = 2
  bytes.set(new Uint8Array(32).fill(0xab), 36); // body element
  return bytes;
})();

const INPUT_CAPACITY = 200n * 100_000_000n;

const plan = (overrides: Partial<Parameters<typeof planBoundUnlock>[0]> = {}) =>
  planBoundUnlock({
    ...SHAPE,
    inputCapacity: INPUT_CAPACITY,
    piBytes: PI_BYTES,
    ...overrides,
  });

const realProof = new Uint8Array(128).fill(0x7c);

const outputCapacityOf = (tx: ccc.Transaction) =>
  ccc.numFrom(tx.outputs[0].capacity);

describe("planBoundUnlock", () => {
  it("takes the fee out of the locked cell, leaving no change output", () => {
    const p = plan();
    expect(p.feeShannons).toBeGreaterThan(0n);
    expect(p.outputCapacity + p.feeShannons).toBe(INPUT_CAPACITY);
    expect(p.inputCapacity).toBe(INPUT_CAPACITY);
  });

  it("produces a 32-byte scalar whose top byte is zero", () => {
    const scalar = ccc.bytesFrom(plan().contextScalar);
    expect(scalar.length).toBe(32);
    expect(scalar[31]).toBe(0);
  });

  it("binds to the output capacity, so one shannon changes the scalar", () => {
    const a = plan();
    const b = plan({ inputCapacity: INPUT_CAPACITY + 1n });
    expect(b.outputCapacity).not.toBe(a.outputCapacity);
    expect(b.contextScalar).not.toBe(a.contextScalar);
  });

  it("binds to the recipient", () => {
    const other = plan({
      recipient: { ...SHAPE.recipient, args: `0x${"11".repeat(20)}` },
    });
    expect(other.contextScalar).not.toBe(plan().contextScalar);
  });

  it("binds to the cell being spent", () => {
    const other = plan({
      cell: { ...SHAPE.cell, index: 1 },
    });
    expect(other.contextScalar).not.toBe(plan().contextScalar);
  });

  it("refuses a cell too small to cover its own fee", () => {
    expect(() => plan({ inputCapacity: 1n })).toThrow(/too small/);
  });

  it("refuses a non-empty output 0 data field it cannot build", () => {
    expect(() =>
      plan({ outputData: new Uint8Array([1, 2, 3]) })
    ).toThrow(/empty output 0 data/);
  });
});

describe("buildBoundUnlockTx", () => {
  it("ships output 0 at exactly the capacity the proof was bound to", () => {
    const p = plan();
    const tx = buildBoundUnlockTx({
      ...SHAPE,
      plan: p,
      proofBytes: realProof,
      piBytes: PI_BYTES,
    });
    // This is the assertion the old implementation failed: it built output 0 at
    // the pre-fee capacity and let completeFeeBy append a change output.
    expect(outputCapacityOf(tx)).toBe(p.outputCapacity);
    expect(outputCapacityOf(tx)).not.toBe(INPUT_CAPACITY);
  });

  it("adds no second output and no extra input", () => {
    const tx = buildBoundUnlockTx({
      ...SHAPE,
      plan: plan(),
      proofBytes: realProof,
      piBytes: PI_BYTES,
    });
    expect(tx.outputs.length).toBe(1);
    expect(tx.inputs.length).toBe(1);
  });

  it("serializes to the size the plan charged a fee for", () => {
    // The plan measures with a 128-byte placeholder proof. If a real proof
    // changed the size, the fee would be wrong and the script would reject.
    const p = plan();
    const tx = buildBoundUnlockTx({
      ...SHAPE,
      plan: p,
      proofBytes: realProof,
      piBytes: PI_BYTES,
    });
    const size = BigInt(tx.toBytes().length);
    expect((size * 1_500n + 999n) / 1000n).toBe(p.feeShannons);
  });

  it("rejects a proof that is not 128 bytes", () => {
    const build = (len: number) =>
      buildBoundUnlockTx({
        ...SHAPE,
        plan: plan(),
        proofBytes: new Uint8Array(len),
        piBytes: PI_BYTES,
      });
    expect(() => build(127)).toThrow(/must be 128 bytes/);
    expect(() => build(129)).toThrow(/must be 128 bytes/);
  });

  it("carries proof then public inputs in witness.lock", () => {
    const tx = buildBoundUnlockTx({
      ...SHAPE,
      plan: plan(),
      proofBytes: realProof,
      piBytes: PI_BYTES,
    });
    const lock = tx.getWitnessArgsAt(0)?.lock;
    expect(lock).toBeDefined();
    // ccc hands back a Node Buffer, which toEqual will not match against a
    // plain Uint8Array, so compare the byte values rather than the containers.
    const bytes = Array.from(ccc.bytesFrom(lock!));
    expect(bytes.length).toBe(128 + PI_BYTES.length);
    expect(bytes.slice(0, 128)).toEqual(Array.from(realProof));
    expect(bytes.slice(128)).toEqual(Array.from(PI_BYTES));
  });
});

describe("the plan and the transaction cannot disagree", () => {
  it("keeps capacity, fee and input capacity consistent across both steps", () => {
    const p: BoundPlan = plan();
    const tx = buildBoundUnlockTx({
      ...SHAPE,
      plan: p,
      proofBytes: realProof,
      piBytes: PI_BYTES,
    });
    expect(outputCapacityOf(tx) + p.feeShannons).toBe(p.inputCapacity);
  });
});

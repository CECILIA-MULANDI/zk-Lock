import { ccc } from "@ckb-ccc/core";
import { PROOF_LEN } from "./encode.js";

const SHANNONS_PER_CKB = 100_000_000n;
const FEE_RATE_SHANNONS_PER_KB = 1_500n;

export async function deployVk(
  signer: ccc.Signer,
  vkBytes: Uint8Array
): Promise<{ txHash: `0x${string}`; index: number }> {
  const { script: senderLock } = await signer.getRecommendedAddressObj();
  const tx = ccc.Transaction.from({
    outputs: [{ lock: senderLock, capacity: 0 }],
    outputsData: [ccc.hexFrom(vkBytes)],
  });
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer);
  const txHash = await signer.sendTransaction(tx);
  return { txHash: txHash as `0x${string}`, index: 0 };
}

export async function lock(
  signer: ccc.Signer,
  params: {
    codeHash: `0x${string}`;
    vkHash: `0x${string}`;
    piCommitment: `0x${string}`;
    capacityCkb: bigint;
  }
): Promise<{ txHash: `0x${string}`; index: number }> {
  const args = ccc.hexFrom(
    ccc.bytesConcat(
      ccc.bytesFrom(params.vkHash),
      ccc.bytesFrom(params.piCommitment)
    )
  );
  const zkLockScript = ccc.Script.from({
    codeHash: params.codeHash,
    hashType: "type",
    args,
  });
  const tx = ccc.Transaction.from({
    outputs: [
      {
        lock: zkLockScript,
        capacity: params.capacityCkb * SHANNONS_PER_CKB,
      },
    ],
    outputsData: ["0x"],
  });
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer);
  const txHash = await signer.sendTransaction(tx);
  return { txHash: txHash as `0x${string}`, index: 0 };
}

export async function unlock(
  signer: ccc.Signer,
  params: {
    cell: ccc.OutPointLike;
    contractDep: ccc.OutPointLike;
    vkDep: ccc.OutPointLike;
    proofBytes: Uint8Array;
    piBytes: Uint8Array;
  }
): Promise<`0x${string}`> {
  const { script: recipientLock } = await signer.getRecommendedAddressObj();
  const client = signer.client;

  const live = await client.getCellLive(params.cell);
  if (!live) {
    throw new Error("zk-lock cell is not live (already spent or nonexistent)");
  }
  const inputCapacity = ccc.numFrom(live.cellOutput.capacity);

  const witnessLock = ccc.hexFrom(
    ccc.bytesConcat(params.proofBytes, params.piBytes)
  );

  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: params.cell }],
    outputs: [{ lock: recipientLock, capacity: inputCapacity }],
    outputsData: ["0x"],
    cellDeps: [
      { outPoint: params.contractDep, depType: "code" },
      { outPoint: params.vkDep, depType: "code" },
    ],
  });
  tx.setWitnessArgs(0, { lock: witnessLock });

  await tx.completeFeeBy(signer);
  return (await signer.sendTransaction(tx)) as `0x${string}`;
}

export async function lockBound(
  signer: ccc.Signer,
  params: {
    codeHash: `0x${string}`;
    vkHash: `0x${string}`;
    piCommitment: `0x${string}`;
    capacityCkb: bigint;
  }
): Promise<{ txHash: `0x${string}`; index: number }> {
  return lock(signer, params);
}

/**
 * The context scalar for `tx`: its transaction hash with the top byte cleared,
 * which keeps the value below the BN254 scalar modulus.
 *
 * `tx_hash` excludes the witnesses, so the real proof can go in afterwards
 * without moving the value it committed to. Hence the flow: assemble the
 * transaction with a zero-filled proof, prove against this scalar as public
 * input 0, swap the real proof in, send. The placeholder still needs the right
 * length, because length sets the fee, the fee sets output 0's capacity, and
 * capacity is inside `tx_hash`.
 *
 * Any transaction shape works. `planBoundUnlock` and `buildBoundUnlockTx` below
 * are a convenience for the common one-input, one-output unlock.
 */
export function boundContextScalar(tx: ccc.TransactionLike): `0x${string}` {
  const scalar = new Uint8Array(32);
  scalar.set(ccc.bytesFrom(ccc.Transaction.from(tx).hash()).slice(0, 31), 0);
  return ccc.hexFrom(scalar) as `0x${string}`;
}

type BoundTxShape = {
  cell: ccc.OutPointLike;
  contractDep: ccc.OutPointLike;
  vkDep: ccc.OutPointLike;
  recipient: ccc.ScriptLike;
  /** Output 0's data. Covered by `tx_hash` like everything else. */
  outputData?: ccc.BytesLike;
};

export type BoundPlan = {
  /**
   * The first public input. Feed this into the circuit as the context field
   * element before proving, ahead of the body inputs.
   */
  contextScalar: `0x${string}`;
  /** The capacity output 0 must carry. Nothing else will satisfy the script. */
  outputCapacity: bigint;
  feeShannons: bigint;
  inputCapacity: bigint;
};

function buildTx(
  shape: BoundTxShape,
  outputCapacity: bigint,
  witnessLock: ccc.Hex
): ccc.Transaction {
  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: shape.cell }],
    outputs: [{ lock: shape.recipient, capacity: outputCapacity }],
    outputsData: [
      shape.outputData === undefined ? "0x" : ccc.hexFrom(shape.outputData),
    ],
    cellDeps: [
      { outPoint: shape.contractDep, depType: "code" },
      { outPoint: shape.vkDep, depType: "code" },
    ],
  });
  tx.setWitnessArgs(0, { lock: witnessLock });
  return tx;
}

function feeFor(tx: ccc.Transaction): bigint {
  const sizeBytes = BigInt(tx.toBytes().length);
  return (sizeBytes * FEE_RATE_SHANNONS_PER_KB + 999n) / 1000n;
}

/**
 * Decides the fee, the output capacity, and the context scalar the circuit must
 * be given. Pure and synchronous, so it can be tested without a node.
 *
 * `piBytes` must be the public-input byte string at its FINAL length: u32 LE
 * count, then the 32-byte context slot, then the body elements. Only its length
 * matters here, because that is what sets the serialized transaction size and
 * therefore the fee, so the context slot can be left as zeroes on this call.
 */
export function planBoundUnlock(
  params: BoundTxShape & {
    inputCapacity: bigint;
    piBytes: Uint8Array;
  }
): BoundPlan {
  const witnessLock = ccc.hexFrom(
    ccc.bytesConcat(new Uint8Array(PROOF_LEN), params.piBytes)
  );

  // Built at the full capacity purely to measure the serialized size. The
  // witness is already its final length, so the size does not move when the
  // capacity does.
  const feeShannons = feeFor(buildTx(params, params.inputCapacity, witnessLock));
  if (params.inputCapacity <= feeShannons) {
    throw new Error("cell capacity is too small to cover the computed fee");
  }
  const outputCapacity = params.inputCapacity - feeShannons;

  // Built at `outputCapacity`, not `inputCapacity`: capacity is inside
  // `tx_hash`, so the scalar must come from the transaction that will be sent.
  const contextScalar = boundContextScalar(
    buildTx(params, outputCapacity, witnessLock)
  );

  return {
    contextScalar,
    outputCapacity,
    feeShannons,
    inputCapacity: params.inputCapacity,
  };
}

/**
 * Assembles the transaction a plan describes. Pure and synchronous, so a test
 * can assert that output 0 carries exactly the capacity the proof was bound to.
 */
export function buildBoundUnlockTx(
  params: BoundTxShape & {
    plan: BoundPlan;
    proofBytes: Uint8Array;
    piBytes: Uint8Array;
  }
): ccc.Transaction {
  if (params.proofBytes.length !== PROOF_LEN) {
    throw new Error(
      `proof must be ${PROOF_LEN} bytes, got ${params.proofBytes.length}`
    );
  }
  const witnessLock = ccc.hexFrom(
    ccc.bytesConcat(params.proofBytes, params.piBytes)
  );
  return buildTx(params, params.plan.outputCapacity, witnessLock);
}

/** Fetches the live cell's capacity, then plans against it. */
export async function computeContextHash(
  params: BoundTxShape & {
    client: ccc.Client;
    piBytes: Uint8Array;
  }
): Promise<BoundPlan> {
  const live = await params.client.getCellLive(params.cell, false);
  if (!live) {
    throw new Error("zk-lock cell is not live (already spent or nonexistent)");
  }
  return planBoundUnlock({
    ...params,
    inputCapacity: ccc.numFrom(live.cellOutput.capacity),
  });
}

/**
 * Sends a bound unlock.
 *
 * Takes a client and an explicit recipient rather than a signer. There is no
 * signature to produce, the fee comes out of the locked cell's own capacity, so
 * no funded wallet is needed; and the recipient is baked into the proof, so it
 * has to be chosen before proving rather than derived from a wallet at send
 * time. Deriving it here is what let the recipient silently disagree with the
 * one the context was computed for.
 */
export async function unlockBound(
  params: BoundTxShape & {
    client: ccc.Client;
    plan: BoundPlan;
    proofBytes: Uint8Array;
    piBytes: Uint8Array;
  }
): Promise<{
  txHash: `0x${string}`;
  feeShannons: bigint;
  outputCapacity: bigint;
}> {
  const live = await params.client.getCellLive(params.cell, false);
  if (!live) {
    throw new Error("zk-lock cell is not live (already spent or nonexistent)");
  }
  const inputCapacity = ccc.numFrom(live.cellOutput.capacity);
  if (inputCapacity !== params.plan.inputCapacity) {
    throw new Error(
      `the cell's capacity changed since the proof was built: bound to ${params.plan.inputCapacity}, now ${inputCapacity}`
    );
  }

  const tx = buildBoundUnlockTx(params);

  // The proof is already committed to plan.outputCapacity. If the real witness
  // serializes to a different size than the placeholder did, the fee this
  // transaction needs no longer matches the one the plan subtracted, and the
  // script would reject it. Fail here instead of spending the proof.
  const actualFee = feeFor(tx);
  if (actualFee !== params.plan.feeShannons) {
    throw new Error(
      `fee drifted from the bound plan: proof assumes ${params.plan.feeShannons} shannons, this transaction needs ${actualFee}. Rebuild the context and reprove.`
    );
  }

  const txHash = await params.client.sendTransaction(tx);
  return {
    txHash: txHash as `0x${string}`,
    feeShannons: params.plan.feeShannons,
    outputCapacity: params.plan.outputCapacity,
  };
}

import { ccc, hashCkb } from "@ckb-ccc/core";

const SHANNONS_PER_CKB = 100_000_000n;
const FEE_RATE_SHANNONS_PER_KB = 1_500n;
const PROOF_LEN = 128;

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

/*
 * The transaction-binding variant.
 *
 * zk-lock-bound commits the proof to the transaction it will be spent in. Its
 * first public input is
 *
 *   blake2b(out_point || blake2b(output_0_bytes || output_0_data))[..31]
 *
 * (see contracts/zk-lock-bound/src/main.rs). Output 0's capacity is part of
 * output_0_bytes, so the capacity used to compute the context MUST be the
 * capacity the transaction actually ships. If they differ by a single shannon
 * the hash differs completely and the script returns ContextMismatch.
 *
 * That is exactly what went wrong before: the context was computed against
 * `inputCapacity - fee`, the transaction was built at `inputCapacity`, and
 * `completeFeeBy` paid the fee by pulling in the signer's own cells and adding
 * a change output rather than shrinking output 0. Every bound unlock failed.
 *
 * The shape below exists so the two cannot drift. `planBoundUnlock` is the one
 * place the fee and the output capacity are decided, `buildBoundUnlockTx` is
 * the one place a transaction is assembled, and `unlockBound` refuses to send
 * if the plan it was given no longer matches the transaction it would build.
 */

type BoundTxShape = {
  cell: ccc.OutPointLike;
  contractDep: ccc.OutPointLike;
  vkDep: ccc.OutPointLike;
  recipient: ccc.ScriptLike;
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
    outputsData: ["0x"],
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
    /** Output 0's data. The script hashes it, so it is part of the binding. */
    outputData?: Uint8Array;
  }
): BoundPlan {
  const outputData = params.outputData ?? new Uint8Array(0);
  if (outputData.length !== 0) {
    // buildTx hard-codes `outputsData: ["0x"]`, so a non-empty binding here
    // would describe a transaction this module cannot build.
    throw new Error(
      "planBoundUnlock only supports an empty output 0 data field"
    );
  }

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

  const outputCell = ccc.CellOutput.from({
    capacity: outputCapacity,
    lock: params.recipient,
  });

  // The script hashes the cell bytes and the data as two updates of one
  // blake2b. ccc's `CellOutput.hash()` covers only the cell bytes, so it agrees
  // with the script purely because output 0 carries no data. Concatenating
  // explicitly keeps that from being a silent coincidence.
  const firstOutHash = hashCkb(
    ccc.bytesConcat(outputCell.toBytes(), outputData)
  );

  const outPoint = ccc.OutPoint.from(params.cell);
  const full = ccc.bytesFrom(
    hashCkb(ccc.bytesConcat(outPoint.toBytes(), ccc.bytesFrom(firstOutHash)))
  );

  // The script compares 31 bytes and leaves the top byte zero, keeping the
  // value below the BN254 scalar modulus so it is a valid field element.
  const scalar = new Uint8Array(32);
  scalar.set(full.slice(0, 31), 0);

  return {
    contextScalar: ccc.hexFrom(scalar) as `0x${string}`,
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

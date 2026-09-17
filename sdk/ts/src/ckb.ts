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

export async function unlockBound(
  signer: ccc.Signer,
  params: {
    cell: ccc.OutPointLike;
    contractDep: ccc.OutPointLike;
    vkDep: ccc.OutPointLike;
    proofBytes: Uint8Array;
    piBytes: Uint8Array;
    recipient?: ccc.ScriptLike;
  }
): Promise<`0x${string}`> {
  const recipient = params.recipient
    ? ccc.Script.from(params.recipient)
    : (await signer.getRecommendedAddressObj()).script;
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
    outputs: [{ lock: recipient, capacity: inputCapacity }],
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

export async function computeContextHash(
  signer: ccc.Signer,
  params: {
    cell: ccc.OutPointLike;
    contractDep: ccc.OutPointLike;
    vkDep: ccc.OutPointLike;
    piBytes: Uint8Array;
    recipient?: ccc.ScriptLike;
  }
): Promise<`0x${string}`> {
  const recipient = params.recipient
    ? ccc.Script.from(params.recipient)
    : (await signer.getRecommendedAddressObj()).script;

  const client = signer.client;
  const live = await client.getCellLive(params.cell);
  if (!live) {
    throw new Error("zk-lock cell is not live");
  }
  const inputCapacity = ccc.numFrom(live.cellOutput.capacity);

  const placeholderProof = new Uint8Array(PROOF_LEN);
  const witnessLock = ccc.hexFrom(
    ccc.bytesConcat(placeholderProof, params.piBytes)
  );

  const buildTx = (outputCapacity: bigint) => {
    const t = ccc.Transaction.from({
      inputs: [{ previousOutput: params.cell }],
      outputs: [{ lock: recipient, capacity: outputCapacity }],
      outputsData: ["0x"],
      cellDeps: [
        { outPoint: params.contractDep, depType: "code" },
        { outPoint: params.vkDep, depType: "code" },
      ],
    });
    t.setWitnessArgs(0, { lock: witnessLock });
    return t;
  };

  const placeholder = buildTx(inputCapacity);
  const txSize = BigInt(placeholder.toBytes().length);
  const fee = (txSize * FEE_RATE_SHANNONS_PER_KB + 999n) / 1000n;
  if (inputCapacity <= fee) {
    throw new Error("cell capacity is too small to cover the computed fee");
  }
  const outputCapacity = inputCapacity - fee;

  const outputCell = ccc.CellOutput.from({
    capacity: outputCapacity,
    lock: recipient,
  });
  const firstOutHash = outputCell.hash();

  const outPoint = ccc.OutPoint.from(params.cell);
  const ctxBuf = ccc.bytesConcat(
    outPoint.toBytes(),
    ccc.bytesFrom(firstOutHash)
  );
  const full = ccc.bytesFrom(hashCkb(ctxBuf));

  const scalar = new Uint8Array(32);
  scalar.set(full.slice(0, 31), 0);
  return ccc.hexFrom(scalar) as `0x${string}`;
}

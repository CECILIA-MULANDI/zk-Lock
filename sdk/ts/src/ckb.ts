import { ccc } from "@ckb-ccc/core";

const UNLOCK_FEE_SHANNONS = 1_000n;
const SHANNONS_PER_CKB = 100_000_000n;

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
  if (inputCapacity <= UNLOCK_FEE_SHANNONS) {
    throw new Error("zk-lock cell capacity is less than the fixed fee");
  }
  const outputCapacity = inputCapacity - UNLOCK_FEE_SHANNONS;

  const witnessLock = ccc.hexFrom(
    ccc.bytesConcat(params.proofBytes, params.piBytes)
  );

  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: params.cell }],
    outputs: [{ lock: recipientLock, capacity: outputCapacity }],
    outputsData: ["0x"],
    cellDeps: [
      { outPoint: params.contractDep, depType: "code" },
      { outPoint: params.vkDep, depType: "code" },
    ],
  });
  tx.setWitnessArgs(0, { lock: witnessLock });

  return (await client.sendTransaction(tx)) as `0x${string}`;
}

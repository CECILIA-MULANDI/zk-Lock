import { ccc } from "@ckb-ccc/core";
import { CONTRACT_DEP, DEMO_CELLS, VK_DEP } from "./config";

/**
 * Walletless unlock.
 *
 * A zk-Lock cell's lock script is the proof: there is no signature to produce,
 * so no key and no wallet are needed. The transaction fee comes out of the
 * locked cell's own capacity, so no funding input is needed either. One input,
 * one output, two cell deps, and the proof in witness.lock.
 *
 * A direct port of cli/src/unlock.rs, which is the reference for the fee
 * arithmetic. The SDK's `unlock` takes a signer and calls `completeFeeBy`,
 * which appends a change output instead of shrinking output 0, forcing a
 * funded wallet this demo exists to avoid.
 */

const FEE_RATE_SHANNONS_PER_KB = 1_500n;

export const client = new ccc.ClientPublicTestnet();

export type UnlockTarget = {
  cell: { txHash: string; index: number };
  capacityShannons: bigint;
};

/** Finds the first demo cell that is still live. They are spendable once each. */
export async function findLiveDemoCell(): Promise<UnlockTarget | null> {
  for (const cell of DEMO_CELLS) {
    const live = await client.getCellLive(
      { txHash: cell.txHash, index: cell.index },
      false
    );
    if (live) {
      return {
        cell,
        capacityShannons: ccc.numFrom(live.cellOutput.capacity),
      };
    }
  }
  return null;
}

/** Resolves a testnet address string to the lock script that receives the CKB. */
export async function resolveRecipient(
  address: string
): Promise<ccc.ScriptLike> {
  const parsed = await ccc.Address.fromString(address.trim(), client);
  return parsed.script;
}

export type UnlockResult = {
  txHash: `0x${string}`;
  feeShannons: bigint;
  outputCapacityShannons: bigint;
};

export async function unlockWithProof(params: {
  cell: { txHash: string; index: number };
  recipient: ccc.ScriptLike;
  proofBytes: Uint8Array;
  piBytes: Uint8Array;
}): Promise<UnlockResult> {
  const outPoint = { txHash: params.cell.txHash, index: params.cell.index };

  const live = await client.getCellLive(outPoint, false);
  if (!live) {
    throw new Error(
      "That cell has already been spent. Someone got there first, or the pool needs refilling."
    );
  }
  const inputCapacity = ccc.numFrom(live.cellOutput.capacity);

  const witnessLock = ccc.hexFrom(
    ccc.bytesConcat(params.proofBytes, params.piBytes)
  );

  const build = (outputCapacity: bigint) => {
    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: outPoint }],
      outputs: [{ lock: params.recipient, capacity: outputCapacity }],
      outputsData: ["0x"],
      cellDeps: [
        {
          outPoint: { txHash: CONTRACT_DEP.txHash, index: CONTRACT_DEP.index },
          depType: "code",
        },
        {
          outPoint: { txHash: VK_DEP.txHash, index: VK_DEP.index },
          depType: "code",
        },
      ],
    });
    tx.setWitnessArgs(0, { lock: witnessLock });
    return tx;
  };

  // Build once at full capacity purely to measure the serialized size, then
  // charge the fee against those real bytes. The witness is already its final
  // length, so the size does not change when the capacity does.
  const placeholder = build(inputCapacity);
  const txSizeBytes = BigInt(placeholder.toBytes().length);
  const feeShannons =
    (txSizeBytes * FEE_RATE_SHANNONS_PER_KB + 999n) / 1000n;

  if (inputCapacity <= feeShannons) {
    throw new Error("The cell's capacity cannot cover the transaction fee.");
  }
  const outputCapacityShannons = inputCapacity - feeShannons;

  const txHash = await client.sendTransaction(build(outputCapacityShannons));
  return {
    txHash: txHash as `0x${string}`,
    feeShannons,
    outputCapacityShannons,
  };
}

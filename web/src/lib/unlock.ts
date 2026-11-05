import { ccc } from "@ckb-ccc/core";
import {
  CONTRACT_DEP,
  DEFAULT_RECIPIENT_ADDRESS,
  DEMO_CELLS,
  DEMO_LOCK,
  DRY_RUN_CELL,
  VK_DEP,
} from "./config";

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

/** Identifies a cell in the `skip` set below. */
export const outPointKey = (cell: { txHash: string; index: number }) =>
  `${cell.txHash}:${cell.index}`;

/**
 * Finds a demo cell that is still live. They are spendable once each.
 *
 * Asks the indexer for cells carrying DEMO_LOCK rather than walking a list in
 * the source. That is what makes refilling a `lock` call instead of a release:
 * a cell sent to that lock is in the pool the moment it is indexed, with no
 * edit here and no redeploy. DEMO_CELLS is only consulted if the query fails.
 *
 * `skip` exists because liveness lags reality: a cell whose spend is sitting
 * in the mempool still reads as live until that transaction is mined, so
 * without it a second attempt would keep picking the cell it just lost and
 * "try again" would never get anywhere.
 */
export async function findLiveDemoCell(
  skip: ReadonlySet<string> = new Set()
): Promise<UnlockTarget | null> {
  const reserved = outPointKey(DRY_RUN_CELL);

  try {
    for await (const found of client.findCellsByLock(
      ccc.Script.from(DEMO_LOCK),
      null,
      true
    )) {
      const cell = {
        txHash: found.outPoint.txHash,
        index: Number(found.outPoint.index),
      };
      // The dry run's input carries the same lock, so it shows up here. It is
      // the one cell that must survive, so it is never offered to the spender.
      const key = outPointKey(cell);
      if (key === reserved || skip.has(key)) continue;
      return { cell, capacityShannons: ccc.numFrom(found.cellOutput.capacity) };
    }
    return null;
  } catch {
    // Indexer unreachable. Fall back to the pinned list rather than telling a
    // visitor the pool is empty when it may not be.
    for (const cell of DEMO_CELLS) {
      const key = outPointKey(cell);
      if (key === reserved || skip.has(key)) continue;
      const live = await client.getCellLive(
        { txHash: cell.txHash, index: cell.index },
        false
      );
      if (live) {
        return { cell, capacityShannons: ccc.numFrom(live.cellOutput.capacity) };
      }
    }
    return null;
  }
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

type UnlockPlan = {
  tx: ccc.Transaction;
  feeShannons: bigint;
  outputCapacityShannons: bigint;
};

/**
 * Builds the spend transaction without sending it.
 *
 * Shared by the real unlock and the dry run so the bytes a node is asked to
 * judge are the same bytes that would be broadcast. A dry run against a
 * differently-built transaction would prove nothing about the real one.
 */
async function planUnlock(params: {
  cell: { txHash: string; index: number };
  recipient: ccc.ScriptLike;
  proofBytes: Uint8Array;
  piBytes: Uint8Array;
  /** Why this particular cell being gone matters, which differs per caller. */
  missingMessage: string;
}): Promise<UnlockPlan> {
  const outPoint = { txHash: params.cell.txHash, index: params.cell.index };

  const live = await client.getCellLive(outPoint, false);
  if (!live) {
    throw new Error(params.missingMessage);
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

  return {
    tx: build(outputCapacityShannons),
    feeShannons,
    outputCapacityShannons,
  };
}

export async function unlockWithProof(params: {
  cell: { txHash: string; index: number };
  recipient: ccc.ScriptLike;
  proofBytes: Uint8Array;
  piBytes: Uint8Array;
}): Promise<UnlockResult> {
  const plan = await planUnlock({
    ...params,
    missingMessage:
      "Someone opened that one a moment ago. Press the button again to take the next cell.",
  });

  let txHash: string;
  try {
    txHash = await client.sendTransaction(plan.tx);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    // Not a failure. The node is saying this exact transaction is already in
    // its pool, which can only happen if it was accepted a moment ago: an
    // unlock has no signature and no nonce, so rebuilding it from the same
    // cell, recipient and proof produces byte-identical bytes. The spend
    // happened. Reporting it as an error would be telling the visitor their
    // coins did not move while the chain disagrees.
    if (/already exists in transaction_pool|Duplicated/i.test(message)) {
      return {
        txHash: plan.tx.hash() as `0x${string}`,
        feeShannons: plan.feeShannons,
        outputCapacityShannons: plan.outputCapacityShannons,
      };
    }

    // Keep the node's exact words for whoever is debugging, and give the
    // visitor a sentence instead.
    console.error("sendTransaction failed", cause);
    throw new Error(describeSendFailure(message));
  }

  return {
    txHash: txHash as `0x${string}`,
    feeShannons: plan.feeShannons,
    outputCapacityShannons: plan.outputCapacityShannons,
  };
}

/**
 * Turns a node's rejection into something a visitor can act on.
 *
 * Nothing here should ever surface an RPC type name. If a case is not
 * recognised the fallback still says what it means for the visitor rather than
 * pasting the transport error into the page.
 */
function describeSendFailure(message: string): string {
  if (/Dead|dead cell|conflict|double.?spend/i.test(message)) {
    return "Someone opened that cell first. Press the button again to take the next one.";
  }
  if (/ValidationFailure|TransactionFailedToVerify|script/i.test(message)) {
    return "The chain refused the transaction, which should not happen for a proof the node already accepted. Nothing moved.";
  }
  if (/fetch|network|Failed to fetch|timeout|ECONN/i.test(message)) {
    return "Could not reach a Pudge node. Nothing was sent, so nothing moved. Check your connection and try again.";
  }
  if (/capacity|fee/i.test(message)) {
    return "The cell could not cover its own fee, so the transaction was not sent.";
  }
  return "The node refused the transaction, so nothing moved. Nothing was spent and your proof is unaffected.";
}

/**
 * Exit codes from `crates/zk-lock-core/src/error.rs`. They are consensus
 * visible, so a node reports the same number the enum declares, and this is a
 * lookup rather than a guess.
 */
const SCRIPT_ERRORS: Record<number, string> = {
  10: "the lock args were not 64 bytes",
  11: "the witness carried no lock field",
  12: "the witness lock was too short to hold a proof",
  13: "the public input length did not match the declared count",
  14: "no verifying key cell was found among the cell deps",
  15: "the public inputs did not hash to the commitment in lock.args",
  16: "the verifying key bytes did not deserialize",
  17: "the proof bytes did not deserialize",
  18: "the public input bytes did not deserialize",
  19: "the proof had a different number of public inputs than the key expects",
  20: "the pairing check failed, so the proof is not valid for these inputs",
  21: "more than one cell dep carried the verifying key",
  22: "the transaction context scalar did not match this transaction",
  23: "a bound proof needs at least one public input",
};

/** The verdict, or the fact that a node has not answered yet. */
export type DryRunState = "running" | DryRunResult;

export type DryRunResult =
  | { ok: true; cycles: bigint }
  | { ok: false; code: number | null; reason: string };

/**
 * Asks a CKB node to run the deployed lock script against this proof, without
 * broadcasting anything.
 *
 * `estimate_cycles` executes every script in the transaction and returns the
 * cycle count, or the script's own exit code if one rejects. That makes it a
 * real verdict from the real binary, and because nothing is sent, the cell it
 * references is never consumed. One reserved cell serves every visitor forever,
 * which is why this path does not run out the way spending does.
 */
export async function dryRunProof(params: {
  proofBytes: Uint8Array;
  piBytes: Uint8Array;
}): Promise<DryRunResult> {
  if (!DEFAULT_RECIPIENT_ADDRESS) {
    throw new Error("No recipient address is configured for the dry run.");
  }
  const recipient = await resolveRecipient(DEFAULT_RECIPIENT_ADDRESS);
  const plan = await planUnlock({
    cell: DRY_RUN_CELL,
    recipient,
    proofBytes: params.proofBytes,
    piBytes: params.piBytes,
    // Nothing should ever spend this one, so if it is gone that is a broken
    // deployment, not an exhausted giveaway. Do not blame the pool for it.
    missingMessage:
      "the reserved cell this check runs against is gone, so the demo needs attention",
  });

  try {
    return { ok: true, cycles: ccc.numFrom(await client.estimateCycles(plan.tx)) };
  } catch (cause) {
    // The node reports the failing script's exit code in its message. Pull the
    // number out rather than showing the reader a Rust debug struct.
    const message = cause instanceof Error ? cause.message : String(cause);
    const code = Number(/error code (-?\d+)/.exec(message)?.[1] ?? NaN);
    if (Number.isNaN(code)) {
      return { ok: false, code: null, reason: message };
    }
    return {
      ok: false,
      code,
      reason: SCRIPT_ERRORS[code] ?? `the script exited with code ${code}`,
    };
  }
}

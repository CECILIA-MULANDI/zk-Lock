import { useState } from "react";
import type { Attempt } from "../lib/prove";
import {
  DEFAULT_RECIPIENT_ADDRESS,
  DEMO_CELLS,
  DEMO_PI_COMMITMENT,
  DEMO_SECRET,
  explorerTx,
} from "../lib/config";
// Type-only: erased at build time, so this does not drag ccc into the bundle.
// The module itself is imported on demand in the submit handler below.
import type { UnlockResult } from "../lib/unlock";

/**
 * A wrong secret still produces a valid Groth16 proof; it just proves a
 * different statement. The failure is a commitment mismatch, not a bad proof,
 * so this must not present it as one.
 */
const SHANNONS_PER_CKB = 100_000_000n;

const ckb = (shannons: bigint) =>
  `${(Number(shannons) / Number(SHANNONS_PER_CKB)).toFixed(4)} CKB`;

function Commitment({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="font-mono text-micro tracking-[0.12em] text-muted uppercase">
        {label}
      </p>
      <p className="mt-2 font-mono text-note break-all">{value}</p>
    </div>
  );
}

export function LockCheck({ attempt }: { attempt: Attempt }) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UnlockResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const matches =
    attempt.piCommitment.toLowerCase() === DEMO_PI_COMMITMENT.toLowerCase();

  if (!matches) {
    return (
      <section className="rounded-xl border border-held/30 bg-held/7 p-6 sm:p-8">
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <h2 className="font-display text-panel font-bold text-held">
              The lock held
            </h2>
            <p className="mt-4 text-lead">
              <strong className="font-semibold">Your proof is valid.</strong> It
              just proves the wrong thing.
            </p>
            <p className="mt-4 text-copy text-muted">
              A zk-Lock cell commits to one specific digest, written into its{" "}
              <code className="font-mono">lock.args</code> when it is
              locked and fixed from then on. You produced a correct proof that
              you know the preimage of a <em>different</em> digest. The script
              compares the two and stops. Nothing moves, and nobody learned your
              word.
            </p>
            <p className="mt-5 text-note text-muted">
              Try <code className="font-mono text-private">{DEMO_SECRET}</code>{" "}
              to see the other outcome.
            </p>
          </div>
          <div className="space-y-6">
            <Commitment label="Required commitment" value={DEMO_PI_COMMITMENT} />
            <Commitment
              label="Your proof's commitment"
              value={attempt.piCommitment}
            />
          </div>
        </div>
      </section>
    );
  }

  if (DEMO_CELLS.length === 0) {
    return (
      <section className="rounded-xl border border-hairline bg-surface p-6 sm:p-8">
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <h2 className="font-display text-panel font-bold">
              This proof would open the lock
            </h2>
            <p className="mt-4 text-lead">
              Your proof commits to exactly the digest a cell locked behind this
              secret would require, so it would spend one.
            </p>
            <p className="mt-4 text-copy text-muted">
              No cell has been locked behind this secret yet, so there is
              nothing on chain to spend right now. Everything above was real
              regardless: a real Groth16 proof over BN254, generated in this tab
              and verified against the same verifying key the on-chain script
              loads from its cell dep.
            </p>
          </div>
          <div className="space-y-6">
            <Commitment label="Required commitment" value={DEMO_PI_COMMITMENT} />
            <Commitment
              label="Your proof's commitment"
              value={attempt.piCommitment}
            />
          </div>
        </div>
      </section>
    );
  }

  if (result) {
    return (
      <section className="rounded-xl border border-pass/30 bg-pass/7 p-6 sm:p-8">
        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <h2 className="font-display text-panel font-bold text-pass">
              Unlocked
            </h2>
            <p className="mt-4 text-lead">
              The cell is spent. No signature was involved: the proof was the
              only thing standing between that CKB and whoever could produce
              one.
            </p>
            <p className="mt-5 text-note text-muted">
              The fee came out of the locked cell itself, which is why this
              needed no wallet and no funds of yours.
            </p>
          </div>
          <dl className="space-y-3">
            <div>
              <dt className="text-micro text-muted">Transaction</dt>
              <dd className="mt-1">
                <a
                  href={explorerTx(result.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-note break-all text-public underline"
                >
                  {result.txHash}
                </a>
              </dd>
            </div>
            <div className="flex gap-8">
              <div>
                <dt className="text-micro text-muted">Sent on</dt>
                <dd className="mt-1 font-mono text-note">
                  {ckb(result.outputCapacityShannons)}
                </dd>
              </div>
              <div>
                <dt className="text-micro text-muted">Fee</dt>
                <dd className="mt-1 font-mono text-note">
                  {ckb(result.feeShannons)}
                </dd>
              </div>
            </div>
          </dl>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-hairline bg-surface p-6 sm:p-8">
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <h2 className="font-display text-panel font-bold">
            This proof opens the lock
          </h2>
          <p className="mt-4 text-lead text-muted">
            Your commitment matches the one the cell was locked with. Spending
            it needs no wallet and no CKB of your own: a zk-Lock cell has no
            signature to produce, and the fee comes out of the cell's own
            capacity.
          </p>
        </div>

        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const { findLiveDemoCell, resolveRecipient, unlockWithProof } =
                await import("../lib/unlock");
              const target = await findLiveDemoCell();
              if (!target) {
                throw new Error(
                  "Every cell in the pool has been spent. It needs refilling.",
                );
              }
              // Blank is the normal case: requiring an address would gate the
              // demo on the wallet it exists to avoid.
              const destination = address.trim() || DEFAULT_RECIPIENT_ADDRESS;
              if (!destination) {
                throw new Error(
                  "Paste a Pudge testnet address to receive the CKB.",
                );
              }
              const recipient = await resolveRecipient(destination);
              setResult(
                await unlockWithProof({
                  cell: target.cell,
                  recipient,
                  proofBytes: attempt.proofBytes,
                  piBytes: attempt.piBytes,
                }),
              );
            } catch (cause) {
              setError(
                cause instanceof Error ? cause.message : "The unlock failed.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label
            htmlFor="recipient"
            className="block text-copy font-semibold text-ink"
          >
            Where should the CKB go?{" "}
            {DEFAULT_RECIPIENT_ADDRESS && (
              <span className="font-normal text-muted">(optional)</span>
            )}
          </label>
          <div className="mt-2 flex flex-wrap items-start gap-3">
            <input
              id="recipient"
              name="recipient"
              type="text"
              value={address}
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              placeholder="ckt1…"
              onChange={(event) => setAddress(event.target.value)}
              className="w-full max-w-md rounded-lg border border-hairline bg-paper px-4 py-3 font-mono text-note outline-none focus:border-public focus:ring-2 focus:ring-public/25 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={
                busy ||
                (address.trim().length === 0 && !DEFAULT_RECIPIENT_ADDRESS)
              }
              className="rounded-lg bg-public px-6 py-3.5 text-copy font-semibold text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Unlocking…" : "Unlock the cell"}
            </button>
          </div>
          <p className="mt-3 text-note text-muted">
            {DEFAULT_RECIPIENT_ADDRESS
              ? "Leave this blank and the test coins return to the wallet that funded this demo, which is how it gets refilled. If you already have a Pudge address and want to keep them, paste it in."
              : "Paste a Pudge testnet address."}{" "}
            Either way you are receiving coins, not spending them, so there is
            nothing to set up first.
          </p>
          {error && (
            <p role="alert" className="mt-4 text-note font-semibold text-held">
              {error}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

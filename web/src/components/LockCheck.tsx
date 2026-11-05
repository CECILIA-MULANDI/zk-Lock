import { useEffect, useRef, useState } from "react";
import { LockGlyph } from "./Nav";
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
import type { DryRunState, UnlockResult } from "../lib/unlock";

/**
 * A wrong secret still produces a valid Groth16 proof; it just proves a
 * different statement. The failure is a commitment mismatch, not a bad proof,
 * so this must not present it as one.
 */
const SHANNONS_PER_CKB = 100_000_000n;

/**
 * Exact, in integer arithmetic, to 8 decimals with trailing zeros trimmed.
 *
 * A fixed 4 decimals printed a real fee of 0.00000731 CKB as "0.0000", right
 * below the sentence saying the fee came out of the cell. Going through Number
 * would also lose precision on a capacity large enough to matter.
 */
const ckb = (shannons: bigint) => {
  const whole = shannons / SHANNONS_PER_CKB;
  const frac = (shannons % SHANNONS_PER_CKB)
    .toString()
    .padStart(8, "0")
    .replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""} CKB`;
};

const CONFETTI_COLOURS = [
  "var(--color-public)",
  "var(--color-private)",
  "var(--color-dot)",
  "var(--color-pass)",
  "var(--color-ink)",
];

/**
 * A burst of paper, computed once at module load.
 *
 * Deterministic rather than Math.random: the same seed every time means the
 * burst is identical across renders, so React re-rendering the panel cannot
 * make the pieces jump to new positions mid-flight, and a screenshot of it is
 * reproducible. Plain divs, so there is no canvas and no new dependency.
 */
const CONFETTI = Array.from({ length: 48 }, (_, index) => {
  const rand = (salt: number) => {
    const x = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  return {
    left: rand(1) * 100,
    dx: (rand(2) - 0.5) * 260,
    dy: 220 + rand(3) * 320,
    spin: (rand(4) - 0.5) * 1260,
    delay: rand(5) * 420,
    duration: 1500 + rand(6) * 1200,
    width: 5 + rand(7) * 6,
    height: 9 + rand(8) * 8,
    colour: CONFETTI_COLOURS[index % CONFETTI_COLOURS.length],
    round: rand(9) > 0.68,
  };
});

function Confetti() {
  return (
    <div className="zkl-confetti" aria-hidden="true">
      {CONFETTI.map((piece, index) => (
        <span
          key={index}
          className="zkl-confetti-piece"
          style={
            {
              left: `${piece.left}%`,
              width: `${piece.width}px`,
              height: `${piece.round ? piece.width : piece.height}px`,
              background: piece.colour,
              borderRadius: piece.round ? "999px" : "1px",
              "--zkl-dx": `${piece.dx}px`,
              "--zkl-dy": `${piece.dy}px`,
              "--zkl-spin": `${piece.spin}deg`,
              "--zkl-delay": `${piece.delay}ms`,
              "--zkl-duration": `${piece.duration}ms`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * The verdict from a real CKB node, which is the only party on this page whose
 * opinion is authoritative. Everything else the demo shows is this browser
 * talking about itself.
 */
function NodeVerdict({ state }: { state: DryRunState }) {
  if (state === "running") {
    return (
      <p className="mt-6 border-t border-hairline pt-5 text-note text-muted">
        Asking a CKB node to run the lock script…
      </p>
    );
  }

  return (
    <div className="mt-6 border-t border-hairline pt-5">
      <p className="eyebrow text-muted">
        Checked by a CKB node
      </p>
      {state.ok ? (
        <p className="mt-2 text-note">
          <strong className="font-semibold text-pass">Accepted.</strong> A node
          on Pudge loaded the deployed script from its cell dep, ran it against
          this proof, and it passed in{" "}
          <span className="font-mono">{state.cycles.toLocaleString()}</span>{" "}
          cycles. Nothing was broadcast, so no cell was spent.
        </p>
      ) : (
        <p className="mt-2 text-note">
          <strong className="font-semibold text-held">Rejected</strong>
          {state.code !== null && (
            <>
              {" "}
              with exit code{" "}
              <span className="font-mono text-held">{state.code}</span>
            </>
          )}
          : {state.reason}. That verdict is the on-chain script's own, not this
          page's.
        </p>
      )}
    </div>
  );
}

function Commitment({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow text-muted">
        {label}
      </p>
      <p className="mt-2 font-mono text-note break-all">{value}</p>
    </div>
  );
}

export function LockCheck({
  attempt,
  dry,
}: {
  attempt: Attempt;
  dry: DryRunState;
}) {
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UnlockResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<"checking" | "live" | "empty">(
    DEMO_CELLS.length === 0 ? "empty" : "checking"
  );
  /** Cells this tab has already sent against, so a retry moves on. */
  const tried = useRef<Set<string>>(new Set());

  const matches =
    attempt.piCommitment.toLowerCase() === DEMO_PI_COMMITMENT.toLowerCase();

  // Whether a cell is still spendable is a fact about the chain, not about the
  // build: DEMO_CELLS stays five entries long after all five are spent. Ask
  // before offering a button, so the page never promises an unlock it cannot
  // perform and then blames the person who clicked.
  useEffect(() => {
    if (!matches || DEMO_CELLS.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const { findLiveDemoCell } = await import("../lib/unlock");
        const target = await findLiveDemoCell();
        if (!cancelled) setPool(target ? "live" : "empty");
      } catch {
        // A lookup that failed is not a pool that is empty. Leave the form up
        // and let the submit handler report the real error.
        if (!cancelled) setPool("live");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [matches]);

  if (!matches) {
    return (
      <section className="rounded-[14px] border-2 border-ink bg-white p-[clamp(28px,2.4vw,40px)]">
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
        <NodeVerdict state={dry} />
      </section>
    );
  }

  if (pool === "empty" && DEMO_CELLS.length === 0) {
    return (
      <section className="rounded-[14px] border-2 border-ink bg-white p-[clamp(28px,2.4vw,40px)]">
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <h2 className="font-display text-panel font-bold">
              This proof would open the lock
            </h2>
            <p className="mt-4 text-lead">
              Your proof commits to exactly the digest a cell locked behind this
              secret would require, so it would spend one.
            </p>
            {/* This branch is only reached with an empty DEMO_CELLS, which
                means nothing was ever locked behind the word. The spent case
                keeps the form up and explains itself there. */}
            <p className="mt-4 text-copy text-muted">
              Nothing has been locked behind this word yet, so there is nothing
              on chain for the proof to open. Everything above was real
              regardless: a real Groth16 proof over BN254, generated in this tab
              and checked against the same verifying key the on-chain script
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
        <NodeVerdict state={dry} />
      </section>
    );
  }

  if (result) {
    return (
      <section className="zkl-unlocked relative overflow-hidden rounded-[14px] border-2 border-public bg-white p-[clamp(28px,2.4vw,40px)]">
        <Confetti />
        <div className="relative grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            {/* The glyph is shrink-0 and nudged down a little so it sits with
                the first line rather than centring itself against a headline
                that wraps to two or three lines on a narrow screen. */}
            <h2 className="zkl-cheer flex items-start gap-3 font-display text-feature font-extrabold text-pass">
              <LockGlyph
                size={38}
                stroke="currentColor"
                width={2.2}
                shackleClassName="zkl-shackle"
                className="mt-0.5 shrink-0"
              />
              <span className="min-w-0">Hurray! You unlocked the cell</span>
            </h2>
            <p className="zkl-rise zkl-rise-1 mt-4 text-lead font-semibold">
              The CKB is on its way.
            </p>
            <p className="zkl-rise zkl-rise-2 mt-3 text-copy text-muted">
              No signature was involved: the proof was the only thing standing
              between that CKB and whoever could produce one.
            </p>
            <p className="zkl-rise zkl-rise-3 mt-5 text-note text-muted">
              The fee came out of the locked cell itself, which is why this
              needed no wallet and no funds of yours.
            </p>
          </div>
          <dl className="zkl-rise zkl-rise-3 space-y-3">
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
    <section className="rounded-[14px] border-2 border-ink bg-white p-[clamp(28px,2.4vw,40px)]">
      <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          {/*
            Matching the commitment is necessary but not sufficient: the
            pairing check runs after it, and only the script's verdict settles
            whether the lock opens. So the heading claims the match until a
            node has actually said yes.
          */}
          <h2 className="font-display text-panel font-bold">
            {dry !== "running" && dry.ok
              ? "This proof opens the lock"
              : "Your commitment matches"}
          </h2>
          <p className="mt-4 text-lead text-muted">
            It is the same digest the cell was locked with. Spending it needs
            no wallet and no CKB of your own: a zk-Lock cell has no signature
            to produce, and the fee comes out of the cell's own capacity.
          </p>
        </div>

        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const {
                findLiveDemoCell,
                outPointKey,
                resolveRecipient,
                unlockWithProof,
              } = await import("../lib/unlock");
              const target = await findLiveDemoCell(tried.current);
              if (!target) {
                throw new Error(
                  "Every coin this demo had to give away has been claimed. Your proof still worked: a node accepted it below.",
                );
              }
              // Claim it for this tab before sending. If the send loses a race
              // the next press moves on instead of retrying the same cell,
              // which the chain would still report as live for a minute.
              tried.current.add(outPointKey(target.cell));
              // Blank is the normal case: requiring an address would gate the
              // demo on the wallet it exists to avoid.
              const destination = address.trim() || DEFAULT_RECIPIENT_ADDRESS;
              if (!destination) {
                throw new Error(
                  "Paste a Pudge testnet address to receive the CKB.",
                );
              }
              // ccc's parse errors name internal types, so this one is
              // translated here rather than being shown as thrown.
              let recipient;
              try {
                recipient = await resolveRecipient(destination);
              } catch {
                throw new Error(
                  "That does not look like a Pudge testnet address. They start with ckt1. Leave the box empty to skip it.",
                );
              }
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
                cause instanceof Error
                  ? cause.message
                  : "The unlock did not go through, and nothing was spent.",
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
                pool !== "live" ||
                (address.trim().length === 0 && !DEFAULT_RECIPIENT_ADDRESS)
              }
              title={
                pool === "empty"
                  ? "Every coin this demo had to give away has been claimed."
                  : undefined
              }
              className="rounded-lg bg-public px-6 py-3.5 text-copy font-semibold text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? "Unlocking…"
                : pool === "checking"
                  ? "Checking…"
                  : pool === "empty"
                    ? "Nothing left to open"
                    : "Unlock the cell"}
            </button>
          </div>
          {pool === "empty" ? (
            // Not an error: the demo ran out, which is what happens to a
            // giveaway anyone can take from. Say so plainly, in the visitor's
            // words rather than ours, and do not colour it like a failure the
            // reader caused. "The pool is empty" means nothing to someone who
            // was never told there was a pool.
            <p className="mt-3 text-note text-muted">
              Every coin this demo had to give away has already been claimed, so
              there is nothing left to hand over. The check below still ran
              against the deployed script, so you can see the proof work even
              with the giveaway empty.
            </p>
          ) : (
            <p className="mt-3 text-note text-muted">
              {DEFAULT_RECIPIENT_ADDRESS
                ? "Leave this blank and the test coins return to the wallet that funded this demo, which is how it gets refilled. If you already have a Pudge address and want to keep them, paste it in."
                : "Paste a Pudge testnet address."}{" "}
              Either way you are receiving coins, not spending them, so there is
              nothing to set up first.
            </p>
          )}
          {error && (
            // A notice, not a stack trace. Bordered and tinted so it reads as
            // the page telling the visitor something, rather than as debug
            // output that escaped.
            <p
              role="alert"
              className="mt-4 rounded-lg border border-held/30 bg-held/5 px-4 py-3 text-note text-held"
            >
              {error}
            </p>
          )}
        </form>
      </div>
      <NodeVerdict state={dry} />
    </section>
  );
}

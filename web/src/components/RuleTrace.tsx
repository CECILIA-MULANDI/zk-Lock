import type { Attempt } from "../lib/prove";
import { FR_LEN, PI_PREFIX_LEN, PROOF_LEN } from "../lib/prove";
import type { DryRunState } from "../lib/unlock";
import { DEMO_PI_COMMITMENT } from "../lib/config";

/**
 * The six checks the script runs, in order.
 *
 * Until a node has judged the proof these read as predictions, because this
 * browser can only say what it believes the script would do. Once the dry run
 * comes back they are facts: an acceptance confirms every step, and a rejection
 * names the step that stopped by its exit code. Steps after that one did not
 * run at all, and saying they "will pass" would be inventing a result.
 */
type Outcome = "pass" | "fail" | "predicted" | "skipped";

/**
 * Exit codes from crates/zk-lock-core/src/error.rs, grouped by the step that
 * returns them. A code therefore locates the failure in this list exactly.
 */
const STEP_CODES: ReadonlyArray<ReadonlyArray<number>> = [
  [10],
  [14, 21],
  [11, 12, 13],
  [15],
  [16, 17, 18, 19, 20],
  [],
];

export function RuleTrace({
  attempt,
  dry,
}: {
  attempt: Attempt;
  dry: DryRunState;
}) {
  const commitmentMatches =
    attempt.piCommitment.toLowerCase() === DEMO_PI_COMMITMENT.toLowerCase();

  const accepted = dry !== "running" && dry.ok;
  const failedCode = dry !== "running" && !dry.ok ? dry.code : null;
  const stoppedAt =
    failedCode === null
      ? -1
      : STEP_CODES.findIndex((codes) => codes.includes(failedCode));

  /** Replaces a prediction with what the node actually reported, if it has. */
  const settle = (index: number, predicted: Outcome): Outcome => {
    if (accepted) return "pass";
    if (stoppedAt < 0) return predicted;
    if (index < stoppedAt) return "pass";
    if (index === stoppedAt) return "fail";
    return "skipped";
  };

  const steps: ReadonlyArray<{
    label: string;
    detail: string;
    outcome: Outcome;
  }> = [
    {
      label: "Read the 64 bytes of lock.args",
      detail: "vk_hash (32) then pi_commitment (32)",
      outcome: settle(0, "pass"),
    },
    {
      label: "Find the verifying key among the cell deps",
      detail: "the dep whose data hash equals vk_hash; rejects none and rejects duplicates",
      outcome: settle(1, "predicted"),
    },
    {
      label: "Read proof and public inputs from witness.lock",
      detail: `${attempt.witnessLock.length} bytes, framed as ${PROOF_LEN} + ${PI_PREFIX_LEN} + ${FR_LEN}`,
      outcome: settle(2, "pass"),
    },
    {
      label: "Recompute blake2b(public_inputs) and compare to pi_commitment",
      detail: commitmentMatches
        ? "matches the commitment in the cell's args"
        : "does not match: this is where a wrong secret stops",
      outcome: settle(3, commitmentMatches ? "pass" : "fail"),
    },
    {
      label: "Run the Groth16 verifier",
      detail: attempt.verifiedLocally
        ? "the pairing check passed locally against the same key"
        : "the pairing check failed",
      outcome: settle(4, attempt.verifiedLocally ? "predicted" : "fail"),
    },
    {
      label: "Succeed only if every check passed",
      detail:
        commitmentMatches && attempt.verifiedLocally
          ? "the cell may be spent"
          : "the cell stays locked",
      outcome: settle(5, commitmentMatches && attempt.verifiedLocally ? "predicted" : "fail"),
    },
  ];

  return (
    <section>
      <h2 className="font-display text-panel font-bold">
        What the on-chain script checks
      </h2>
      <ol className="mt-6 divide-y divide-hairline border-t border-b border-hairline">
        {steps.map((step, index) => (
          <li key={step.label} className="flex items-start gap-3 py-3.5">
            <span className="mt-1 w-4 shrink-0 font-mono text-micro text-muted">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-copy font-semibold">{step.label}</span>
              <span className="mt-0.5 block text-note text-muted">
                {step.detail}
              </span>
            </span>
            <span
              className={[
                "shrink-0 rounded-full px-2.5 py-1 text-micro font-semibold",
                step.outcome === "pass"
                  ? "bg-pass/10 text-pass"
                  : step.outcome === "predicted"
                    ? "bg-public/10 text-public"
                    : step.outcome === "skipped"
                      ? "bg-muted/10 text-muted"
                      : "bg-held/10 text-held",
              ].join(" ")}
            >
              {step.outcome === "pass"
                ? "pass"
                : step.outcome === "predicted"
                  ? "will pass"
                  : step.outcome === "skipped"
                    ? "not reached"
                    : "stops here"}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-note text-muted">
        {dry === "running"
          ? 'Steps 2, 5 and 6 read "will pass" until a node has run them. They are checked here against the same verifying key the script loads.'
          : dry.ok
            ? "Every step above is the node's result, not this page's prediction. A CKB node ran the deployed script over this exact transaction and it passed."
            : "A CKB node ran the deployed script over this exact transaction. It stopped at the step marked above, and the steps below it never ran."}
      </p>
    </section>
  );
}

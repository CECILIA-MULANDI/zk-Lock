import type { Attempt } from "../lib/prove";
import { DEMO_PI_COMMITMENT } from "../lib/config";

/**
 * The six checks from contracts/zk-lock/src/main.rs, in order. Steps 2, 5 and 6
 * read as predicted because nothing has run on chain yet.
 */
type Outcome = "pass" | "fail" | "predicted";

export function RuleTrace({ attempt }: { attempt: Attempt }) {
  const commitmentMatches =
    attempt.piCommitment.toLowerCase() === DEMO_PI_COMMITMENT.toLowerCase();

  const steps: ReadonlyArray<{
    label: string;
    detail: string;
    outcome: Outcome;
  }> = [
    {
      label: "Read the 64 bytes of lock.args",
      detail: "vk_hash (32) then pi_commitment (32)",
      outcome: "pass",
    },
    {
      label: "Find the verifying key among the cell deps",
      detail: "the dep whose data hash equals vk_hash; rejects none and rejects duplicates",
      outcome: "predicted",
    },
    {
      label: "Read proof and public inputs from witness.lock",
      detail: `${attempt.witnessLock.length} bytes, framed as 128 + 4 + 32`,
      outcome: "pass",
    },
    {
      label: "Recompute blake2b(public_inputs) and compare to pi_commitment",
      detail: commitmentMatches
        ? "matches the commitment in the cell's args"
        : "does not match: this is where a wrong secret stops",
      outcome: commitmentMatches ? "pass" : "fail",
    },
    {
      label: "Run the Groth16 verifier",
      detail: attempt.verifiedLocally
        ? "the pairing check passed locally against the same key"
        : "the pairing check failed",
      outcome: attempt.verifiedLocally ? "predicted" : "fail",
    },
    {
      label: "Succeed only if every check passed",
      detail:
        commitmentMatches && attempt.verifiedLocally
          ? "the cell may be spent"
          : "the cell stays locked",
      outcome: commitmentMatches && attempt.verifiedLocally ? "predicted" : "fail",
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
                    : "bg-held/10 text-held",
              ].join(" ")}
            >
              {step.outcome === "pass"
                ? "pass"
                : step.outcome === "predicted"
                  ? "will pass"
                  : "stops here"}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-note text-muted">
        Steps 2, 5 and 6 read "will pass" because nothing has run on chain yet.
        They are checked here against the same verifying key the script loads.
      </p>
    </section>
  );
}

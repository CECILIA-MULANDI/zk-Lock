import { useEffect, useState } from "react";
import { Nav } from "./Nav";
import { SecretForm } from "./SecretForm";
import { WhatHappensNext } from "./WhatHappensNext";
import { ProvingTrace } from "./ProvingTrace";
import { WitnessView } from "./WitnessView";
import { LockCheck } from "./LockCheck";
import { RuleTrace } from "./RuleTrace";
import { runAttempt, type Attempt, type Stage } from "../lib/prove";
import type { DryRunState } from "../lib/unlock";
import { CODE_HASH, CONTRACT_DEP, explorerTx } from "../lib/config";
import { REPO_URL, SHELL } from "../lib/layout";

const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-12)}`;

export function Demo() {
  const [stage, setStage] = useState<Stage | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dry, setDry] = useState<DryRunState>("running");

  const busy = stage !== null && stage !== "done";

  // One dry run per attempt, held here because two panels below report it: the
  // lock check states the verdict, and the rule trace uses the exit code to say
  // which step stopped. Running it in each would ask a node the same question
  // twice and risk the two disagreeing on screen.
  //
  // It runs for a wrong word as well as a right one. A rejection carries the
  // script's own exit code, which is worth more than this page asserting the
  // same thing, and a dry run spends nothing either way.
  useEffect(() => {
    if (!attempt) return;
    let cancelled = false;
    setDry("running");
    void (async () => {
      try {
        const { dryRunProof } = await import("../lib/unlock");
        const verdict = await dryRunProof({
          proofBytes: attempt.proofBytes,
          piBytes: attempt.piBytes,
        });
        if (!cancelled) setDry(verdict);
      } catch (cause) {
        if (!cancelled) {
          setDry({
            ok: false,
            code: null,
            reason:
              cause instanceof Error
                ? cause.message
                : "the node could not be reached",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function prove(word: string) {
    setAttempt(null);
    setError(null);
    setStage("mapping");
    try {
      setAttempt(await runAttempt(word, setStage));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Something went wrong."
      );
      setStage(null);
    }
  }

  return (
    <div className="w-full">
      <Nav view="demo" />

      <main className={`${SHELL} flex flex-col gap-12 pt-18 pb-16`}>
        <div className="flex flex-wrap items-end justify-between gap-x-16 gap-y-6">
          <div className="flex min-w-0 flex-[1_1_560px] flex-col gap-4.5">
            <p className="eyebrow text-muted">
              zk-Lock on Pudge testnet
            </p>
            <h1 className="font-display text-title font-extrabold">
              Prove you know a secret
            </h1>
          </div>
          <p className="max-w-[620px] min-w-0 flex-[1_1_420px] text-lead text-body">
            There is CKB on a public blockchain locked behind a secret word.
            Prove you know the word and you can spend it. You never reveal the
            word, and it never leaves this page.
          </p>
        </div>

        {/*
          What happens next is a promise about the three sections below it, so
          it retires once they are on screen. Leaving it up puts a second
          numbered list next to RuleTrace and a table of contents next to the
          thing it was a table of contents for.
        */}
        <div className="flex flex-wrap items-stretch gap-6">
          <SecretForm busy={busy} onSubmit={prove} />
          {!attempt && <WhatHappensNext locked={!busy} />}
        </div>

        {error && (
          <p
            role="alert"
            className="rounded-lg bg-held/10 px-4 py-3 text-note font-semibold text-held"
          >
            {error}
          </p>
        )}

        {stage && stage !== "done" && <ProvingTrace stage={stage} />}

        {attempt && (
          <div className="flex flex-col gap-14">
            <WitnessView attempt={attempt} />
            <LockCheck attempt={attempt} dry={dry} />
            <RuleTrace attempt={attempt} dry={dry} />
          </div>
        )}

        <dl className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-8 gap-y-6 border-t border-hairline pt-8">
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="eyebrow text-muted">
              Contract cell
            </dt>
            <dd className="font-mono text-note [overflow-wrap:anywhere]">
              <a
                href={explorerTx(CONTRACT_DEP.txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-public"
              >
                {short(CONTRACT_DEP.txHash)}
              </a>
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="eyebrow text-muted">
              code_hash (type)
            </dt>
            <dd className="font-mono text-note text-body [overflow-wrap:anywhere]">
              {short(CODE_HASH)}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="eyebrow text-muted">
              Status
            </dt>
            <dd className="text-note text-body">
              Groth16 proof checked by a CKB lock script. Not audited, test
              funds only. This runs the check in generic mode; the
              transaction-binding mode adds one more check, tying a proof to
              one specific transaction, and is covered in the tutorial.{" "}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="text-public"
              >
                Source on GitHub
              </a>
            </dd>
          </div>
        </dl>
      </main>
    </div>
  );
}

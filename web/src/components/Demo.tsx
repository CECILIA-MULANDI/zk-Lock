import { useState } from "react";
import { Nav } from "./Nav";
import { SecretForm } from "./SecretForm";
import { WhatHappensNext } from "./WhatHappensNext";
import { ProvingTrace } from "./ProvingTrace";
import { WitnessView } from "./WitnessView";
import { LockCheck } from "./LockCheck";
import { RuleTrace } from "./RuleTrace";
import { runAttempt, type Attempt, type Stage } from "../lib/prove";
import { CODE_HASH, CONTRACT_DEP, explorerTx } from "../lib/config";
import { REPO_URL, SHELL } from "../lib/layout";

const short = (hash: string) => `${hash.slice(0, 10)}…${hash.slice(-12)}`;

export function Demo() {
  const [stage, setStage] = useState<Stage | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = stage !== null && stage !== "done";

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
            <p className="font-mono text-micro tracking-[0.14em] text-muted uppercase">
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

        <div className="flex flex-wrap items-stretch gap-6">
          <SecretForm busy={busy} onSubmit={prove} />
          <WhatHappensNext locked={!attempt && !busy} />
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
            <LockCheck attempt={attempt} />
            <RuleTrace attempt={attempt} />
          </div>
        )}

        <dl className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-x-8 gap-y-6 border-t border-hairline pt-8">
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="font-mono text-micro tracking-[0.12em] text-muted uppercase">
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
            <dt className="font-mono text-micro tracking-[0.12em] text-muted uppercase">
              code_hash (type)
            </dt>
            <dd className="font-mono text-note text-body [overflow-wrap:anywhere]">
              {short(CODE_HASH)}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <dt className="font-mono text-micro tracking-[0.12em] text-muted uppercase">
              Status
            </dt>
            <dd className="text-note text-body">
              Groth16 proof checked by a CKB lock script. Not audited, test
              funds only.{" "}
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

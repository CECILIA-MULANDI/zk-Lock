import { LockGlyph } from "./Nav";

const STEPS = [
  {
    title: "Your browser builds a proof",
    body: "Worked out from the word, right here.",
  },
  {
    title: "Only the proof is sent",
    body: "A transaction to Pudge carries the proof, not the word.",
  },
  {
    title: "The lock checks it",
    body: "A valid proof opens the cell. A wrong word fails here, on chain.",
  },
];

export function WhatHappensNext({ locked }: { locked: boolean }) {
  return (
    <section
      aria-label="What happens"
      className="flex min-w-0 flex-[1_1_440px] flex-col gap-[22px] rounded-[18px] border border-cool-edge bg-surface p-8"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-micro font-semibold tracking-[0.14em] text-public uppercase">
          Goes to the blockchain
        </span>
        <span className="font-mono text-micro text-cool-soft">public</span>
      </div>

      <h2 className="font-display text-card font-bold text-public">
        What happens next
      </h2>

      <ol className="flex flex-col">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="flex gap-4 py-3.5 not-last:border-b not-last:border-cool-edge"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border-[1.5px] border-step-edge font-mono text-micro text-cool-soft">
              {index + 1}
            </span>
            <div className="flex flex-col gap-[3px]">
              <span className="text-copy font-semibold">{step.title}</span>
              <span className="text-note text-soft">{step.body}</span>
            </div>
          </li>
        ))}
      </ol>

      {locked && (
        <div className="mt-auto flex items-center gap-3 rounded-xl border border-dashed border-rule bg-white px-[18px] py-4">
          <LockGlyph size={20} stroke="#165F5E" width={2} />
          <span className="text-note text-body">
            Locked. The result appears here once you press Prove.
          </span>
        </div>
      )}
    </section>
  );
}

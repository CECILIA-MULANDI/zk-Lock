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
      className="flex min-w-0 flex-[1_1_440px] flex-col gap-[22px] rounded-[14px] bg-public p-[clamp(28px,2.4vw,40px)]"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-micro font-medium tracking-[0.15em] text-on-teal-label uppercase">
          Goes to the blockchain
        </span>
        <span className="font-mono text-micro text-on-teal-label/75">public</span>
      </div>

      <h2 className="font-display text-card font-bold text-white">
        What happens next
      </h2>

      <ol className="flex flex-col">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="flex gap-4 py-3.5 not-last:border-b not-last:border-on-teal/25"
          >
            <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-ink font-mono text-micro font-medium text-on-ink">
              {index + 1}
            </span>
            <div className="flex flex-col gap-[3px]">
              <span className="text-copy font-semibold text-white">{step.title}</span>
              <span className="text-note text-on-teal">{step.body}</span>
            </div>
          </li>
        ))}
      </ol>

      {locked && (
        <div className="mt-auto flex items-center gap-3 rounded-lg border border-dashed border-on-teal/40 px-[18px] py-4">
          <LockGlyph size={20} stroke="#CDE8E3" width={2} />
          <span className="text-note text-on-teal">
            Locked. The result appears here once you press Prove.
          </span>
        </div>
      )}
    </section>
  );
}

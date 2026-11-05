import { ArrowRight, Nav } from "./Nav";
import { BoundaryCard } from "./BoundaryCard";
import { REPO_URL, SHELL } from "../lib/layout";

const STEPS = [
  {
    n: "01",
    title: "You know a word",
    body: "You type it on your own machine. It goes no further than the page you are looking at.",
    chip: "bg-private text-white",
  },
  {
    n: "02",
    title: "Your browser builds a proof",
    body: "A short piece of evidence, worked out from the word. It takes a moment, and it happens entirely on your side.",
    chip: "bg-ink text-on-ink",
  },
  {
    n: "03",
    title: "Anyone can check it",
    body: "The proof itself carries nothing about the word. The fingerprint is public though, so a long random secret stays secret and a short dictionary word like this one could be guessed from it.",
    chip: "bg-public text-white",
  },
];

export function Landing() {
  return (
    <div className="w-full">
      <Nav view="landing" />

      <section
        className={`${SHELL} flex flex-wrap items-center gap-[clamp(48px,6vw,120px)] pt-28 pb-30`}
      >
        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-7">
          <p className="eyebrow text-muted">
            A demo on the Nervos CKB test network
          </p>
          <h1 className="font-display text-hero font-extrabold">
            Some locks check a rule, not a key
          </h1>
          {/* The headline says "a rule" and the section below it explains
              knowing a word. This line is the handoff, so it has to name which
              rule this particular lock checks. */}
          <p className="max-w-[38ch] text-lead text-body">
            The rule on this one is knowing a secret word. Prove you know it and
            it opens, without you ever saying it.
          </p>
          <div className="flex flex-wrap items-center gap-5 pt-2">
            <a
              href="#try"
              className="inline-flex items-center gap-2.5 rounded-lg bg-public px-[22px] py-3 text-copy font-semibold text-white transition-colors hover:bg-ink"
            >
              Try it
              <ArrowRight />
            </a>
            <span className="text-note text-muted">
              Nothing to install. No wallet. About a minute.
            </span>
          </div>
        </div>

        <BoundaryCard />
      </section>

      {/*
        The steps are one panel divided, not three cards floating. Three cards
        with air between them read as three unrelated facts; one panel split by
        rules reads as a single sequence, which is what a numbered list is.
      */}
      <section id="how" className="scroll-mt-4 bg-public">
        <div className={`${SHELL} flex flex-col gap-10 py-28`}>
          <div className="flex flex-col gap-6">
            <h2 className="font-display text-section font-extrabold text-white">
              How that's possible
            </h2>
            <p className="max-w-[760px] text-intro text-on-teal">
              Your word has a fingerprint, and it is public. Anyone can see
              that some word matching it exists, and that was never in question.
              The question is whether you are someone who has that word. A proof
              is a short piece of evidence that settles it, without showing the
              word.
            </p>
          </div>

          <ol className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] overflow-hidden rounded-[14px] bg-white">
            {STEPS.map((step) => (
              <li
                key={step.n}
                className="flex flex-col gap-3.5 p-[clamp(28px,2.4vw,40px)] not-first:border-public lg:not-first:border-l-2"
              >
                <span
                  className={`flex size-[30px] shrink-0 items-center justify-center rounded-full font-mono text-micro font-medium ${step.chip}`}
                >
                  {step.n}
                </span>
                <h3 className="font-display text-card font-bold">
                  {step.title}
                </h3>
                <p className="text-copy text-soft">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/*
        The section above says how a proof works. A reader who already knows
        what a lock script is will stop here and ask why a signature would not
        do, and that question is fair enough that the page has to answer it
        rather than hope nobody asks.
      */}
      <section className={`${SHELL} flex flex-col gap-10 py-28`}>
        <div className="flex flex-col gap-6">
          <h2 className="font-display text-section font-extrabold">
            Why not an ordinary lock?
          </h2>
          <p className="max-w-[760px] text-intro text-body">
            Every lock asks a question before it opens. Say ten thousand people
            are allowed to open this one. Watch what each kind of lock has to
            make you give up.
          </p>
        </div>

        {/*
          One bordered panel, two halves, because the point is the comparison
          and not either side on its own. The closing note runs along the
          bottom inside the same border: it qualifies both halves, so it should
          not look like a third opinion sitting outside them.
        */}
        <div className="overflow-hidden rounded-[14px] border-2 border-ink">
          <div className="grid lg:grid-cols-[repeat(2,minmax(340px,1fr))]">
            <div className="flex flex-col gap-3.5 bg-white p-[clamp(28px,2.4vw,40px)]">
              <span className="eyebrow text-muted">
                Signature
              </span>
              <h3 className="font-display text-card font-bold">
                You prove which one you are
              </h3>
              <p className="text-copy text-soft">
                You sign with your key. Your key stays yours, but the signature
                names it, and the chain keeps the signature forever. Anyone
                looking can see which of the ten thousand opened the cell, and
                that you were on the list at all. The cost is not your key. It
                is that you cannot open this lock without saying which one of
                them you are.
              </p>
            </div>

            <div className="flex flex-col gap-3.5 bg-public p-[clamp(28px,2.4vw,40px)]">
              <span className="eyebrow text-on-teal-label">
                Proof
              </span>
              <h3 className="font-display text-card font-bold text-white">
                You prove you are one of them
              </h3>
              <p className="text-copy text-on-teal">
                You show that your entry is somewhere in the list without saying
                which entry is yours. The lock checks 128 bytes and learns one
                thing: somebody eligible opened it. Which somebody is not in the
                bytes, and cannot be worked out from them.
              </p>
            </div>
          </div>

          <p className="bg-ink px-[clamp(28px,2.4vw,40px)] py-7 text-copy text-on-ink-soft">
            An allowlist is one circuit. Change the circuit and the lock asks
            something else: over eighteen, a winning sealed bid, a valid batch
            of trades. The secret word in this demo is simply the smallest
            circuit that fits in a browser tab, which is the only reason it is
            the one you get to try.
          </p>
        </div>
      </section>

      <section className={`${SHELL} pb-28`}>
        <div className="flex flex-col gap-6 rounded-[14px] bg-private p-[clamp(40px,5vw,80px)]">
          {/*
            Deliberately silent about whether there is CKB left to take.
            DEMO_CELLS staying five entries long says nothing about whether
            those five are still unspent, so a promise made from its length is
            a promise this page cannot keep. The prove page asks the chain and
            tells the visitor the truth there.
          */}
          <h2 className="font-display text-feature font-extrabold text-white">
            Build a real proof. See exactly what gets sent.
          </h2>
          <p className="max-w-[640px] text-copy text-on-rust">
            The demo word is public on purpose. Try a wrong one too, and watch
            the lock hold.
          </p>
          <a
            href="#try"
            className="inline-flex w-fit items-center gap-2.5 rounded-lg bg-white px-[22px] py-3 text-copy font-semibold text-ink transition-colors hover:bg-ink hover:text-paper"
          >
            Try it
            <ArrowRight />
          </a>
        </div>
      </section>

      <footer className="bg-ink">
        <div
          className={`${SHELL} flex flex-wrap justify-between gap-x-8 gap-y-4 py-8 text-note text-on-ink-soft`}
        >
          <span>
            A CKB lock script that checks a Groth16 proof. Not audited. Test
            network only.
          </span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-footer-link"
          >
            Source, tutorial and CLI on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

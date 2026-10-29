import { ArrowRight, Nav } from "./Nav";
import { BoundaryCard } from "./BoundaryCard";
import { DEMO_CELLS } from "../lib/config";
import { REPO_URL, SHELL } from "../lib/layout";

const STEPS = [
  {
    n: "01",
    title: "You know a word",
    body: "You type it on your own machine. It goes no further than the page you are looking at.",
    chip: "bg-private-tint text-private",
  },
  {
    n: "02",
    title: "Your browser builds a proof",
    body: "A short piece of evidence, worked out from the word. It takes a moment, and it happens entirely on your side.",
    chip: "bg-public-tint text-public",
  },
  {
    n: "03",
    title: "Anyone can check it",
    body: "The proof convinces them you knew the word. It tells them nothing about what the word was, and it cannot be run backwards.",
    chip: "bg-public text-paper",
  },
];

export function Landing() {
  const funded = DEMO_CELLS.length > 0;

  return (
    <div className="w-full">
      <Nav view="landing" />

      <section
        className={`${SHELL} flex flex-wrap items-center gap-16 pt-24 pb-28`}
      >
        <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-7">
          <p className="font-mono text-micro tracking-[0.14em] text-muted uppercase">
            A demo on the Nervos CKB test network
          </p>
          <h1 className="font-display text-hero font-extrabold">
            Some locks never see the key
          </h1>
          <p className="max-w-[620px] text-lead text-body">
            This one opens for anyone who can prove they know a secret word,
            without ever saying the word.
          </p>
          <div className="flex flex-wrap items-center gap-5 pt-2">
            <a
              href="#try"
              className="inline-flex min-h-[52px] items-center gap-2.5 rounded-[10px] bg-public px-[26px] text-copy font-semibold text-paper transition-opacity hover:opacity-90"
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

      <section
        id="how"
        className="scroll-mt-4 border-y border-band-edge bg-surface"
      >
        <div className={`${SHELL} flex flex-col gap-14 py-[104px]`}>
          <div className="grid items-end gap-x-16 gap-y-6 lg:grid-cols-2">
            <h2 className="font-display text-section font-extrabold">
              How that's possible
            </h2>
            <p className="max-w-[640px] text-lead text-body">
              Normally, proving you know a password means typing it in, and
              whoever checked it now knows your password too. There is a kind of
              mathematics that avoids that.
            </p>
          </div>

          <ol className="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-5">
            {STEPS.map((step) => (
              <li
                key={step.n}
                className="flex flex-col gap-3.5 rounded-2xl border border-cool-edge bg-white p-7"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-micro font-semibold ${step.chip}`}
                  >
                    {step.n}
                  </span>
                  <span
                    className="h-px flex-1 bg-cool-edge"
                    aria-hidden="true"
                  />
                </div>
                <h3 className="font-display text-card font-bold">
                  {step.title}
                </h3>
                <p className="text-copy text-soft">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className={`${SHELL} py-24`}>
        <div className="flex flex-wrap items-center justify-between gap-8 rounded-[20px] bg-ink p-14 text-paper">
          <div className="flex flex-[1_1_420px] flex-col gap-3">
            {/* With an empty pool there is no cell behind the word, and the
                result panel says so. This must not contradict it. */}
            <h2 className="font-display text-feature font-extrabold">
              {funded ? (
                <>
                  There's real CKB behind a word.
                  <br />
                  Go open it.
                </>
              ) : (
                <>
                  Build a real proof.
                  <br />
                  See exactly what gets sent.
                </>
              )}
            </h2>
            <p className="text-copy text-dark-muted">
              The demo word is public on purpose. Try a wrong one too, and watch
              the lock hold.
            </p>
          </div>
          <a
            href="#try"
            className="inline-flex min-h-[52px] items-center gap-2.5 rounded-[10px] bg-paper px-[26px] text-copy font-semibold text-ink transition-opacity hover:opacity-90"
          >
            Try it
            <ArrowRight />
          </a>
        </div>
      </section>

      <footer className="border-t border-hairline">
        <div
          className={`${SHELL} flex flex-wrap justify-between gap-x-8 gap-y-4 py-8 text-note text-muted`}
        >
          <span>
            A CKB lock script that checks a Groth16 proof. Not audited. Test
            network only.
          </span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="text-public"
          >
            Source, tutorial and CLI on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

import type { Stage } from "../lib/prove";

const STAGES: ReadonlyArray<{ id: Stage; label: string; detail: string }> = [
  {
    id: "mapping",
    label: "Turning your word into a number",
    detail: "Its UTF-8 bytes, read as one big-endian field element",
  },
  {
    id: "loading",
    label: "Loading the circuit and proving key",
    detail: "1.6 MB of wasm and 182 KB of key, fetched once and cached",
  },
  {
    id: "proving",
    label: "Computing the witness and generating the proof",
    detail: "Real Groth16 over BN254, in this browser tab",
  },
  {
    id: "verifying",
    label: "Checking the proof",
    detail: "Against the same verifying key the on-chain script loads",
  },
  {
    id: "encoding",
    label: "Encoding the bytes that go on chain",
    detail: "128 bytes of proof plus 36 of public input",
  },
];

const ORDER: Stage[] = [
  "mapping",
  "loading",
  "proving",
  "verifying",
  "encoding",
  "done",
];

export function ProvingTrace({ stage }: { stage: Stage }) {
  const currentIndex = ORDER.indexOf(stage);

  return (
    <section
      aria-live="polite"
      aria-label="Proof progress"
      className="rounded-xl border border-hairline bg-surface p-6 sm:p-8"
    >
      <ol className="space-y-4">
        {STAGES.map((item, index) => {
          const done = currentIndex > index;
          const active = currentIndex === index;
          return (
            <li key={item.id} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={[
                  "mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border text-micro font-bold",
                  done
                    ? "border-pass bg-pass text-paper"
                    : active
                      ? "border-public bg-public/15 text-public"
                      : "border-hairline text-muted",
                ].join(" ")}
              >
                {done ? "✓" : index + 1}
              </span>
              <span>
                <span
                  className={[
                    "block text-copy font-semibold",
                    done || active ? "text-ink" : "text-muted",
                  ].join(" ")}
                >
                  {item.label}
                  {active && <span className="text-public"> …</span>}
                </span>
                <span className="mt-0.5 block text-note text-muted">
                  {item.detail}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

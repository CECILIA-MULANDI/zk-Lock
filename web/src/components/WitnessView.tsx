import type { Attempt } from "../lib/prove";
import { toHex } from "../lib/prove";

function HexField({
  label,
  note,
  bytes,
}: {
  label: string;
  note: string;
  bytes: Uint8Array;
}) {
  return (
    <div className="rounded-lg bg-public/6 px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-mono text-micro font-semibold tracking-[0.12em] text-public uppercase">
          {label}
        </span>
        <span className="text-note text-muted">{note}</span>
      </div>
      <p className="mt-2 font-mono text-micro leading-[1.7] break-all text-public">
        {toHex(bytes)}
      </p>
    </div>
  );
}

export function WitnessView({ attempt }: { attempt: Attempt }) {
  const fieldHex = attempt.field.toString(16);
  const paddedFieldHex =
    fieldHex.length % 2 === 1 ? `0${fieldHex}` : fieldHex;

  const proof = attempt.witnessLock.slice(0, 128);
  const piCount = attempt.witnessLock.slice(128, 132);
  const publicInputs = attempt.witnessLock.slice(132);

  return (
    <section className="grid gap-8 lg:grid-cols-[24rem_minmax(0,1fr)] 2xl:grid-cols-[30rem_minmax(0,1fr)]">
      <div className="lg:sticky lg:top-8 lg:self-start">
        <div className="rounded-xl border border-private/30 bg-private/7 p-6">
          <span className="font-mono text-micro font-semibold tracking-[0.14em] text-private uppercase">
            Stays with you
          </span>
          <h2 className="mt-3 font-display text-card font-bold text-private">
            Your secret
          </h2>
          <p className="mt-4 font-mono text-panel break-all text-private">
            {attempt.word}
          </p>
          <span className="mt-4 inline-block rounded-full bg-private/15 px-3 py-1.5 text-micro font-semibold text-private">
            Never leaves this page
          </span>

          <dl className="mt-5 space-y-3 border-t border-private/20 pt-5 text-note">
            <div>
              <dt className="text-muted">As a field element</dt>
              <dd className="mt-1 font-mono break-all text-private">
                {attempt.field.toString()}
              </dd>
            </div>
            <div>
              <dt className="text-muted">As bytes</dt>
              <dd className="mt-1 font-mono break-all text-private">
                {paddedFieldHex}
              </dd>
            </div>
          </dl>

          <p className="mt-5 text-copy text-muted">
            This is the circuit's private input. It is read here, used to build
            the proof, and then thrown away. No request carries it.
          </p>
        </div>
      </div>

      <div>
        {/* Below `lg` the secret panel scrolls away, taking the evidence for
            "it never left this page" with it. This keeps it on screen. */}
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-lg border border-private/25 bg-paper/95 px-3 py-2 backdrop-blur lg:hidden">
          <span className="text-micro font-semibold text-private">
            Your secret
          </span>
          <span className="font-mono text-note text-private">{attempt.word}</span>
          <span className="font-mono text-micro break-all text-muted">
            {paddedFieldHex}
          </span>
        </div>

        <h2 className="font-display text-panel font-bold">
          Your word is not in what gets sent.
        </h2>
        <p className="mt-3 max-w-[72ch] text-copy text-muted">
          Below are the {attempt.witnessLock.length} numbers that go to the
          blockchain. Written out the same way, your word is{" "}
          <code className="font-mono font-medium text-private">
            {paddedFieldHex}
          </code>
          . Search for it. It is not there, and anyone can still check the proof
          is good.
        </p>

        <div className="mt-8 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline pb-2">
          <span className="font-mono text-micro font-semibold tracking-[0.12em] text-public uppercase">
            witness.lock
          </span>
          <span className="text-note text-muted">
            {attempt.witnessLock.length} bytes, proved in {attempt.proveMs}ms
          </span>
        </div>

        <div className="mt-3 space-y-2.5">
          <HexField label="proof" note="128 bytes" bytes={proof} />
          <HexField
            label="pi_count"
            note="4 bytes, how many public values follow"
            bytes={piCount}
          />
          <HexField
            label="public_inputs"
            note="32 bytes, the fingerprint of your word"
            bytes={publicInputs}
          />
        </div>

        {attempt.verifiedLocally ? (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-pass/10 px-3.5 py-2 text-note font-semibold text-pass">
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M2.5 7.5L5.5 10.5L11.5 3.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Proof verified in your browser
          </p>
        ) : (
          <p className="mt-4 inline-flex rounded-full bg-held/10 px-3.5 py-2 text-note font-semibold text-held">
            The proof did not verify, which should not happen. Please report it.
          </p>
        )}
      </div>
    </section>
  );
}

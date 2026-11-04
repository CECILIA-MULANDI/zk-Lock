import { useState } from "react";
import { ArrowRight } from "./Nav";
import { DEMO_SECRET } from "../lib/config";
import { MAX_SECRET_BYTES } from "../lib/prove";

/** Something that is definitely not the demo word, for the one-click wrong try. */
const WRONG_WORD = "ethereum";

export function SecretForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (word: string) => void;
}) {
  const [word, setWord] = useState(DEMO_SECRET);

  const bytes = new TextEncoder().encode(word).length;
  const tooLong = bytes > MAX_SECRET_BYTES;

  return (
    <form
      className="flex min-w-0 flex-[1_1_440px] flex-col gap-5 rounded-[14px] bg-private p-[clamp(28px,2.4vw,40px)]"
      onSubmit={(event) => {
        event.preventDefault();
        if (!tooLong && word.length > 0) onSubmit(word);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-micro font-medium tracking-[0.15em] text-on-rust uppercase">
          Stays with you
        </span>
        <span className="font-mono text-micro text-on-rust/75">
          never sent
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        <label
          htmlFor="secret"
          className="font-display text-card font-bold text-white"
        >
          The secret word
        </label>
        <input
          id="secret"
          name="secret"
          type="text"
          value={word}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          aria-describedby="secret-help"
          onChange={(event) => setWord(event.target.value)}
          className="h-[60px] rounded-lg bg-white px-[18px] font-mono text-card text-private outline-none disabled:opacity-60"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => setWord(DEMO_SECRET)}
          className="min-h-11 rounded-full bg-white px-3.5 text-note font-semibold text-private transition-colors hover:bg-ink hover:text-paper disabled:opacity-50"
        >
          Use the demo word
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setWord(WRONG_WORD)}
          className="min-h-11 rounded-full border border-on-rust/40 px-3.5 text-note font-semibold text-on-rust transition-colors hover:bg-ink hover:text-paper disabled:opacity-50"
        >
          Try a wrong word
        </button>
      </div>

      <button
        type="submit"
        disabled={busy || tooLong || word.length === 0}
        className="flex items-center justify-center gap-2.5 rounded-lg bg-ink px-[22px] py-3.5 text-copy font-semibold text-paper transition-colors hover:bg-public disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Proving…" : "Prove I know it"}
        {!busy && <ArrowRight />}
      </button>

      <p id="secret-help" className="text-note text-on-rust">
        {tooLong ? (
          <span className="font-semibold text-white">
            That is {bytes} bytes. {MAX_SECRET_BYTES} is the most that fits in
            one field element.
          </span>
        ) : (
          <>
            The demo word is{" "}
            <code className="rounded bg-white/15 px-1.5 py-0.5 font-mono">
              {DEMO_SECRET}
            </code>
            . That is public on purpose: this explains a mechanism rather than
            setting a puzzle.
          </>
        )}
      </p>
    </form>
  );
}

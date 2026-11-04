/**
 * The two halves of the boundary, as two solid grounds rather than two tints.
 *
 * The split is the whole argument of the page, so it is drawn as hard as the
 * palette allows: rust is the half that never leaves the browser, teal is the
 * half that goes on chain, and the only thing bridging them is the pill. A
 * tinted version of this card reads as decoration; a solid one reads as a
 * border between two territories, which is what it is.
 */
export function BoundaryCard() {
  return (
    <div className="min-w-0 flex-[1_1_420px] overflow-hidden rounded-[14px] border-2 border-ink">
      <div className="flex flex-col gap-4 bg-private px-7 pt-7 pb-8">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-micro font-medium tracking-[0.15em] text-on-rust uppercase">
            Stays with you
          </span>
          <span className="font-mono text-micro text-on-rust/75">
            your browser
          </span>
        </div>
        <p className="font-display text-panel font-bold text-white">
          your word
        </p>
        <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3.5">
          <span
            className="font-mono text-card tracking-[0.3em] text-private"
            aria-label="a hidden secret word"
          >
            ••••••
          </span>
          <span className="ml-auto text-note text-private">
            typed, used, forgotten
          </span>
        </div>
      </div>

      <div className="relative h-0">
        <span className="absolute top-[-15px] left-1/2 -translate-x-1/2 rounded-full bg-ink px-3.5 py-[6px] font-mono text-micro whitespace-nowrap text-on-ink">
          only this crosses ↓
        </span>
      </div>

      <div className="flex flex-col gap-4 bg-public px-7 pt-8 pb-7">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-micro font-medium tracking-[0.15em] text-on-teal-label uppercase">
            Goes to the blockchain
          </span>
          <span className="font-mono text-micro text-on-teal-label/75">
            public
          </span>
        </div>
        <p className="font-display text-panel font-bold text-white">
          the proof
        </p>
        <div className="flex items-center gap-3 rounded-lg bg-white px-4 py-3.5">
          <span className="font-mono text-note text-public">[proof bytes]</span>
          <span className="ml-auto flex items-center gap-1.5 text-note font-semibold text-public">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 12 5 5 9-10" />
            </svg>
            lock opens
          </span>
        </div>
        <p className="text-copy text-on-teal">
          Anyone can check it. The proof itself carries nothing about your word.
        </p>
      </div>
    </div>
  );
}

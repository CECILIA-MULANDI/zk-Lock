export function BoundaryCard() {
  return (
    <div className="min-w-0 flex-[1_1_420px] overflow-hidden rounded-[18px] border border-edge bg-white">
      <div className="flex flex-col gap-4 bg-private-tint px-7 pt-7 pb-8">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-micro font-semibold tracking-[0.14em] text-private uppercase">
            Stays with you
          </span>
          <span className="font-mono text-micro text-private-soft">
            your browser
          </span>
        </div>
        <p className="font-display text-panel font-bold text-private">
          your word
        </p>
        <div className="flex items-center gap-3 rounded-[10px] border border-private-edge bg-private-paper px-4 py-3.5">
          <span
            className="font-mono text-card tracking-[0.3em] text-private"
            aria-label="a hidden secret word"
          >
            ••••••
          </span>
          <span className="ml-auto text-note text-private-soft">
            typed, used, forgotten
          </span>
        </div>
      </div>

      <div className="relative h-0 border-t-2 border-dashed border-rule">
        <span className="absolute top-[-14px] left-1/2 -translate-x-1/2 rounded-full border border-edge bg-white px-3 py-[5px] font-mono text-micro whitespace-nowrap text-body">
          only this crosses ↓
        </span>
      </div>

      <div className="flex flex-col gap-4 bg-surface px-7 pt-8 pb-7">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-micro font-semibold tracking-[0.14em] text-public uppercase">
            Goes to the blockchain
          </span>
          <span className="font-mono text-micro text-cool-soft">public</span>
        </div>
        <p className="font-display text-panel font-bold text-public">
          the proof
        </p>
        <div className="flex items-center gap-3 rounded-[10px] border border-cool-edge-soft bg-white px-4 py-3.5">
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
        <p className="text-copy text-body">
          Anyone can check it. Nobody can work backwards from it to your word.
        </p>
      </div>
    </div>
  );
}

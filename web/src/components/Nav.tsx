import { SHELL } from "../lib/layout";

export function ArrowRight() {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

export function LockGlyph({
  size = 16,
  stroke = "currentColor",
  width = 2.2,
}: {
  size?: number;
  stroke?: string;
  width?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={stroke}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 7.5-2" />
    </svg>
  );
}

export function Nav({ view }: { view: "landing" | "demo" }) {
  return (
    <header className="border-b border-hairline">
      <div
        className={`${SHELL} flex flex-wrap items-center justify-between gap-4 py-[18px]`}
      >
        <a href="#" className="flex items-center gap-2.5 text-ink">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-public">
            <LockGlyph stroke="#FBFAF6" />
          </span>
          <span className="font-display text-lead font-bold tracking-[-0.01em]">
            zk-Lock
          </span>
        </a>

        <nav className="flex flex-wrap items-center gap-6 text-note">
          <a
            href={view === "demo" ? "#" : "#how"}
            className="text-body hover:text-ink"
          >
            {view === "demo" ? "What is this?" : "How it works"}
          </a>
          <span className="flex items-center gap-2 rounded-full bg-public-pill px-2.5 py-1.5 font-mono text-micro text-public">
            <span
              className="size-[7px] rounded-full bg-dot"
              aria-hidden="true"
            />
            Pudge testnet
          </span>
        </nav>
      </div>
    </header>
  );
}

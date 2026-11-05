import { useEffect, useState } from "react";
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
  shackleClassName,
  className,
}: {
  size?: number;
  stroke?: string;
  width?: number;
  /** Set to animate the shackle alone, leaving the body still. */
  shackleClassName?: string;
  /** For the flex context the glyph sits in, such as keeping it from shrinking. */
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
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
      <path className={shackleClassName} d="M8 11V8a4 4 0 0 1 7.5-2" />
    </svg>
  );
}

function NetworkPill() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-public px-3 py-1.5 font-mono text-micro font-medium text-on-teal-label">
      <span className="size-1.75 rounded-full bg-dot" aria-hidden="true" />
      Pudge testnet
    </span>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      {open ? (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </>
      ) : (
        <>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </>
      )}
    </svg>
  );
}

export function Nav({ view }: { view: "landing" | "demo" }) {
  const [open, setOpen] = useState(false);
  const label = view === "demo" ? "What is this?" : "How it works";
  const href = view === "demo" ? "#" : "#how";

  // Escape closes it, which is the one keyboard behaviour a disclosure like
  // this is expected to have and the easiest to forget.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className="bg-ink text-on-ink">
      <div className={`${SHELL} flex items-center justify-between gap-4 py-4`}>
        <a href="#" className="flex items-center gap-2.5 text-paper">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-public">
            <LockGlyph stroke="#F4F1EA" />
          </span>
          <span className="font-display text-lead font-bold tracking-[-0.01em]">
            zk-Lock
          </span>
        </a>

        {/* Wide: everything inline. The link is 15px semibold rather than 14px
            regular, because at nav size regular weight on a dark ground reads
            as a caption instead of as something you can click. */}
        <nav className="hidden items-center gap-7 sm:flex">
          <a
            href={href}
            className="text-copy font-semibold text-on-ink transition-colors hover:text-paper"
          >
            {label}
          </a>
          <NetworkPill />
        </nav>

        <button
          type="button"
          onClick={() => setOpen((wasOpen) => !wasOpen)}
          aria-expanded={open}
          aria-controls="site-menu"
          className="-mr-2 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-paper transition-colors hover:bg-white/10 sm:hidden"
        >
          <MenuIcon open={open} />
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
      </div>

      {open && (
        <div id="site-menu" className="border-t border-white/10 sm:hidden">
          {/* One row, not a stack: the link is where you can go and the pill is
              what you are looking at, so they are different kinds of thing and
              stacking them left-aligned made the pill read as a second
              destination. Pushed right, it reads as status. */}
          <div
            className={`${SHELL} flex flex-wrap items-center justify-between gap-x-4 gap-y-3 py-5`}
          >
            <a
              href={href}
              onClick={() => setOpen(false)}
              className="text-lead font-semibold text-paper"
            >
              {label}
            </a>
            <NetworkPill />
          </div>
        </div>
      )}
    </header>
  );
}

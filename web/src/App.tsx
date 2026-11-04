import { useEffect, useRef, useState } from "react";
import { Landing } from "./components/Landing";
import { Demo } from "./components/Demo";

/**
 * Two views, switched on the URL hash rather than a router.
 *
 * Only a change of VIEW resets scroll. An in-page anchor like `#how` is also a
 * hash change, and resetting on those fights the browser's anchor scroll and
 * lands you at the top instead of the section you clicked.
 */
function viewFor(hash: string) {
  return hash === "#try" ? "demo" : "landing";
}

export function App() {
  const [hash, setHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash
  );
  const view = viewFor(hash);
  const previousView = useRef(view);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (previousView.current === view) return;
    previousView.current = view;
    // Instant, not smooth: this is a different page, so animating a long
    // scroll through content the visitor is leaving behind is just a delay.
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);

  return view === "demo" ? <Demo /> : <Landing />;
}

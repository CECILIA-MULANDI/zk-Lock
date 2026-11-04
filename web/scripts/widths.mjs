// Renders the same page at one viewport with several container max-widths,
// so the container size can be chosen by looking rather than by guessing.
//
//   node scripts/widths.mjs http://127.0.0.1:4318/ 2000 /tmp/out 1200 1440 1600
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , url, widthArg, outDir, ...caps] = process.argv;
const width = Number(widthArg ?? 2000);
const height = 1200;
const PORT = 9334;

mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "zk-widths-"));
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function socket() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) =>
        r.json()
      );
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome did not expose a debugging target");
}

const ws = new WebSocket(await socket());
await new Promise((r) => ws.addEventListener("open", r));

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url });
await sleep(4000);

for (const cap of caps) {
  // The container is a utility class, so override it with a stylesheet rather
  // than rebuilding for each candidate.
  await send("Runtime.evaluate", {
    expression: `(() => {
      let s = document.getElementById("cap-probe");
      if (!s) { s = document.createElement("style"); s.id = "cap-probe"; document.head.appendChild(s); }
      s.textContent = '.max-w-\\\\[1200px\\\\]{max-width:${cap}px !important}';
    })()`,
  });
  await sleep(700);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = join(outDir, `cap-${cap}.png`);
  writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log(`${cap}px -> ${file}`);
}

ws.close();
chrome.kill();
process.exit(0);

// Renders a page in headless Chrome and reports anything wider than the
// viewport, so horizontal overflow can be found by name instead of by eye.
//
//   node scripts/inspect.mjs http://127.0.0.1:4318/ 390
//
// Node's built-in WebSocket drives the DevTools protocol, so this needs no
// dependencies and no Playwright download.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:4318/";
const width = Number(process.argv[3] ?? 390);
const height = Number(process.argv[4] ?? 900);
const PORT = 9333;

const profile = mkdtempSync(join(tmpdir(), "zk-inspect-"));
const chrome = spawn(
  "google-chrome",
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    "about:blank",
  ],
  { stdio: "ignore" }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetSocket() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) =>
        r.json()
      );
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* chrome not up yet */
    }
    await sleep(250);
  }
  throw new Error("Chrome did not expose a debugging target");
}

const ws = new WebSocket(await targetSocket());
await new Promise((resolve) => ws.addEventListener("open", resolve));

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
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
  mobile: process.env.MOBILE !== "0" && width < 700,
});
await send("Page.navigate", { url });
await sleep(3500);

// Optional: drive the page before measuring, e.g. CLICK='button[type=submit]'
if (process.env.CLICK) {
  await send("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(process.env.CLICK)})?.click()`,
  });
  await sleep(Number(process.env.CLICK_WAIT ?? 7000));
}

const { result } = await send("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => {
    const vw = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const overflowsRight = Math.round(r.right) > vw + 1;
      const tooWide = Math.round(r.width) > vw + 1;
      if (overflowsRight || tooWide) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.getAttribute("class") || "").slice(0, 110),
          w: Math.round(r.width),
          right: Math.round(r.right),
          text: (el.textContent || "").trim().slice(0, 40),
          depth: (() => { let d = 0, n = el; while ((n = n.parentElement)) d++; return d; })(),
        });
      }
    }
    return {
      viewport: vw,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      count: out.length,
      // Deepest first: the innermost offender is usually the real cause.
      worst: out.sort((a, b) => b.depth - a.depth).slice(0, 12),
    };
  })()`,
});

const data = result.value;
console.log(`viewport      ${data.viewport}`);
console.log(`scrollWidth   ${data.scrollWidth}`);
console.log(`overflowing   ${data.count} elements\n`);
for (const el of data.worst) {
  console.log(
    `  <${el.tag}> w=${el.w} right=${el.right}\n    class: ${el.cls}\n    text:  ${el.text}`
  );
}

if (process.env.SHOT) {
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.SHOT, Buffer.from(shot.data, "base64"));
  console.log(`\nsaved ${process.env.SHOT}`);
}

ws.close();
chrome.kill();
process.exit(0);

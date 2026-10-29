// Reports the type scale a page actually renders, so hierarchy can be judged
// from measured sizes instead of from reading Tailwind classes.
//
//   node scripts/type-audit.mjs http://127.0.0.1:5173/ 1600
//   CLICK='button[type=submit]' node scripts/type-audit.mjs http://127.0.0.1:5173/#try 1600
//
// Only elements that own their text are measured, so a size is counted once
// where it is set and not again for every wrapper that inherits it.
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] ?? "http://127.0.0.1:5173/";
const width = Number(process.argv[3] ?? 1600);
const height = Number(process.argv[4] ?? 1000);
const PORT = 9334;

const profile = mkdtempSync(join(tmpdir(), "zk-type-"));
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
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetSocket() {
  for (let i = 0; i < 40; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) =>
        r.json(),
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
  mobile: false,
});
await send("Page.navigate", { url });
await sleep(3500);

if (process.env.CLICK) {
  await send("Runtime.evaluate", {
    expression: `document.querySelector(${JSON.stringify(process.env.CLICK)})?.click()`,
  });
  await sleep(Number(process.env.CLICK_WAIT ?? 9000));
}

const { result } = await send("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => {
    const rows = [];
    for (const el of document.querySelectorAll("body *")) {
      // Own text only: a node counts where its size is declared, not on every
      // ancestor that happens to contain it.
      const own = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .join(" ")
        .trim();
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const s = getComputedStyle(el);
      rows.push({
        size: Math.round(parseFloat(s.fontSize) * 10) / 10,
        weight: s.fontWeight,
        lh: Math.round(parseFloat(s.lineHeight) * 10) / 10,
        mono: /mono|JetBrains/i.test(s.fontFamily),
        tag: el.tagName.toLowerCase(),
        text: own.slice(0, 54),
      });
    }
    const bySize = new Map();
    for (const r of rows) {
      if (!bySize.has(r.size)) bySize.set(r.size, []);
      bySize.get(r.size).push(r);
    }
    return {
      total: rows.length,
      sizes: [...bySize.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([size, items]) => ({
          size,
          count: items.length,
          // Prose is what a reader has to sit and read; mono is reference data
          // and is allowed to be smaller.
          prose: items.filter((i) => !i.mono).length,
          samples: items.slice(0, 3).map((i) => \`\${i.tag}\${i.mono ? " mono" : ""} w\${i.weight} lh\${i.lh}  "\${i.text}"\`),
        })),
    };
  })()`,
});

const data = result.value;
console.log(`${url}  @${width}px`);
console.log(`${data.total} text nodes, ${data.sizes.length} distinct sizes\n`);
for (const s of data.sizes) {
  console.log(
    `${String(s.size).padStart(5)}px  x${String(s.count).padEnd(3)} (${s.prose} prose)`,
  );
  for (const sample of s.samples) console.log(`          ${sample}`);
}

ws.close();
chrome.kill();
process.exit(0);

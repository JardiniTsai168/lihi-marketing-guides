import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";

const serverPort = 4175;
const debugPort = 9224;
const profileDir = `/tmp/lihi-cover-aspect-${process.pid}`;
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const server = spawn("python3", ["-m", "http.server", String(serverPort), "--bind", "127.0.0.1"], {
  stdio: "ignore",
});
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--no-first-run",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForBrowser() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error("Chrome DevTools did not become available");
}

async function run() {
  await waitForBrowser();
  const response = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?http://127.0.0.1:${serverPort}/`,
    { method: "PUT" },
  );
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id || !pending.has(message.id)) return;
    pending.get(message.id)(message);
    pending.delete(message.id);
  };
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++sequence;
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  const cases = [];
  for (const width of [1440, 390, 320]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/` });
    await wait(1000);
    const result = await send("Runtime.evaluate", {
      expression: `JSON.stringify({
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        buttonHeights: [...document.querySelectorAll('.download-button')].map((button) => button.getBoundingClientRect().height),
        covers: [...document.querySelectorAll('.book img, .guide-cover img')].map((image, index) => ({
          index,
          src: image.getAttribute('src'),
          naturalRatio: image.naturalWidth / image.naturalHeight,
          displayedRatio: image.clientWidth / image.clientHeight
        }))
      })`,
      returnByValue: true,
    });
    cases.push(JSON.parse(result.result.result.value));
  }
  socket.close();

  const failures = cases.flatMap((testCase) => [
    ...testCase.covers
      .filter(({ naturalRatio, displayedRatio }) => Math.abs(naturalRatio - displayedRatio) > 0.02)
      .map((cover) => ({ viewport: testCase.viewport, type: "cover-ratio", ...cover })),
    ...(testCase.documentWidth > testCase.viewport
      ? [{ viewport: testCase.viewport, type: "horizontal-overflow", documentWidth: testCase.documentWidth }]
      : []),
    ...testCase.buttonHeights
      .filter((height) => height < 44)
      .map((height) => ({ viewport: testCase.viewport, type: "small-touch-target", height })),
  ]);
  console.log(JSON.stringify({ cases, failures }, null, 2));
  if (failures.length) {
    throw new Error(`${failures.length} cover image(s) are cropped by a mismatched display ratio`);
  }
}

try {
  await run();
} finally {
  server.kill("SIGTERM");
  chrome.kill("SIGTERM");
  await wait(150);
  await rm(profileDir, { recursive: true, force: true });
}

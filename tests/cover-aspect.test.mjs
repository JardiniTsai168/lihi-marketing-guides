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
  for (const width of [1440, 1024, 768, 390, 320]) {
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: width < 768,
    });
    await send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/` });
    await wait(1000);
    await send("Runtime.evaluate", {
      expression: `(async () => {
        await document.fonts.ready;
      })()`,
      awaitPromise: true,
    });
    const result = await send("Runtime.evaluate", {
      expression: `JSON.stringify({
        viewport: innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        buttonHeights: [...document.querySelectorAll('.download-button')].map((button) => button.getBoundingClientRect().height),
        shell: {
          heroTopGap: document.querySelector('.hero .eyebrow').getBoundingClientRect().top - document.querySelector('.site-nav').getBoundingClientRect().bottom,
          introTopPadding: parseFloat(getComputedStyle(document.querySelector('.guide-intro')).paddingTop),
          hasChooseYourGuide: document.body.textContent.includes('CHOOSE YOUR GUIDE'),
          navLinks: [...document.querySelectorAll('.nav-links > li > a, .nav-links > li > button')].map((item) => item.textContent.trim().replace(/\s+/g, ' ')),
          footerLinks: [...document.querySelectorAll('.footer-links a')].map((item) => item.textContent.trim()),
          footerSocialCount: document.querySelectorAll('.footer-social a').length
        },
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

  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/` });
  await wait(500);
  const mobileMenuResult = await send("Runtime.evaluate", {
    expression: `(async () => {
      const hamburger = document.querySelector('.nav-hamburger');
      hamburger.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const open = hamburger.getAttribute('aria-expanded') === 'true'
        && document.querySelector('#mobile-menu').getAttribute('aria-hidden') === 'false'
        && document.body.classList.contains('menu-open');
      document.querySelector('.mobile-submenu-toggle').click();
      const submenuOpen = document.querySelector('.mobile-submenu-toggle').getAttribute('aria-expanded') === 'true'
        && document.querySelector('.mobile-submenu').classList.contains('is-open');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      const closed = hamburger.getAttribute('aria-expanded') === 'false'
        && document.querySelector('#mobile-menu').getAttribute('aria-hidden') === 'true'
        && !document.body.classList.contains('menu-open');
      return JSON.stringify({ open, submenuOpen, closed });
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const mobileMenuState = JSON.parse(mobileMenuResult.result.result.value);
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
    ...(testCase.shell.heroTopGap < 0 || testCase.shell.heroTopGap > 32
      ? [{ viewport: testCase.viewport, type: "hero-top-gap", gap: testCase.shell.heroTopGap }]
      : []),
    ...(testCase.shell.introTopPadding > 24
      ? [{ viewport: testCase.viewport, type: "intro-top-padding", padding: testCase.shell.introTopPadding }]
      : []),
    ...(testCase.shell.hasChooseYourGuide
      ? [{ viewport: testCase.viewport, type: "choose-your-guide-copy" }]
      : []),
    ...(JSON.stringify(testCase.shell.navLinks) !== JSON.stringify(["品牌網域", "方案價格", "行銷資源 ▾", "關於我們"])
      ? [{ viewport: testCase.viewport, type: "nav-links", links: testCase.shell.navLinks }]
      : []),
    ...(JSON.stringify(testCase.shell.footerLinks) !== JSON.stringify(["服務條款", "隱私權政策", "服務等級", "檢舉網址", "service@lihi.io"])
      ? [{ viewport: testCase.viewport, type: "footer-links", links: testCase.shell.footerLinks }]
      : []),
    ...(testCase.shell.footerSocialCount !== 3
      ? [{ viewport: testCase.viewport, type: "footer-social-count", count: testCase.shell.footerSocialCount }]
      : []),
  ]);
  if (!mobileMenuState.open || !mobileMenuState.submenuOpen || !mobileMenuState.closed) {
    failures.push({ type: "mobile-menu", ...mobileMenuState });
  }
  console.log(JSON.stringify({ cases, mobileMenuState, failures }, null, 2));
  if (failures.length) {
    throw new Error(`${failures.length} responsive shell or cover regression(s) detected`);
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

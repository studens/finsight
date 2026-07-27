#!/usr/bin/env node
// Playwright/브라우저 MCP가 없는 환경에서 headless Chrome + CDP로 화면을 확인하는 도구.
// (handoff.md의 "브라우저 시각 검증 표준"을 실행 가능한 스크립트로 옮긴 것)
//
// 사용법:
//   node scripts/visual-check.js <url> [--mobile] [--out=path.png] [--select="찾을 텍스트"]
//
// 예시:
//   node scripts/visual-check.js http://localhost:3000/            # 데스크톱 풀페이지
//   node scripts/visual-check.js http://localhost:3000/ --mobile   # 모바일(390px) 풀페이지, 오버플로 체크
//   node scripts/visual-check.js http://localhost:3000/ --select="인사이트 확인" --out=/tmp/step3.png
//
// 콘솔 에러, scrollWidth(가로 오버플로 여부), 저장 경로를 JSON으로 출력한다.

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function findChrome() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error("Chrome을 찾을 수 없습니다. --chrome=<경로>로 직접 지정하세요.");
}

function parseArgs(argv) {
  const args = { mobile: false, out: null, select: null, chrome: null };
  const positional = [];
  for (const arg of argv) {
    if (arg === "--mobile") args.mobile = true;
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else if (arg.startsWith("--select=")) args.select = arg.slice("--select=".length);
    else if (arg.startsWith("--chrome=")) args.chrome = arg.slice("--chrome=".length);
    else positional.push(arg);
  }
  args.url = positional[0];
  return args;
}

async function waitForCdp(port, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`);
      if (res.ok) return;
    } catch {
      // 아직 준비 안 됨, 재시도
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error("Chrome CDP가 응답하지 않습니다.");
}

function send(ws, pending, idRef, method, params = {}) {
  return new Promise((resolve) => {
    const id = ++idRef.value;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.url) {
    console.error(
      '사용법: node scripts/visual-check.js <url> [--mobile] [--out=path.png] [--select="찾을 텍스트"]',
    );
    process.exit(1);
  }

  const chromePath = args.chrome || findChrome();
  const port = 9200 + Math.floor(Math.random() * 800);

  const chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    await waitForCdp(port);

    const putRes = await fetch(
      `http://localhost:${port}/json/new?${encodeURIComponent(args.url)}`,
      { method: "PUT" },
    );
    const target = await putRes.json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    const idRef = { value: 0 };
    const consoleErrors = [];

    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg.result);
        pending.delete(msg.id);
      } else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        consoleErrors.push(msg.params.entry.text);
      }
    });

    await new Promise((resolve) => ws.addEventListener("open", resolve));
    const s = (method, params) => send(ws, pending, idRef, method, params);

    await s("Page.enable");
    await s("Runtime.enable");
    await s("Log.enable");

    const width = args.mobile ? 390 : 1280;
    await s("Emulation.setDeviceMetricsOverride", {
      width,
      height: args.mobile ? 844 : 900,
      deviceScaleFactor: args.mobile ? 2 : 1,
      mobile: args.mobile,
    });

    await new Promise((r) => setTimeout(r, 1500));

    const scrollWidthRes = await s("Runtime.evaluate", {
      expression: "document.documentElement.scrollWidth",
    });
    const heightRes = await s("Runtime.evaluate", {
      expression: "document.body.scrollHeight",
    });
    const scrollWidth = scrollWidthRes.result.value;
    const fullHeight = heightRes.result.value;

    let clip = { x: 0, y: 0, width, height: Math.min(fullHeight, 8000), scale: 1 };

    if (args.select) {
      const rectRes = await s("Runtime.evaluate", {
        expression: `(() => {
          const needle = ${JSON.stringify(args.select)};
          const all = Array.from(document.querySelectorAll("*"));
          const target = all.find(
            (el) => el.children.length === 0 && el.textContent && el.textContent.includes(needle)
          );
          if (!target) return null;
          const card = target.closest("div") || target;
          const r = card.getBoundingClientRect();
          return JSON.stringify({ x: r.x, y: r.y, width: r.width, height: r.height });
        })()`,
        returnByValue: true,
      });
      if (rectRes.result.value) {
        const rect = JSON.parse(rectRes.result.value);
        const pad = 12;
        clip = {
          x: Math.max(0, rect.x - pad),
          y: Math.max(0, rect.y - pad),
          width: rect.width + pad * 2,
          height: rect.height + pad * 2,
          scale: 1,
        };
      } else {
        console.warn(`"${args.select}" 텍스트를 가진 엘리먼트를 못 찾음 — 전체 페이지로 캡처합니다.`);
        await s("Emulation.setDeviceMetricsOverride", {
          width,
          height: Math.min(fullHeight, 8000),
          deviceScaleFactor: args.mobile ? 2 : 1,
          mobile: args.mobile,
        });
        await new Promise((r) => setTimeout(r, 300));
      }
    } else {
      await s("Emulation.setDeviceMetricsOverride", {
        width,
        height: Math.min(fullHeight, 8000),
        deviceScaleFactor: args.mobile ? 2 : 1,
        mobile: args.mobile,
      });
      await new Promise((r) => setTimeout(r, 300));
    }

    const shot = await s("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip,
    });

    const outPath = args.out || path.join(process.cwd(), `visual-check-${port}.png`);
    fs.writeFileSync(outPath, Buffer.from(shot.data, "base64"));

    console.log(
      JSON.stringify(
        {
          url: args.url,
          mode: args.mobile ? "mobile" : "desktop",
          viewportWidth: width,
          scrollWidth,
          overflow: scrollWidth > width,
          consoleErrors,
          saved: outPath,
        },
        null,
        2,
      ),
    );

    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

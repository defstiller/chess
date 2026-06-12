import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { WebSocket } from "ws";

const url = process.env.CHESS_URL ?? "http://127.0.0.1:5174";
const chromePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactsDir = new URL("../artifacts/", import.meta.url);
const browserIssues = [];
const leaderboardStorageKey = "chessAtelierLeaderboard";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function resetServer() {
  await fetch(`${url}/__reset`, { method: "POST" }).catch(() => undefined);
}

async function probe(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const gl = canvas?.getContext?.("webgl2") ?? canvas?.getContext?.("webgl");
    const pixel = new Uint8Array(4);
    let litSamples = 0;

    if (gl) {
      for (let y = 0; y < 7; y += 1) {
        for (let x = 0; x < 7; x += 1) {
          const sampleX = Math.floor((gl.drawingBufferWidth * (x + 0.5)) / 7);
          const sampleY = Math.floor((gl.drawingBufferHeight * (y + 0.5)) / 7);
          gl.readPixels(sampleX, sampleY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
          if (pixel[3] > 0 && pixel[0] + pixel[1] + pixel[2] > 30) {
            litSamples += 1;
          }
        }
      }
    }

    return {
      canvasCount: document.querySelectorAll("canvas").length,
      litSamples,
      moveList: document.querySelector("#moveList")?.textContent ?? "",
      role: document.querySelector("#roleBadge")?.textContent ?? "",
      status: document.querySelector("#statusText")?.textContent ?? "",
      turn: document.querySelector("#turnBadge")?.textContent ?? "",
      controls: {
        newDisabled: document.querySelector("#newGameBtn")?.hasAttribute("disabled") ?? null,
        undoPresent: Boolean(document.querySelector("#undoBtn")),
      },
      score: {
        whiteName: document.querySelector("#whitePlayerName")?.textContent ?? "",
        blackName: document.querySelector("#blackPlayerName")?.textContent ?? "",
        white: document.querySelector("#whiteGameScore")?.textContent ?? "",
        black: document.querySelector("#blackGameScore")?.textContent ?? "",
        draws: document.querySelector("#drawGameScore")?.textContent ?? "",
        whiteMaterial: document.querySelector("#whiteMaterial")?.textContent ?? "",
        blackMaterial: document.querySelector("#blackMaterial")?.textContent ?? "",
        lead: document.querySelector("#scoreLead")?.textContent ?? "",
      },
      leaderboardText: document.querySelector("#leaderboardList")?.textContent ?? "",
      debug: window.__chessAtelier?.probe?.() ?? null,
    };
  });
}

function leaderboardRecord(name, wins, losses, draws, updatedAt) {
  const id = name.toLocaleLowerCase("ru-RU");
  return { id, name, wins, losses, draws, games: wins + losses + draws, updatedAt };
}

function leaderboardSeed(records, updatedAt) {
  return {
    version: 1,
    updatedAt,
    records: Object.fromEntries(records.map((record) => [record.id, record])),
    games: {},
    removedGames: {},
  };
}

async function storedLeaderboard(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), leaderboardStorageKey);
}

async function join(page, name) {
  await page.locator("#playerDialog:not([hidden])").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#playerNameInput").fill(name);
  await page.locator("#playerSubmitBtn").click();
  await page.locator("#playerDialog").waitFor({ state: "hidden", timeout: 5000 });
  await page.waitForTimeout(300);
}

async function squarePoint(page, square) {
  return page.evaluate((targetSquare) => window.__chessAtelier.squareScreen(targetSquare), square);
}

async function clickSquare(page, square) {
  const point = await squarePoint(page, square);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(180);
}

async function playMove(page, from, to) {
  await clickSquare(page, from);
  await clickSquare(page, to);
  await page.waitForTimeout(320);
}

async function waitForSync(...pages) {
  await Promise.all(pages.map((page) => page.waitForTimeout(450)));
}

async function sendRawGameMessageAs(page, payload) {
  const clientKey = await page.evaluate(() => localStorage.getItem("chessAtelierClientKey"));
  const socketUrl = new URL("/game", url);
  socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(socketUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`timed out sending ${payload.type}`));
    }, 3000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "hello", clientKey }));
      ws.send(JSON.stringify({ ...payload, clientKey }));
      setTimeout(() => {
        clearTimeout(timer);
        ws.close();
        resolve();
      }, 250);
    });

    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function openPage(browser, viewport = { width: 1280, height: 720 }, seed = null) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: viewport.width < 600 ? 2 : 1,
    hasTouch: viewport.width < 600,
    isMobile: viewport.width < 600,
  });
  if (seed) {
    await context.addInitScript(
      ({ key, value }) => {
        localStorage.setItem(key, JSON.stringify(value));
      },
      { key: leaderboardStorageKey, value: seed },
    );
  }
  const page = await context.newPage();
  page.on("pageerror", (error) => browserIssues.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserIssues.push(`console: ${message.text()}`);
    }
  });
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  await page.waitForTimeout(700);
  return { context, page };
}

async function assertJumpRules(browser) {
  await resetServer();
  const white = await openPage(browser);
  await join(white.page, "Правила");

  const initial = await probe(white.page);
  await clickSquare(white.page, "h1");
  await clickSquare(white.page, "h3");
  const afterRookAttempt = await probe(white.page);
  assert(afterRookAttempt.debug.fen === initial.debug.fen, "rook should not jump over its pawn");

  await clickSquare(white.page, "g1");
  await clickSquare(white.page, "f3");
  const afterKnightJump = await probe(white.page);
  assert(afterKnightJump.debug.fen !== initial.debug.fen, "knight should be able to jump");
  assert(afterKnightJump.moveList.includes("Кf3"), "knight jump should be recorded with Russian notation");

  await white.context.close();
  await resetServer();
}

function assertNoBrowserIssues() {
  assert(browserIssues.length === 0, `browser errors found:\n${browserIssues.join("\n")}`);
}

await mkdir(artifactsDir, { recursive: true });
await resetServer();

const browser = await chromium.launch({ executablePath: chromePath, headless: true });

try {
  await assertJumpRules(browser);

  const newSeed = leaderboardSeed(
    [leaderboardRecord("Алиса", 7, 1, 0, 5000), leaderboardRecord("Борис", 4, 2, 0, 5000)],
    5000,
  );
  const oldSeed = leaderboardSeed(
    [
      leaderboardRecord("Алиса", 1, 9, 0, 1000),
      leaderboardRecord("Борис", 1, 8, 0, 1000),
      leaderboardRecord("Вера", 2, 0, 1, 1000),
      leaderboardRecord("Глеб", 1, 1, 2, 1000),
      leaderboardRecord("Диана", 0, 0, 3, 1000),
    ],
    1000,
  );

  const white = await openPage(browser, { width: 1280, height: 720 }, newSeed);
  await join(white.page, "Алиса");
  let whiteProbe = await probe(white.page);
  assert(whiteProbe.role === "Белые", "first visitor should become Белые");
  assert(whiteProbe.status === "ВАШ ХОД: Алиса", "White name did not drive the Russian status");
  assert(whiteProbe.score.whiteName === "Алиса", "White scoreboard name is wrong");
  assert(whiteProbe.controls.newDisabled, "new game should be disabled before the game is over");
  assert(!whiteProbe.controls.undoPresent, "takeback button should not exist in competitive mode");
  assert(whiteProbe.canvasCount === 1 && whiteProbe.litSamples > 8, "desktop canvas appears blank");
  await white.page.screenshot({ path: fileURLToPath(new URL("chess-russian-desktop.png", artifactsDir)), fullPage: false });

  const black = await openPage(browser, { width: 1280, height: 720 }, oldSeed);
  await join(black.page, "Борис");
  let blackProbe = await probe(black.page);
  assert(blackProbe.role === "Черные", "second visitor should become Черные");
  assert(blackProbe.score.blackName === "Борис", "Black scoreboard name is wrong");
  await waitForSync(white.page, black.page);

  whiteProbe = await probe(white.page);
  blackProbe = await probe(black.page);
  const mergedRecords = whiteProbe.debug.leaderboard.records;
  assert(mergedRecords["алиса"].wins === 7, "newer Алиса record should win during merge");
  assert(mergedRecords["борис"].wins === 4, "newer Борис record should win during merge");
  assert(mergedRecords["вера"].wins === 2, "missing older Вера record should be added");
  assert(mergedRecords["глеб"].draws === 2, "missing older Глеб record should be added");
  assert(mergedRecords["диана"].draws === 3, "missing older Диана record should be added");
  assert(blackProbe.debug.leaderboard.records["алиса"].wins === 7, "merged leaderboard did not return to second browser");
  assert(whiteProbe.leaderboardText.includes("Алиса"), "leaderboard UI should show merged rows");
  assert((await storedLeaderboard(black.page)).records["вера"].wins === 2, "merged leaderboard was not saved locally");

  const spectator = await openPage(browser);
  await join(spectator.page, "София");
  let spectatorProbe = await probe(spectator.page);
  assert(spectatorProbe.role === "Зритель", "third visitor should be a spectator");
  assert(spectatorProbe.controls.newDisabled && !spectatorProbe.controls.undoPresent, "spectator controls should be competitive-safe");

  const spectatorFen = spectatorProbe.debug.fen;
  await clickSquare(spectator.page, "f2");
  await clickSquare(spectator.page, "f3");
  await waitForSync(spectator.page);
  spectatorProbe = await probe(spectator.page);
  assert(spectatorProbe.debug.fen === spectatorFen, "spectator changed the board");

  await playMove(white.page, "f2", "f3");
  await waitForSync(white.page, black.page);
  whiteProbe = await probe(white.page);
  blackProbe = await probe(black.page);
  const savedFenAfterFirstMove = whiteProbe.debug.fen;
  assert(whiteProbe.status === "Ход соперника: Борис", "white should clearly see opponent turn after moving");
  assert(blackProbe.status === "ВАШ ХОД: Борис", "black should clearly see own turn after white move");
  await white.page.reload({ waitUntil: "networkidle" });
  await white.page.waitForSelector("canvas");
  await waitForSync(white.page, black.page);
  whiteProbe = await probe(white.page);
  assert(whiteProbe.debug.fen === savedFenAfterFirstMove, "server did not preserve accepted move after reload");
  assert(whiteProbe.status === "Ход соперника: Борис", "reload should keep the saved server turn");
  const activeFen = (await probe(white.page)).debug.fen;
  await sendRawGameMessageAs(white.page, { type: "undo" });
  await sendRawGameMessageAs(white.page, { type: "newGame" });
  await waitForSync(white.page, black.page, spectator.page);
  assert((await probe(white.page)).debug.fen === activeFen, "competitive game accepted a takeback or early reset");

  await playMove(black.page, "e7", "e5");
  await playMove(white.page, "g2", "g4");
  await playMove(black.page, "d8", "h4");
  await waitForSync(white.page, black.page, spectator.page);

  whiteProbe = await probe(white.page);
  blackProbe = await probe(black.page);
  spectatorProbe = await probe(spectator.page);
  assert(whiteProbe.status === "Мат. Победитель: Борис", "black checkmate status is wrong");
  assert(whiteProbe.score.black === "1", "black score should increment after checkmate");
  assert(whiteProbe.score.lead === "Борис +1", "score lead should favor black after game one");
  assert(blackProbe.moveList.includes("Фh4#"), "Russian queen notation was not rendered for black checkmate");
  assert(spectatorProbe.status === "Мат. Победитель: Борис", "spectator did not sync black checkmate");
  assert(whiteProbe.debug.leaderboard.records["борис"].wins === 5, "black win should update saved leaderboard");
  assert(!whiteProbe.controls.newDisabled, "new game should unlock after checkmate");

  await white.page.screenshot({
    path: fileURLToPath(new URL("chess-russian-black-mate.png", artifactsDir)),
    fullPage: false,
  });

  await white.page.locator("#newGameBtn").click();
  await waitForSync(white.page, black.page, spectator.page);
  whiteProbe = await probe(white.page);
  assert(whiteProbe.status === "ВАШ ХОД: Алиса", "new game should return to White's turn");
  assert(whiteProbe.moveList.trim() === "", "new game should clear move list");
  assert(whiteProbe.score.black === "1", "new game should keep match score");

  await playMove(white.page, "e2", "e4");
  await playMove(black.page, "e7", "e5");
  await playMove(white.page, "d1", "h5");
  await playMove(black.page, "b8", "c6");
  await playMove(white.page, "f1", "c4");
  await playMove(black.page, "g8", "f6");
  await playMove(white.page, "h5", "f7");
  await waitForSync(white.page, black.page, spectator.page);

  whiteProbe = await probe(white.page);
  blackProbe = await probe(black.page);
  spectatorProbe = await probe(spectator.page);
  assert(whiteProbe.status === "Мат. Победитель: Алиса", "white checkmate status is wrong");
  assert(whiteProbe.score.white === "1", "white score should increment after second checkmate");
  assert(whiteProbe.score.black === "1", "black score should remain from game one");
  assert(whiteProbe.score.lead === "Ровный матч", "score lead should be even after one win each");
  assert(blackProbe.moveList.includes("Фxf7#"), "Russian queen notation was not rendered for white checkmate");
  assert(spectatorProbe.status === "Мат. Победитель: Алиса", "spectator did not sync white checkmate");
  assert(whiteProbe.debug.leaderboard.records["алиса"].wins === 8, "white win should update saved leaderboard");
  assert(Object.keys(whiteProbe.debug.leaderboard.games).length === 2, "two completed server games should be deduped");

  await white.page.screenshot({
    path: fileURLToPath(new URL("chess-russian-white-mate.png", artifactsDir)),
    fullPage: false,
  });

  const mobile = await openPage(browser, { width: 390, height: 844 });
  await join(mobile.page, "Максим");
  const mobileProbe = await probe(mobile.page);
  assert(mobileProbe.role === "Зритель", "mobile fourth visitor should watch");
  assert(mobileProbe.canvasCount === 1 && mobileProbe.litSamples > 8, "mobile canvas appears blank");
  assert(mobileProbe.status === "Мат. Победитель: Алиса", "mobile spectator did not receive final game state");
  await mobile.page.screenshot({
    path: fileURLToPath(new URL("chess-russian-mobile.png", artifactsDir)),
    fullPage: false,
  });

  assertNoBrowserIssues();

  await mobile.context.close();
  await spectator.context.close();
  await black.context.close();
  await white.context.close();

  console.log("russian multiplayer games: ok", {
    firstGame: "Борис матует",
    secondGame: "Алиса матует",
    score: `${whiteProbe.score.white}-${whiteProbe.score.black}-${whiteProbe.score.draws}`,
    leaderboardRows: Object.keys(whiteProbe.debug.leaderboard.records).length,
    spectatorRole: spectatorProbe.role,
    mobileRole: mobileProbe.role,
  });
} finally {
  await browser.close();
}

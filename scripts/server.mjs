import { createServer as createHttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";
import { WebSocketServer } from "ws";

const rootDir = fileURLToPath(new URL("../", import.meta.url));
const distDir = join(rootDir, "dist");
const stateFile = process.env.CHESS_STATE_FILE?.trim() || join(rootDir, "data", "game-state.json");
const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const configuredPort = process.env.PORT?.trim();
const rawPort = configuredPort || (production ? "3000" : "5174");
const parsedPort = Number(rawPort);
const listenTarget = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : rawPort;
const host = process.env.HOST?.trim();

const clients = new Map();
const seats = { w: null, b: null };
let game = new Chess();
let score = { white: 0, black: 0, draws: 0 };
let recordedResult = null;
let nextClientId = 1;
let matchId = randomUUID();
let gameNumber = 1;
let currentGameId = `${matchId}:${gameNumber}`;
let leaderboard = emptyLeaderboard();
let stateRevision = 0;

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

function cleanName(value, fallback) {
  const clean = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 18);
  return clean || fallback;
}

function cleanId(value) {
  return String(value ?? "").trim().slice(0, 140);
}

function playerId(name) {
  return cleanName(name, "Игрок").toLocaleLowerCase("ru-RU");
}

function emptyLeaderboard() {
  return {
    version: 1,
    updatedAt: Date.now(),
    records: {},
    games: {},
    removedGames: {},
  };
}

function nextGameId() {
  gameNumber += 1;
  currentGameId = `${matchId}:${gameNumber}`;
}

function resetAll() {
  game = new Chess();
  score = { white: 0, black: 0, draws: 0 };
  recordedResult = null;
  matchId = randomUUID();
  gameNumber = 1;
  currentGameId = `${matchId}:${gameNumber}`;
  leaderboard = emptyLeaderboard();
  seats.w = null;
  seats.b = null;
  markStateChanged();
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
}

function cleanScore(raw) {
  return {
    white: safeNumber(raw?.white),
    black: safeNumber(raw?.black),
    draws: safeNumber(raw?.draws),
  };
}

function cleanResult(raw) {
  return raw === "white" || raw === "black" || raw === "draw" ? raw : null;
}

function cleanSeat(raw) {
  if (!raw || typeof raw !== "object" || !raw.clientKey) {
    return null;
  }
  return {
    clientKey: cleanName(raw.clientKey, ""),
    name: cleanName(raw.name, "Игрок"),
    connected: false,
  };
}

function cleanLeaderboardRecord(raw) {
  const name = cleanName(raw?.name, "Игрок");
  const id = playerId(raw?.id ?? name);
  const wins = safeNumber(raw?.wins);
  const losses = safeNumber(raw?.losses);
  const draws = safeNumber(raw?.draws);
  const games = safeNumber(raw?.games) || wins + losses + draws;
  const updatedAt = safeNumber(raw?.updatedAt) || Date.now();
  return { id, name, wins, losses, draws, games, updatedAt };
}

function cleanLeaderboardGame(raw) {
  const id = cleanId(raw?.id);
  if (!id) {
    return null;
  }
  const result = raw?.result === "white" || raw?.result === "black" || raw?.result === "draw" ? raw.result : null;
  if (!result) {
    return null;
  }
  const whiteId = playerId(raw?.whiteId ?? raw?.whiteName ?? "Белые");
  const blackId = playerId(raw?.blackId ?? raw?.blackName ?? "Черные");
  const completedAt = safeNumber(raw?.completedAt) || Date.now();
  const updatedAt = safeNumber(raw?.updatedAt) || completedAt;
  return { id, whiteId, blackId, result, completedAt, updatedAt };
}

function mergeLeaderboard(incoming) {
  if (!incoming || typeof incoming !== "object") {
    return false;
  }

  let changed = false;
  const incomingRecords = Object.values(incoming.records ?? {}).slice(0, 100);
  incomingRecords.forEach((rawRecord) => {
    const record = cleanLeaderboardRecord(rawRecord);
    const existing = leaderboard.records[record.id];
    if (!existing || record.updatedAt > existing.updatedAt) {
      leaderboard.records[record.id] = record;
      changed = true;
    }
  });

  Object.entries(incoming.removedGames ?? {})
    .slice(0, 400)
    .forEach(([id, rawRemovedAt]) => {
      const removedAt = safeNumber(rawRemovedAt) || Date.now();
      if (!leaderboard.removedGames[id] || removedAt > leaderboard.removedGames[id]) {
        leaderboard.removedGames[id] = removedAt;
        delete leaderboard.games[id];
        changed = true;
      }
    });

  const incomingGames = Object.values(incoming.games ?? {}).slice(0, 400);
  incomingGames.forEach((rawGame) => {
    const gameRecord = cleanLeaderboardGame(rawGame);
    if (!gameRecord) {
      return;
    }
    if (leaderboard.removedGames[gameRecord.id] && leaderboard.removedGames[gameRecord.id] >= gameRecord.updatedAt) {
      return;
    }
    const existing = leaderboard.games[gameRecord.id];
    if (!existing || gameRecord.updatedAt > existing.updatedAt) {
      leaderboard.games[gameRecord.id] = gameRecord;
      changed = true;
    }
  });

  if (changed) {
    leaderboard.updatedAt = Math.max(safeNumber(incoming.updatedAt), Date.now());
  }
  return changed;
}

function exportedMoves() {
  return game.history({ verbose: true }).map((move) => ({
    from: move.from,
    to: move.to,
    promotion: move.promotion,
  }));
}

function publicSeatForSave(seat) {
  return seat ? { clientKey: seat.clientKey, name: seat.name } : null;
}

function serializedState() {
  return {
    version: 1,
    savedAt: Date.now(),
    stateRevision,
    matchId,
    gameNumber,
    currentGameId,
    fen: game.fen(),
    moves: exportedMoves(),
    score,
    recordedResult,
    leaderboard,
    seats: {
      w: publicSeatForSave(seats.w),
      b: publicSeatForSave(seats.b),
    },
  };
}

function persistState() {
  try {
    mkdirSync(dirname(stateFile), { recursive: true });
    const tempFile = `${stateFile}.${process.pid}.tmp`;
    writeFileSync(tempFile, JSON.stringify(serializedState(), null, 2), "utf8");
    renameSync(tempFile, stateFile);
  } catch (error) {
    console.warn(`Could not save chess state: ${error.message}`);
  }
}

function markStateChanged() {
  stateRevision += 1;
  persistState();
}

function restoreGame(raw) {
  const restoredGame = new Chess();
  const moves = Array.isArray(raw?.moves) ? raw.moves : [];

  if (moves.length > 0) {
    for (const rawMove of moves) {
      const from = cleanId(rawMove?.from);
      const to = cleanId(rawMove?.to);
      const promotion = ["q", "r", "b", "n"].includes(rawMove?.promotion) ? rawMove.promotion : undefined;
      restoredGame.move({ from, to, promotion });
    }
    game = restoredGame;
    return;
  }

  if (typeof raw?.fen === "string" && raw.fen.trim()) {
    restoredGame.load(raw.fen);
    game = restoredGame;
  }
}

function restorePersistedState() {
  try {
    const raw = JSON.parse(readFileSync(stateFile, "utf8"));
    if (!raw || raw.version !== 1) {
      return;
    }

    matchId = cleanId(raw.matchId) || randomUUID();
    gameNumber = safeNumber(raw.gameNumber) || 1;
    currentGameId = cleanId(raw.currentGameId) || `${matchId}:${gameNumber}`;
    score = cleanScore(raw.score);
    recordedResult = cleanResult(raw.recordedResult);
    leaderboard = emptyLeaderboard();
    mergeLeaderboard(raw.leaderboard);
    seats.w = cleanSeat(raw.seats?.w);
    seats.b = cleanSeat(raw.seats?.b);
    restoreGame(raw);
    stateRevision = safeNumber(raw.stateRevision);
    console.log(`Loaded chess state from ${stateFile}`);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not load chess state: ${error.message}`);
    }
  }
}

function ensureLeaderboardRecord(name) {
  const id = playerId(name);
  const existing = leaderboard.records[id];
  if (existing) {
    return existing;
  }
  const now = Date.now();
  const record = { id, name: cleanName(name, "Игрок"), wins: 0, losses: 0, draws: 0, games: 0, updatedAt: now };
  leaderboard.records[id] = record;
  return record;
}

function touchLeaderboardRecord(record, delta) {
  record.wins = Math.max(0, record.wins + (delta.wins ?? 0));
  record.losses = Math.max(0, record.losses + (delta.losses ?? 0));
  record.draws = Math.max(0, record.draws + (delta.draws ?? 0));
  record.games = Math.max(0, record.wins + record.losses + record.draws);
  record.updatedAt = Date.now();
  leaderboard.updatedAt = record.updatedAt;
}

function recordLeaderboardResult(result) {
  if (leaderboard.games[currentGameId]) {
    return;
  }
  delete leaderboard.removedGames[currentGameId];
  const whiteName = seats.w?.name ?? "Белые";
  const blackName = seats.b?.name ?? "Черные";
  const white = ensureLeaderboardRecord(whiteName);
  const black = ensureLeaderboardRecord(blackName);
  const completedAt = Date.now();

  leaderboard.games[currentGameId] = {
    id: currentGameId,
    whiteId: white.id,
    blackId: black.id,
    result,
    completedAt,
    updatedAt: completedAt,
  };

  if (result === "white") {
    touchLeaderboardRecord(white, { wins: 1 });
    touchLeaderboardRecord(black, { losses: 1 });
  } else if (result === "black") {
    touchLeaderboardRecord(white, { losses: 1 });
    touchLeaderboardRecord(black, { wins: 1 });
  } else {
    touchLeaderboardRecord(white, { draws: 1 });
    touchLeaderboardRecord(black, { draws: 1 });
  }
}

function resultForCurrentPosition() {
  if (game.isCheckmate()) {
    return game.turn() === "w" ? "black" : "white";
  }
  if (game.isStalemate() || game.isDraw()) {
    return "draw";
  }
  return null;
}

function applyScoreResult(result, delta) {
  if (result === "white") {
    score.white = Math.max(0, score.white + delta);
  } else if (result === "black") {
    score.black = Math.max(0, score.black + delta);
  } else if (result === "draw") {
    score.draws = Math.max(0, score.draws + delta);
  }
}

function recordResultIfNeeded() {
  const result = resultForCurrentPosition();
  if (result && !recordedResult) {
    applyScoreResult(result, 1);
    recordLeaderboardResult(result);
    recordedResult = result;
  }
}

function seatForClientKey(clientKey) {
  if (seats.w?.clientKey === clientKey) {
    return "w";
  }
  if (seats.b?.clientKey === clientKey) {
    return "b";
  }
  return null;
}

function roleForClient(client) {
  return seatForClientKey(client.clientKey) ?? client.role ?? null;
}

function publicStateFor(client) {
  const role = roleForClient(client);
  return {
    type: "state",
    clientId: client.id,
    role,
    canPlay: role === "w" || role === "b",
    stateRevision,
    seats: {
      w: seats.w ? { name: seats.w.name, connected: seats.w.connected } : null,
      b: seats.b ? { name: seats.b.name, connected: seats.b.connected } : null,
    },
    game: {
      id: currentGameId,
      fen: game.fen(),
      pgn: game.pgn(),
      turn: game.turn(),
      gameOver: game.isGameOver(),
    },
    names: {
      w: seats.w?.name ?? "Ждем белых",
      b: seats.b?.name ?? "Ждем черных",
    },
    score,
    recordedResult,
    leaderboard,
    history: game.history({ verbose: true }),
  };
}

function send(client, payload) {
  if (client.ws.readyState === client.ws.OPEN) {
    client.ws.send(JSON.stringify(payload));
  }
}

function isBoardSquare(value) {
  return typeof value === "string" && /^[a-h][1-8]$/i.test(value);
}

function broadcast() {
  clients.forEach((client) => send(client, publicStateFor(client)));
}

function broadcastHover(sourceClient, square) {
  const role = roleForClient(sourceClient);
  if (role !== "w" && role !== "b") {
    return;
  }

  let hoverSquare = null;
  if (isBoardSquare(square)) {
    const piece = game.get(square);
    hoverSquare = piece?.color === role ? square : null;
  }

  clients.forEach((client) => {
    if (client.id !== sourceClient.id) {
      send(client, { type: "hover", by: role, square: hoverSquare });
    }
  });
}

function sendError(client, message) {
  send(client, { type: "error", message });
}

function claimSeat(client, name) {
  const existingRole = seatForClientKey(client.clientKey);
  if (existingRole) {
    seats[existingRole] = { ...seats[existingRole], name, connected: true };
    client.role = existingRole;
    return;
  }

  if (!seats.w) {
    seats.w = { clientKey: client.clientKey, name, connected: true };
    client.role = "w";
    return;
  }

  if (!seats.b) {
    seats.b = { clientKey: client.clientKey, name, connected: true };
    client.role = "b";
    return;
  }

  client.role = "spectator";
}

function renameSeat(client, name) {
  const role = seatForClientKey(client.clientKey);
  if (!role) {
    client.name = name;
    return;
  }
  seats[role] = { ...seats[role], name, connected: true };
}

function handleMessage(client, raw) {
  let message;
  try {
    message = JSON.parse(raw.toString());
  } catch {
    sendError(client, "Не удалось прочитать сообщение.");
    return;
  }

  if (message.type === "hello") {
    client.clientKey = cleanName(message.clientKey, client.clientKey);
    if (mergeLeaderboard(message.leaderboard)) {
      markStateChanged();
    }
    const role = seatForClientKey(client.clientKey);
    if (role) {
      seats[role].connected = true;
      client.role = role;
    }
    broadcast();
    return;
  }

  if (message.type === "join") {
    const name = cleanName(message.name, "Игрок");
    client.clientKey = cleanName(message.clientKey, client.clientKey);
    client.name = name;
    mergeLeaderboard(message.leaderboard);
    claimSeat(client, name);
    markStateChanged();
    broadcast();
    return;
  }

  if (message.type === "rename") {
    const name = cleanName(message.name, "Игрок");
    mergeLeaderboard(message.leaderboard);
    renameSeat(client, name);
    markStateChanged();
    broadcast();
    return;
  }

  if (message.type === "leaderboard") {
    if (mergeLeaderboard(message.leaderboard)) {
      markStateChanged();
      broadcast();
    } else {
      send(client, publicStateFor(client));
    }
    return;
  }

  if (message.type === "hover") {
    broadcastHover(client, message.square);
    return;
  }

  if (message.type === "move") {
    const role = roleForClient(client);
    if (role !== game.turn()) {
      sendError(client, role === "spectator" ? "Зрители только смотрят." : "Сейчас не ваш ход.");
      return;
    }
    if (game.isGameOver()) {
      sendError(client, "Партия уже окончена.");
      return;
    }
    try {
      game.move({ from: message.from, to: message.to, promotion: message.promotion });
      broadcastHover(client, null);
      recordResultIfNeeded();
      markStateChanged();
      broadcast();
    } catch {
      sendError(client, "Недопустимый ход.");
    }
    return;
  }

  if (message.type === "undo") {
    sendError(client, "Откат ходов отключен для соревновательной партии.");
    return;
  }

  if (message.type === "newGame") {
    const role = roleForClient(client);
    if (role !== "w" && role !== "b") {
      sendError(client, "Зрители только смотрят.");
      return;
    }
    if (!game.isGameOver()) {
      sendError(client, "Новая партия доступна после завершения текущей.");
      return;
    }
    game.reset();
    recordedResult = null;
    nextGameId();
    broadcastHover(client, null);
    markStateChanged();
    broadcast();
  }
}

async function serveDist(req, res) {
  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") {
    pathname = "/index.html";
  }

  const candidate = normalize(join(distDir, pathname));
  const filePath = candidate.startsWith(normalize(distDir)) ? candidate : join(distDir, "index.html");

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    if (extname(pathname)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const body = await readFile(join(distDir, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(body);
  }
}

restorePersistedState();

const httpServer = createHttpServer();
const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname !== "/game") {
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws) => {
  const client = {
    id: `c${nextClientId++}`,
    ws,
    clientKey: `anonymous-${Math.random().toString(36).slice(2)}`,
    name: "",
    role: null,
  };
  clients.set(client.id, client);
  send(client, publicStateFor(client));

  ws.on("message", (raw) => handleMessage(client, raw));
  ws.on("close", () => {
    broadcastHover(client, null);
    clients.delete(client.id);
    const role = seatForClientKey(client.clientKey);
    if (role) {
      seats[role].connected = false;
    }
    broadcast();
  });
});

if (production) {
  httpServer.on("request", async (req, res) => {
    await serveDist(req, res);
  });
} else {
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    appType: "spa",
    server: {
      hmr: { server: httpServer },
      middlewareMode: true,
    },
  });

  httpServer.on("request", (req, res) => {
    if (req.method === "POST" && req.url === "/__reset") {
      resetAll();
      broadcast();
      res.writeHead(204);
      res.end();
      return;
    }
    vite.middlewares(req, res);
  });
}

const handleListening = () => {
  const address = typeof listenTarget === "number" && host ? `${host}:${listenTarget}` : listenTarget;
  console.log(`Chess Atelier running on ${address}`);
};

if (typeof listenTarget === "number" && host) {
  httpServer.listen(listenTarget, host, handleListening);
} else {
  httpServer.listen(listenTarget, handleListening);
}

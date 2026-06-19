import type { Color, Square } from "chess.js";

export type CheckersPiece = {
  color: Color;
  king: boolean;
};

export type CheckersBoard = Partial<Record<Square, CheckersPiece>>;

export type CheckersMove = {
  from: Square;
  to: Square;
  color: Color;
  path: Square[];
  captures: Square[];
  captured?: "m" | "k";
  promotion?: "k";
  san: string;
};

export type CheckersState = {
  board: CheckersBoard;
  turn: Color;
  winner: Color | null;
  history: CheckersMove[];
};

type Coords = {
  file: number;
  rank: number;
};

const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const ranks = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
const diagonalDirections = [
  { file: -1, rank: -1 },
  { file: 1, rank: -1 },
  { file: -1, rank: 1 },
  { file: 1, rank: 1 },
] as const;

export function createInitialCheckersState(): CheckersState {
  const board: CheckersBoard = {};
  for (let rank = 0; rank < 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      if (!isPlayable(file, rank)) {
        continue;
      }
      const square = toSquare(file, rank);
      if (!square) {
        continue;
      }
      if (rank <= 2) {
        board[square] = { color: "w", king: false };
      } else if (rank >= 5) {
        board[square] = { color: "b", king: false };
      }
    }
  }
  return { board, turn: "w", winner: null, history: [] };
}

export function cloneCheckersState(state: CheckersState): CheckersState {
  return {
    board: cloneBoard(state.board),
    turn: state.turn,
    winner: state.winner,
    history: state.history.map((move) => ({ ...move, path: [...move.path], captures: [...move.captures] })),
  };
}

export function serializeCheckersState(state: CheckersState) {
  return cloneCheckersState(state);
}

export function deserializeCheckersState(raw: unknown): CheckersState {
  if (!raw || typeof raw !== "object") {
    return createInitialCheckersState();
  }

  const value = raw as Partial<CheckersState>;
  const board: CheckersBoard = {};
  const rawBoard = value.board && typeof value.board === "object" ? value.board : {};
  Object.entries(rawBoard).forEach(([square, piece]) => {
    if (!isSquare(square) || !piece || typeof piece !== "object") {
      return;
    }
    const rawPiece = piece as Partial<CheckersPiece>;
    if (rawPiece.color !== "w" && rawPiece.color !== "b") {
      return;
    }
    board[square] = { color: rawPiece.color, king: Boolean(rawPiece.king) };
  });

  const turn = value.turn === "b" ? "b" : "w";
  const winner = value.winner === "w" || value.winner === "b" ? value.winner : null;
  const history = Array.isArray(value.history)
    ? value.history.map(cleanMove).filter((move): move is CheckersMove => Boolean(move))
    : [];

  return { board, turn, winner, history };
}

export function getCheckersPiece(state: CheckersState, square: Square): CheckersPiece | null {
  return state.board[square] ?? null;
}

export function getLegalCheckersMoves(state: CheckersState, square?: Square): CheckersMove[] {
  if (state.winner) {
    return [];
  }

  const captureMoves = allMoves(state, true);
  const moves = captureMoves.length > 0 ? captureMoves : allMoves(state, false);
  return square ? moves.filter((move) => move.from === square) : moves;
}

export function applyCheckersMove(state: CheckersState, from: Square, to: Square): { state: CheckersState; move: CheckersMove } | null {
  const legalMove = getLegalCheckersMoves(state, from)
    .filter((move) => move.to === to)
    .sort((a, b) => b.captures.length - a.captures.length)[0];

  if (!legalMove) {
    return null;
  }

  const next = cloneCheckersState(state);
  const movingPiece = next.board[from];
  if (!movingPiece) {
    return null;
  }

  delete next.board[from];
  legalMove.captures.forEach((square) => {
    delete next.board[square];
  });

  const landedPiece = { ...movingPiece };
  if (!landedPiece.king && (reachesKingRow(landedPiece.color, to) || legalMove.promotion === "k")) {
    landedPiece.king = true;
  }
  next.board[to] = landedPiece;
  next.turn = opposite(state.turn);
  next.winner = null;

  const appliedMove: CheckersMove = {
    ...legalMove,
    promotion: legalMove.promotion ?? (!movingPiece.king && landedPiece.king ? "k" : undefined),
  };
  next.history.push(appliedMove);

  if (!hasAnyPiece(next.board, next.turn)) {
    next.winner = state.turn;
  } else if (getLegalCheckersMoves(next).length === 0) {
    next.winner = state.turn;
  }

  return { state: next, move: appliedMove };
}

export function getCheckersResult(state: CheckersState): "white" | "black" | null {
  if (state.winner === "w") {
    return "white";
  }
  if (state.winner === "b") {
    return "black";
  }
  return null;
}

function allMoves(state: CheckersState, capturesOnly: boolean): CheckersMove[] {
  const moves: CheckersMove[] = [];
  Object.entries(state.board).forEach(([square, piece]) => {
    if (!piece || piece.color !== state.turn || !isSquare(square)) {
      return;
    }
    moves.push(...pieceMoves(state.board, square, piece, capturesOnly));
  });
  return moves;
}

function pieceMoves(board: CheckersBoard, from: Square, piece: CheckersPiece, capturesOnly: boolean): CheckersMove[] {
  if (capturesOnly) {
    return captureSequences(board, from, piece, [from], []);
  }
  return piece.king ? simpleKingMoves(board, from, piece) : simpleManMoves(board, from, piece);
}

function simpleManMoves(board: CheckersBoard, from: Square, piece: CheckersPiece): CheckersMove[] {
  const coords = fromSquare(from);
  if (!coords) {
    return [];
  }

  const rankStep = piece.color === "w" ? 1 : -1;
  return [-1, 1]
    .map((fileStep) => toSquare(coords.file + fileStep, coords.rank + rankStep))
    .filter((square): square is Square => Boolean(square && !board[square]))
    .map((to) => makeMove(from, to, piece, [from, to], []));
}

function simpleKingMoves(board: CheckersBoard, from: Square, piece: CheckersPiece): CheckersMove[] {
  const coords = fromSquare(from);
  if (!coords) {
    return [];
  }

  const moves: CheckersMove[] = [];
  diagonalDirections.forEach((direction) => {
    let file = coords.file + direction.file;
    let rank = coords.rank + direction.rank;
    while (inBoard(file, rank)) {
      const to = toSquare(file, rank);
      if (!to || board[to]) {
        break;
      }
      moves.push(makeMove(from, to, piece, [from, to], []));
      file += direction.file;
      rank += direction.rank;
    }
  });
  return moves;
}

function captureSequences(
  board: CheckersBoard,
  from: Square,
  piece: CheckersPiece,
  path: Square[],
  captures: Square[],
): CheckersMove[] {
  const continuations = piece.king
    ? kingCaptureContinuations(board, from, piece, path, captures)
    : manCaptureContinuations(board, from, piece, path, captures);
  if (continuations.length > 0) {
    return continuations.flatMap((next) => captureSequences(next.board, next.from, next.piece, next.path, next.captures));
  }
  if (captures.length === 0) {
    return [];
  }
  return [makeMove(path[0], from, piece, path, captures)];
}

function manCaptureContinuations(
  board: CheckersBoard,
  from: Square,
  piece: CheckersPiece,
  path: Square[],
  captures: Square[],
) {
  const coords = fromSquare(from);
  if (!coords) {
    return [];
  }

  return diagonalDirections.flatMap((direction) => {
    const capturedSquare = toSquare(coords.file + direction.file, coords.rank + direction.rank);
    const landingSquare = toSquare(coords.file + direction.file * 2, coords.rank + direction.rank * 2);
    if (!capturedSquare || !landingSquare || !isEnemy(board[capturedSquare], piece) || board[landingSquare]) {
      return [];
    }

    const nextPiece = { ...piece };
    if (!nextPiece.king && reachesKingRow(nextPiece.color, landingSquare)) {
      nextPiece.king = true;
    }

    const nextBoard = cloneBoard(board);
    delete nextBoard[from];
    delete nextBoard[capturedSquare];
    nextBoard[landingSquare] = nextPiece;

    return [
      {
        board: nextBoard,
        from: landingSquare,
        piece: nextPiece,
        path: [...path, landingSquare],
        captures: [...captures, capturedSquare],
      },
    ];
  });
}

function kingCaptureContinuations(
  board: CheckersBoard,
  from: Square,
  piece: CheckersPiece,
  path: Square[],
  captures: Square[],
) {
  const coords = fromSquare(from);
  if (!coords) {
    return [];
  }

  return diagonalDirections.flatMap((direction) => {
    const continuations = [];
    let file = coords.file + direction.file;
    let rank = coords.rank + direction.rank;
    let capturedSquare: Square | null = null;

    while (inBoard(file, rank)) {
      const square = toSquare(file, rank);
      if (!square) {
        break;
      }
      const occupyingPiece = board[square];
      if (!capturedSquare) {
        if (!occupyingPiece) {
          file += direction.file;
          rank += direction.rank;
          continue;
        }
        if (occupyingPiece.color === piece.color) {
          break;
        }
        capturedSquare = square;
        file += direction.file;
        rank += direction.rank;
        continue;
      }

      if (occupyingPiece) {
        break;
      }

      const nextBoard = cloneBoard(board);
      delete nextBoard[from];
      delete nextBoard[capturedSquare];
      nextBoard[square] = { ...piece };
      continuations.push({
        board: nextBoard,
        from: square,
        piece: { ...piece },
        path: [...path, square],
        captures: [...captures, capturedSquare],
      });
      file += direction.file;
      rank += direction.rank;
    }

    return continuations;
  });
}

function makeMove(from: Square, to: Square, piece: CheckersPiece, path: Square[], captures: Square[]): CheckersMove {
  const promoted = (!piece.king && reachesKingRow(piece.color, to)) || (piece.king && path.slice(1).some((square) => reachesKingRow(piece.color, square)));
  return {
    from,
    to,
    color: piece.color,
    path,
    captures,
    captured: captures.length > 0 ? "m" : undefined,
    promotion: promoted ? "k" : undefined,
    san: formatCheckersMove(path, captures.length > 0, promoted),
  };
}

function formatCheckersMove(path: Square[], capture: boolean, promoted: boolean) {
  const separator = capture ? "x" : "-";
  return `${path.join(separator)}${promoted ? "=K" : ""}`;
}

function cleanMove(rawMove: unknown): CheckersMove | null {
  if (!rawMove || typeof rawMove !== "object") {
    return null;
  }
  const move = rawMove as Partial<CheckersMove>;
  if (!isSquare(move.from) || !isSquare(move.to) || (move.color !== "w" && move.color !== "b")) {
    return null;
  }
  const path = Array.isArray(move.path) ? move.path.filter(isSquare) : [move.from, move.to];
  const captures = Array.isArray(move.captures) ? move.captures.filter(isSquare) : [];
  return {
    from: move.from,
    to: move.to,
    color: move.color,
    path: path.length >= 2 ? path : [move.from, move.to],
    captures,
    captured: captures.length > 0 ? "m" : undefined,
    promotion: move.promotion === "k" ? "k" : undefined,
    san: typeof move.san === "string" ? move.san : formatCheckersMove(path, captures.length > 0, move.promotion === "k"),
  };
}

function cloneBoard(board: CheckersBoard): CheckersBoard {
  const next: CheckersBoard = {};
  Object.entries(board).forEach(([square, piece]) => {
    if (piece && isSquare(square)) {
      next[square] = { ...piece };
    }
  });
  return next;
}

function hasAnyPiece(board: CheckersBoard, color: Color) {
  return Object.values(board).some((piece) => piece?.color === color);
}

function isEnemy(piece: CheckersPiece | undefined, movingPiece: CheckersPiece) {
  return Boolean(piece && piece.color !== movingPiece.color);
}

function reachesKingRow(color: Color, square: Square) {
  return color === "w" ? square.endsWith("8") : square.endsWith("1");
}

function opposite(color: Color): Color {
  return color === "w" ? "b" : "w";
}

function fromSquare(square: Square): Coords | null {
  const file = files.indexOf(square[0] as (typeof files)[number]);
  const rank = ranks.indexOf(square[1] as (typeof ranks)[number]);
  return file >= 0 && rank >= 0 ? { file, rank } : null;
}

function toSquare(file: number, rank: number): Square | null {
  if (!inBoard(file, rank)) {
    return null;
  }
  return `${files[file]}${ranks[rank]}` as Square;
}

function inBoard(file: number, rank: number) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

function isPlayable(file: number, rank: number) {
  return (file + rank) % 2 === 0;
}

function isSquare(value: unknown): value is Square {
  return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}

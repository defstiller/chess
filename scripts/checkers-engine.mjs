const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ranks = ["1", "2", "3", "4", "5", "6", "7", "8"];
const diagonalDirections = [
  { file: -1, rank: -1 },
  { file: 1, rank: -1 },
  { file: -1, rank: 1 },
  { file: 1, rank: 1 },
];

export function createInitialCheckersState() {
  const board = {};
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

export function cloneCheckersState(state) {
  return {
    board: cloneBoard(state.board),
    turn: state.turn,
    winner: state.winner,
    history: state.history.map((move) => ({ ...move, path: [...move.path], captures: [...move.captures] })),
  };
}

export function serializeCheckersState(state) {
  return cloneCheckersState(state);
}

export function deserializeCheckersState(raw) {
  if (!raw || typeof raw !== "object") {
    return createInitialCheckersState();
  }

  const board = {};
  const rawBoard = raw.board && typeof raw.board === "object" ? raw.board : {};
  Object.entries(rawBoard).forEach(([square, piece]) => {
    if (!isSquare(square) || !piece || typeof piece !== "object") {
      return;
    }
    if (piece.color !== "w" && piece.color !== "b") {
      return;
    }
    board[square] = { color: piece.color, king: Boolean(piece.king) };
  });

  const turn = raw.turn === "b" ? "b" : "w";
  const winner = raw.winner === "w" || raw.winner === "b" ? raw.winner : null;
  const history = Array.isArray(raw.history) ? raw.history.map(cleanMove).filter(Boolean) : [];
  return { board, turn, winner, history };
}

export function getCheckersPiece(state, square) {
  return state.board[square] ?? null;
}

export function getLegalCheckersMoves(state, square) {
  if (state.winner) {
    return [];
  }

  const captureMoves = allMoves(state, true);
  const moves = captureMoves.length > 0 ? captureMoves : allMoves(state, false);
  return square ? moves.filter((move) => move.from === square) : moves;
}

export function applyCheckersMove(state, from, to) {
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

  const appliedMove = {
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

export function getCheckersResult(state) {
  if (state.winner === "w") {
    return "white";
  }
  if (state.winner === "b") {
    return "black";
  }
  return null;
}

function allMoves(state, capturesOnly) {
  const moves = [];
  Object.entries(state.board).forEach(([square, piece]) => {
    if (!piece || piece.color !== state.turn || !isSquare(square)) {
      return;
    }
    moves.push(...pieceMoves(state.board, square, piece, capturesOnly));
  });
  return moves;
}

function pieceMoves(board, from, piece, capturesOnly) {
  if (capturesOnly) {
    return captureSequences(board, from, piece, [from], []);
  }
  return piece.king ? simpleKingMoves(board, from, piece) : simpleManMoves(board, from, piece);
}

function simpleManMoves(board, from, piece) {
  const coords = fromSquare(from);
  if (!coords) {
    return [];
  }

  const rankStep = piece.color === "w" ? 1 : -1;
  return [-1, 1]
    .map((fileStep) => toSquare(coords.file + fileStep, coords.rank + rankStep))
    .filter((square) => Boolean(square && !board[square]))
    .map((to) => makeMove(from, to, piece, [from, to], []));
}

function simpleKingMoves(board, from, piece) {
  const coords = fromSquare(from);
  if (!coords) {
    return [];
  }

  const moves = [];
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

function captureSequences(board, from, piece, path, captures) {
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

function manCaptureContinuations(board, from, piece, path, captures) {
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

function kingCaptureContinuations(board, from, piece, path, captures) {
  const coords = fromSquare(from);
  if (!coords) {
    return [];
  }

  return diagonalDirections.flatMap((direction) => {
    const continuations = [];
    let file = coords.file + direction.file;
    let rank = coords.rank + direction.rank;
    let capturedSquare = null;

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

function makeMove(from, to, piece, path, captures) {
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

function formatCheckersMove(path, capture, promoted) {
  const separator = capture ? "x" : "-";
  return `${path.join(separator)}${promoted ? "=K" : ""}`;
}

function cleanMove(rawMove) {
  if (!rawMove || typeof rawMove !== "object") {
    return null;
  }
  if (!isSquare(rawMove.from) || !isSquare(rawMove.to) || (rawMove.color !== "w" && rawMove.color !== "b")) {
    return null;
  }
  const path = Array.isArray(rawMove.path) ? rawMove.path.filter(isSquare) : [rawMove.from, rawMove.to];
  const captures = Array.isArray(rawMove.captures) ? rawMove.captures.filter(isSquare) : [];
  return {
    from: rawMove.from,
    to: rawMove.to,
    color: rawMove.color,
    path: path.length >= 2 ? path : [rawMove.from, rawMove.to],
    captures,
    captured: captures.length > 0 ? "m" : undefined,
    promotion: rawMove.promotion === "k" ? "k" : undefined,
    san: typeof rawMove.san === "string" ? rawMove.san : formatCheckersMove(path, captures.length > 0, rawMove.promotion === "k"),
  };
}

function cloneBoard(board) {
  const next = {};
  Object.entries(board).forEach(([square, piece]) => {
    if (piece && isSquare(square)) {
      next[square] = { ...piece };
    }
  });
  return next;
}

function hasAnyPiece(board, color) {
  return Object.values(board).some((piece) => piece?.color === color);
}

function isEnemy(piece, movingPiece) {
  return Boolean(piece && piece.color !== movingPiece.color);
}

function reachesKingRow(color, square) {
  return color === "w" ? square.endsWith("8") : square.endsWith("1");
}

function opposite(color) {
  return color === "w" ? "b" : "w";
}

function fromSquare(square) {
  const file = files.indexOf(square[0]);
  const rank = ranks.indexOf(square[1]);
  return file >= 0 && rank >= 0 ? { file, rank } : null;
}

function toSquare(file, rank) {
  if (!inBoard(file, rank)) {
    return null;
  }
  return `${files[file]}${ranks[rank]}`;
}

function inBoard(file, rank) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

function isPlayable(file, rank) {
  return (file + rank) % 2 === 0;
}

function isSquare(value) {
  return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}

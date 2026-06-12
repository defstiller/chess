import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import "./styles.css";

type PromotionPiece = "q" | "r" | "b" | "n";
type PieceColor = "w" | "b";

type PendingPromotion = {
  from: Square;
  to: Square;
};

type Captures = {
  white: PieceSymbol[];
  black: PieceSymbol[];
};

type ScoreResult = "white" | "black" | "draw";

type SessionScore = {
  white: number;
  black: number;
  draws: number;
};

type PlayerNames = Record<Color, string>;
type PlayerRole = Color | "spectator" | null;

type LeaderboardRecord = {
  id: string;
  name: string;
  wins: number;
  losses: number;
  draws: number;
  games: number;
  updatedAt: number;
};

type LeaderboardGame = {
  id: string;
  whiteId: string;
  blackId: string;
  result: ScoreResult;
  completedAt: number;
  updatedAt: number;
};

type LeaderboardState = {
  version: 1;
  updatedAt: number;
  records: Record<string, LeaderboardRecord>;
  games: Record<string, LeaderboardGame>;
  removedGames: Record<string, number>;
};

type ServerStateMessage = {
  type: "state";
  role: PlayerRole;
  canPlay: boolean;
  names: PlayerNames;
  score: SessionScore;
  recordedResult: ScoreResult | null;
  leaderboard?: LeaderboardState;
  game: {
    id?: string;
    fen: string;
    turn: Color;
    gameOver: boolean;
  };
  history: Move[];
  seats: {
    w: { name: string; connected: boolean } | null;
    b: { name: string; connected: boolean } | null;
  };
};

type DebugProbe = {
  canvas: {
    width: number;
    height: number;
    clientWidth: number;
    clientHeight: number;
  };
  camera: {
    freeCamera: boolean;
    fullScale: boolean;
    position: [number, number, number];
    testMode: boolean;
  };
  fen: string;
  frame: number;
  nonTransparentSamples: number;
  movingPieceCount: number;
  movingTrophyCount: number;
  pieceCount: number;
  trophyCount: number;
  score: SessionScore;
  leaderboard: LeaderboardState;
  role: PlayerRole;
  selectedSquare: string | null;
  soundEnabled: boolean;
  status: string;
  playerNames: PlayerNames;
};

type BoardPointerStart = {
  pointerId: number;
  button: number;
  x: number;
  y: number;
  square: Square | null;
  moved: boolean;
};

type PieceMoveAnimation = {
  from: Square;
  to: Square;
  capture: boolean;
};

type SceneMotion = {
  from: THREE.Vector3;
  to: THREE.Vector3;
  startedAt: number;
  duration: number;
  lift: number;
  spin: number;
};

type CaptureTrophy = {
  by: Color;
  color: Color;
  key: string;
  piece: PieceSymbol;
  square: Square;
};

const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const ranks = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;

const pieceOrder: Record<PieceSymbol, number> = {
  q: 1,
  r: 2,
  b: 3,
  n: 4,
  p: 5,
  k: 6,
};

const pieceValues: Record<PieceSymbol, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

const pieceGlyphs: Record<PieceColor, Record<PieceSymbol, string>> = {
  w: { p: "♙", n: "♘", b: "♗", r: "♖", q: "♕", k: "♔" },
  b: { p: "♟", n: "♞", b: "♝", r: "♜", q: "♛", k: "♚" },
};

const squareTopY = 0.075;
const leaderboardStorageKey = "chessAtelierLeaderboard";
const soundStorageKey = "chessAtelierSoundEnabled";

type SoundCue = "move" | "capture" | "check" | "mate" | "gameOver" | "illegal" | "start";

class SoundEngine {
  private context: AudioContext | null = null;
  private readonly audioContextConstructor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  private active = window.localStorage.getItem(soundStorageKey) !== "off";

  get enabled() {
    return this.active;
  }

  toggle() {
    this.active = !this.active;
    window.localStorage.setItem(soundStorageKey, this.active ? "on" : "off");
    if (this.active) {
      void this.unlock();
    }
    return this.active;
  }

  async unlock() {
    if (!this.active) {
      return;
    }

    const context = this.getContext();
    if (context?.state === "suspended") {
      await context.resume().catch(() => undefined);
    }
  }

  play(cue: SoundCue) {
    if (!this.active) {
      return;
    }

    const context = this.getContext();
    if (!context) {
      return;
    }

    if (context.state === "suspended") {
      void context.resume();
    }

    switch (cue) {
      case "move":
        this.tone(620, 0, 0.055, "triangle", 0.045);
        this.tone(315, 0.025, 0.05, "sine", 0.025);
        break;
      case "capture":
        this.drop(150, 72, 0, 0.15, "sine", 0.07);
        this.tone(520, 0.025, 0.045, "triangle", 0.035);
        break;
      case "check":
        this.tone(880, 0, 0.12, "sine", 0.04);
        this.tone(1320, 0.055, 0.14, "sine", 0.03);
        break;
      case "mate":
        this.tone(392, 0, 0.28, "sine", 0.04);
        this.tone(494, 0.04, 0.32, "sine", 0.035);
        this.tone(587, 0.08, 0.36, "triangle", 0.035);
        break;
      case "gameOver":
        this.tone(440, 0, 0.18, "triangle", 0.035);
        this.tone(330, 0.09, 0.24, "sine", 0.032);
        break;
      case "illegal":
        this.drop(132, 84, 0, 0.12, "sawtooth", 0.035);
        break;
      case "start":
        this.tone(392, 0, 0.085, "triangle", 0.03);
        this.tone(523, 0.095, 0.1, "triangle", 0.035);
        break;
    }
  }

  private getContext() {
    if (!this.audioContextConstructor) {
      return null;
    }
    this.context ??= new this.audioContextConstructor();
    return this.context;
  }

  private tone(
    frequency: number,
    delay: number,
    duration: number,
    type: OscillatorType,
    volume: number,
  ) {
    const context = this.context;
    if (!context) {
      return;
    }

    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  private drop(
    from: number,
    to: number,
    delay: number,
    duration: number,
    type: OscillatorType,
    volume: number,
  ) {
    const context = this.context;
    if (!context) {
      return;
    }

    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }
}

class ChessAtelier {
  private readonly fullScaleMode =
    window.location.pathname.startsWith("/full-scale") ||
    new URLSearchParams(window.location.search).get("mode") === "full-scale";
  private readonly cameraTestMode =
    window.location.pathname.startsWith("/camera-test") ||
    new URLSearchParams(window.location.search).get("mode") === "camera";
  private readonly game = new Chess();
  private readonly mount: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly boardGroup = new THREE.Group();
  private readonly highlightGroup = new THREE.Group();
  private readonly pieceGroup = new THREE.Group();
  private readonly trophyGroup = new THREE.Group();
  private readonly sound = new SoundEngine();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly clock = new THREE.Clock();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private cameraControls: OrbitControls | null = null;
  private readonly squareMeshes: THREE.Mesh[] = [];
  private readonly pieceMeshes: THREE.Object3D[] = [];
  private readonly boardMaterials: {
    light: THREE.MeshStandardMaterial;
    dark: THREE.MeshStandardMaterial;
    rim: THREE.MeshStandardMaterial;
    base: THREE.MeshStandardMaterial;
    marker: THREE.MeshBasicMaterial;
    captureMarker: THREE.MeshBasicMaterial;
    selected: THREE.MeshBasicMaterial;
    lastMove: THREE.MeshBasicMaterial;
  };
  private readonly whitePieceMaterial: THREE.MeshStandardMaterial;
  private readonly whiteTrimMaterial: THREE.MeshStandardMaterial;
  private readonly blackPieceMaterial: THREE.MeshStandardMaterial;
  private readonly blackTrimMaterial: THREE.MeshStandardMaterial;
  private selectedSquare: Square | null = null;
  private legalTargets: Square[] = [];
  private pendingPromotion: PendingPromotion | null = null;
  private hoverSquare: Square | null = null;
  private lastMove: { from: Square; to: Square } | null = null;
  private readonly sessionScore: SessionScore = { white: 0, black: 0, draws: 0 };
  private readonly playerNames: PlayerNames = { w: "Белые", b: "Черные" };
  private readonly clientKey = this.getClientKey();
  private socket: WebSocket | null = null;
  private online = false;
  private role: PlayerRole = null;
  private serverHistory: Move[] | null = null;
  private displayName = window.localStorage.getItem("chessAtelierDisplayName") ?? "";
  private readonly localMatchId = `${this.clientKey}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  private localGameCounter = 1;
  private currentGameId = this.createLocalGameId();
  private leaderboard = this.loadLeaderboard();
  private recordedResult: ScoreResult | null = null;
  private flipped = false;
  private targetRotation = 0;
  private frame = 0;
  private boardPointerStart: BoardPointerStart | null = null;
  private lastSoundedGameId: string | null = null;
  private lastSoundedMoveCount = 0;
  private lastAnimatedGameId: string | null = null;
  private lastAnimatedMoveCount = 0;
  private lastTrophyCaptureKey: string | null = null;

  private readonly statusText = document.querySelector<HTMLSpanElement>("#statusText")!;
  private readonly roleBadge = document.querySelector<HTMLButtonElement>("#roleBadge")!;
  private readonly turnBadge = document.querySelector<HTMLSpanElement>("#turnBadge")!;
  private readonly moveList = document.querySelector<HTMLOListElement>("#moveList")!;
  private readonly moveCount = document.querySelector<HTMLSpanElement>("#moveCount")!;
  private readonly whiteCaptures = document.querySelector<HTMLSpanElement>("#whiteCaptures")!;
  private readonly blackCaptures = document.querySelector<HTMLSpanElement>("#blackCaptures")!;
  private readonly whiteGameScore = document.querySelector<HTMLElement>("#whiteGameScore")!;
  private readonly blackGameScore = document.querySelector<HTMLElement>("#blackGameScore")!;
  private readonly drawGameScore = document.querySelector<HTMLElement>("#drawGameScore")!;
  private readonly whitePlayerName = document.querySelector<HTMLElement>("#whitePlayerName")!;
  private readonly blackPlayerName = document.querySelector<HTMLElement>("#blackPlayerName")!;
  private readonly whiteCaptureLabel = document.querySelector<HTMLElement>("#whiteCaptureLabel")!;
  private readonly blackCaptureLabel = document.querySelector<HTMLElement>("#blackCaptureLabel")!;
  private readonly whiteMaterial = document.querySelector<HTMLElement>("#whiteMaterial")!;
  private readonly blackMaterial = document.querySelector<HTMLElement>("#blackMaterial")!;
  private readonly scoreLead = document.querySelector<HTMLElement>("#scoreLead")!;
  private readonly leaderboardList = document.querySelector<HTMLOListElement>("#leaderboardList")!;
  private readonly leaderboardSync = document.querySelector<HTMLElement>("#leaderboardSync")!;
  private readonly playerDialog = document.querySelector<HTMLDivElement>("#playerDialog")!;
  private readonly playerForm = document.querySelector<HTMLFormElement>("#playerForm")!;
  private readonly playerCancelBtn = document.querySelector<HTMLButtonElement>("#playerCancelBtn")!;
  private readonly playerSubmitBtn = document.querySelector<HTMLButtonElement>("#playerSubmitBtn")!;
  private readonly soundBtn = document.querySelector<HTMLButtonElement>("#soundBtn")!;
  private readonly playerDialogCopy = document.querySelector<HTMLParagraphElement>("#playerDialogCopy")!;
  private readonly playerNameInput = document.querySelector<HTMLInputElement>("#playerNameInput")!;
  private readonly promotionDialog = document.querySelector<HTMLDivElement>("#promotionDialog")!;

  constructor() {
    const mount = document.querySelector<HTMLElement>("#scene");
    if (!mount) {
      throw new Error("Missing scene mount");
    }

    this.mount = mount;
    this.boardMaterials = this.createBoardMaterials();
    this.whitePieceMaterial = new THREE.MeshStandardMaterial({
      color: 0xf5e6c4,
      roughness: 0.44,
      metalness: 0.05,
    });
    this.whiteTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0xca8f44,
      roughness: 0.34,
      metalness: 0.16,
    });
    this.blackPieceMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e282c,
      roughness: 0.38,
      metalness: 0.08,
    });
    this.blackTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0x70b9ad,
      roughness: 0.32,
      metalness: 0.2,
    });

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.setClearColor(0x11140f, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.mount.append(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    this.camera.position.set(5.9, 8.3, 7.4);
    this.camera.lookAt(0, 0, 0);

    if (this.fullScaleMode) {
      document.body.classList.add("full-scale-mode");
      this.boardGroup.scale.setScalar(1.36);
    }

    this.scene.add(this.boardGroup);
    this.boardGroup.add(this.highlightGroup, this.pieceGroup, this.trophyGroup);
    this.scene.background = this.fullScaleMode ? this.createFantasyBackdropTexture() : this.createBackdropTexture();
    this.scene.fog = new THREE.Fog(this.fullScaleMode ? 0x15151d : 0x0f1511, this.fullScaleMode ? 18 : 15, this.fullScaleMode ? 46 : 30);

    this.createLights();
    this.createTableSurface();
    this.createBoard();
    this.createCaptureRacks();
    this.createCoordinateLabels();
    this.rebuildPieces();
    this.bindEvents();
    this.onResize();
    this.setupCameraControls();
    this.updateSoundButton();
    this.updateHud();
    this.installDebugApi();
    if (this.shouldUseServer()) {
      this.connectToServer();
    } else {
      this.updateControls();
    }
    if (!this.cameraTestMode && !this.fullScaleMode) {
      this.showPlayerDialog(true);
    }
    this.animate();
  }

  private createBoardMaterials() {
    const lightTexture = this.fullScaleMode
      ? this.createStoneTexture("#8d886f", "#3d3c33", 0.09)
      : this.createWoodTexture("#d8bb82", "#f2dfaa", 0.2);
    const darkTexture = this.fullScaleMode
      ? this.createStoneTexture("#253b30", "#111a16", 0.12)
      : this.createWoodTexture("#385446", "#1f352e", 0.42);
    const baseTexture = this.fullScaleMode
      ? this.createStoneTexture("#34343a", "#15151a", 0.12)
      : this.createWoodTexture("#35281f", "#69452d", 0.32);

    const light = new THREE.MeshStandardMaterial({
      map: lightTexture,
      color: this.fullScaleMode ? 0xb1ad8b : 0xf6d891,
      roughness: this.fullScaleMode ? 0.76 : 0.42,
      metalness: this.fullScaleMode ? 0.01 : 0.04,
    });
    const dark = new THREE.MeshStandardMaterial({
      map: darkTexture,
      color: this.fullScaleMode ? 0x263f33 : 0x294736,
      roughness: this.fullScaleMode ? 0.82 : 0.52,
      metalness: this.fullScaleMode ? 0.01 : 0.03,
    });
    const rim = new THREE.MeshStandardMaterial({
      color: this.fullScaleMode ? 0x8f7448 : 0xd9914a,
      roughness: this.fullScaleMode ? 0.62 : 0.31,
      metalness: this.fullScaleMode ? 0.08 : 0.18,
    });
    const base = new THREE.MeshStandardMaterial({
      map: baseTexture,
      color: this.fullScaleMode ? 0x424048 : 0x674128,
      roughness: this.fullScaleMode ? 0.8 : 0.45,
      metalness: this.fullScaleMode ? 0.02 : 0.08,
    });
    const marker = new THREE.MeshBasicMaterial({
      color: 0x5bc6a4,
      transparent: true,
      opacity: 0.58,
      depthWrite: false,
    });
    const captureMarker = new THREE.MeshBasicMaterial({
      color: 0xed7162,
      transparent: true,
      opacity: 0.66,
      depthWrite: false,
    });
    const selected = new THREE.MeshBasicMaterial({
      color: 0xffd98c,
      transparent: true,
      opacity: 0.38,
      depthWrite: false,
    });
    const lastMove = new THREE.MeshBasicMaterial({
      color: 0xd9914a,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });

    return { light, dark, rim, base, marker, captureMarker, selected, lastMove };
  }

  private createBackdropTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, "#17231d");
    gradient.addColorStop(0.52, "#0e1410");
    gradient.addColorStop(1, "#080a08");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "rgba(246,241,231,0.035)";
    context.lineWidth = 1;
    for (let i = -canvas.height; i < canvas.width; i += 32) {
      context.beginPath();
      context.moveTo(i, canvas.height);
      context.lineTo(i + canvas.height, 0);
      context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createFantasyBackdropTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#26314b");
    gradient.addColorStop(0.4, "#161929");
    gradient.addColorStop(1, "#090a0d");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 130; i += 1) {
      const x = Math.random() * canvas.width;
      const y = Math.random() * canvas.height * 0.48;
      const size = 1 + Math.random() * 2.2;
      context.fillStyle = `rgba(246, 241, 210, ${0.12 + Math.random() * 0.38})`;
      context.fillRect(x, y, size, size);
    }

    const ridges = [
      { y: 680, color: "rgba(24, 25, 30, 0.92)", step: 120, height: 150 },
      { y: 750, color: "rgba(13, 14, 18, 0.96)", step: 150, height: 120 },
    ];
    ridges.forEach((ridge) => {
      context.beginPath();
      context.moveTo(0, canvas.height);
      for (let x = 0; x <= canvas.width + ridge.step; x += ridge.step) {
        context.lineTo(x, ridge.y - Math.random() * ridge.height);
      }
      context.lineTo(canvas.width, canvas.height);
      context.closePath();
      context.fillStyle = ridge.color;
      context.fill();
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createStoneTexture(base: string, line: string, density: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext("2d")!;
    context.fillStyle = base;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < canvas.height; y += 64) {
      const offset = (y / 64) % 2 === 0 ? 0 : 54;
      context.strokeStyle = this.withAlpha(line, 0.55);
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
      for (let x = -offset; x < canvas.width; x += 108) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x + Math.sin(y * 0.03) * 6, y + 64);
        context.stroke();
      }
    }

    for (let i = 0; i < 1700; i += 1) {
      const shade = Math.random() > 0.48 ? 255 : 0;
      context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${density * Math.random()})`;
      context.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createWoodTexture(base: string, vein: string, density: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }

    context.fillStyle = base;
    context.fillRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < 80; i += 1) {
      const y = Math.random() * canvas.height;
      const wave = 10 + Math.random() * 18;
      context.beginPath();
      context.moveTo(-8, y);
      for (let x = -8; x <= canvas.width + 8; x += 18) {
        context.lineTo(x, y + Math.sin((x + i * 9) / wave) * (5 + Math.random() * 8));
      }
      context.strokeStyle = this.withAlpha(vein, density * (0.25 + Math.random() * 0.55));
      context.lineWidth = 1 + Math.random() * 2.2;
      context.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(1.4, 1.4);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private withAlpha(hex: string, alpha: number) {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  private createLights() {
    const ambient = new THREE.HemisphereLight(this.fullScaleMode ? 0xbfc8ff : 0xffecd0, 0x101813, this.fullScaleMode ? 0.92 : 1.35);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(this.fullScaleMode ? 0xdfe7ff : 0xfff1c9, this.fullScaleMode ? 2.15 : 2.7);
    key.position.set(this.fullScaleMode ? -9 : -4.2, this.fullScaleMode ? 13 : 10, this.fullScaleMode ? 9 : 5.4);
    key.castShadow = true;
    key.shadow.mapSize.width = this.fullScaleMode ? 3072 : 2048;
    key.shadow.mapSize.height = this.fullScaleMode ? 3072 : 2048;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = this.fullScaleMode ? 42 : 22;
    key.shadow.camera.left = this.fullScaleMode ? -17 : -7;
    key.shadow.camera.right = this.fullScaleMode ? 17 : 7;
    key.shadow.camera.top = this.fullScaleMode ? 17 : 7;
    key.shadow.camera.bottom = this.fullScaleMode ? -17 : -7;
    this.scene.add(key);

    const accent = new THREE.PointLight(0x6be0c5, this.fullScaleMode ? 1.2 : 2.4, this.fullScaleMode ? 24 : 16);
    accent.position.set(this.fullScaleMode ? 8.6 : 5.2, this.fullScaleMode ? 5.8 : 4.8, this.fullScaleMode ? -6.5 : -5);
    this.scene.add(accent);

    const rim = new THREE.DirectionalLight(0x8fb8ff, this.fullScaleMode ? 1.25 : 0.9);
    rim.position.set(this.fullScaleMode ? 10 : 6, this.fullScaleMode ? 8.5 : 5.5, this.fullScaleMode ? 5 : 3);
    this.scene.add(rim);
  }

  private createTableSurface() {
    if (this.fullScaleMode) {
      this.createFullScaleWorld();
      return;
    }

    const texture = this.createWoodTexture("#16100c", "#7a4a2a", 0.18);
    texture?.repeat.set(3.5, 2.2);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      color: 0x2b1a11,
      roughness: 0.58,
      metalness: 0.02,
    });
    const table = new THREE.Mesh(new THREE.PlaneGeometry(28, 22), material);
    table.position.set(0, -0.56, 0);
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    this.scene.add(table);
  }

  private createFullScaleWorld() {
    const floorTexture = this.createStoneTexture("#2c2e30", "#101113", 0.13);
    floorTexture.repeat.set(8, 8);
    const floorMaterial = new THREE.MeshStandardMaterial({
      map: floorTexture,
      color: 0x3b3e3f,
      roughness: 0.86,
      metalness: 0.01,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), floorMaterial);
    floor.position.set(0, -0.62, 0);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const wallTexture = this.createStoneTexture("#303139", "#111217", 0.15);
    wallTexture.repeat.set(5, 2);
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTexture,
      color: 0x3d3e48,
      roughness: 0.82,
      metalness: 0.02,
    });
    [
      { x: 0, z: -13.5, w: 26, h: 4.8, d: 0.7 },
      { x: -13.2, z: 0, w: 0.7, h: 4.1, d: 22 },
      { x: 13.2, z: 0, w: 0.7, h: 4.1, d: 22 },
    ].forEach((wall) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(wall.w, wall.h, wall.d), wallMaterial);
      mesh.position.set(wall.x, 1.42, wall.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    });

    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0x57545a,
      roughness: 0.76,
      metalness: 0.03,
    });
    [
      [-9.2, -9.8],
      [9.2, -9.8],
      [-9.2, 8.6],
      [9.2, 8.6],
    ].forEach(([x, z]) => this.createPillar(x, z, pillarMaterial));

    this.createArchway(0, -13.12, wallMaterial);
    this.createBanners();
    [
      [-10.8, -6.8],
      [10.8, -6.8],
      [-10.8, 5.9],
      [10.8, 5.9],
    ].forEach(([x, z], index) => this.createTorch(x, z, index % 2 === 0 ? -1 : 1));

    this.createDecorativeStatue("w", -7.9, 1.85, -2.1, 0.6);
    this.createDecorativeStatue("b", 7.9, 1.85, -2.1, -0.6);
  }

  private createPillar(x: number, z: number, material: THREE.Material) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.82, 0.36, 8), material);
    base.position.set(x, -0.4, z);
    base.castShadow = true;
    base.receiveShadow = true;
    this.scene.add(base);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.54, 4.5, 10), material);
    shaft.position.set(x, 1.95, z);
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    this.scene.add(shaft);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.62, 0.38, 8), material);
    cap.position.set(x, 4.34, z);
    cap.castShadow = true;
    cap.receiveShadow = true;
    this.scene.add(cap);
  }

  private createArchway(x: number, z: number, material: THREE.Material) {
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.5, 0.72, 0.9), material);
    lintel.position.set(x, 3.7, z + 0.02);
    lintel.castShadow = true;
    lintel.receiveShadow = true;
    this.scene.add(lintel);

    [-1, 1].forEach((side) => {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.82, 4.3, 0.9), material);
      post.position.set(x + side * 3.26, 1.45, z + 0.02);
      post.castShadow = true;
      post.receiveShadow = true;
      this.scene.add(post);
    });
  }

  private createBanners() {
    const bannerData = [
      { x: -5.4, z: -12.98, color: "#79343b", sigil: "#d8bb82" },
      { x: 5.4, z: -12.98, color: "#244d58", sigil: "#8fd0c7" },
    ];
    bannerData.forEach((banner) => {
      const texture = this.createBannerTexture(banner.color, banner.sigil);
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        roughness: 0.7,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.55, 3.1, 1, 6), material);
      mesh.position.set(banner.x, 2.15, banner.z);
      mesh.rotation.y = 0;
      mesh.castShadow = true;
      this.scene.add(mesh);
    });
  }

  private createBannerTexture(color: string, sigil: string) {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 512;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = color;
    context.fillRect(32, 18, 192, 450);
    context.fillStyle = "rgba(0,0,0,0.18)";
    for (let x = 44; x < 224; x += 28) {
      context.fillRect(x, 18, 6, 450);
    }
    context.fillStyle = sigil;
    context.beginPath();
    context.moveTo(128, 112);
    context.lineTo(178, 202);
    context.lineTo(128, 292);
    context.lineTo(78, 202);
    context.closePath();
    context.fill();
    context.fillStyle = color;
    context.fillRect(32, 442, 54, 80);
    context.fillRect(170, 442, 54, 80);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private createTorch(x: number, z: number, side: number) {
    const iron = new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.48, metalness: 0.52 });
    const flame = new THREE.MeshBasicMaterial({ color: 0xffb04f, transparent: true, opacity: 0.88 });

    const bracket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 10), iron);
    bracket.position.set(x, 1.95, z);
    bracket.rotation.z = Math.PI / 2;
    bracket.castShadow = true;
    this.scene.add(bracket);

    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.34, 0.2, 12), iron);
    bowl.position.set(x + side * 0.46, 1.95, z);
    bowl.castShadow = true;
    this.scene.add(bowl);

    const fire = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.55, 9), flame);
    fire.position.set(x + side * 0.46, 2.32, z);
    fire.userData.flame = true;
    this.scene.add(fire);

    const light = new THREE.PointLight(0xff8a3d, 3.2, 10);
    light.position.set(x + side * 0.46, 2.35, z);
    light.userData.flameLight = true;
    this.scene.add(light);
  }

  private createDecorativeStatue(color: Color, x: number, scale: number, z: number, rotation: number) {
    const statue = this.createPiece("k", color);
    statue.position.set(x, -0.34, z);
    statue.scale.setScalar(scale);
    statue.rotation.y = rotation;
    statue.traverse((object) => {
      object.userData.kind = "statue";
      if (object instanceof THREE.Mesh) {
        object.receiveShadow = true;
        object.castShadow = true;
      }
    });
    this.scene.add(statue);
  }

  private createBoard() {
    const base = new THREE.Mesh(new RoundedBoxGeometry(9.8, 0.48, 9.8, 5, 0.18), this.boardMaterials.base);
    base.position.y = -0.28;
    base.receiveShadow = true;
    base.castShadow = true;
    this.boardGroup.add(base);

    const inset = new THREE.Mesh(new RoundedBoxGeometry(8.78, 0.16, 8.78, 5, 0.08), this.boardMaterials.rim);
    inset.position.y = -0.07;
    inset.receiveShadow = true;
    inset.castShadow = true;
    this.boardGroup.add(inset);

    const squareGeometry = new RoundedBoxGeometry(0.985, 0.14, 0.985, 3, 0.025);

    for (let rank = 0; rank < 8; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        const square = `${files[file]}${ranks[rank]}` as Square;
        const material = (rank + file) % 2 === 0 ? this.boardMaterials.dark : this.boardMaterials.light;
        const mesh = new THREE.Mesh(squareGeometry, material);
        const position = this.squareToLocal(square);
        mesh.position.set(position.x, 0, position.z);
        mesh.receiveShadow = true;
        mesh.userData.square = square;
        mesh.userData.kind = "square";
        this.squareMeshes.push(mesh);
        this.boardGroup.add(mesh);
      }
    }
  }

  private createCaptureRacks() {
    const rackMaterial = new THREE.MeshStandardMaterial({
      color: 0x3b2a1e,
      roughness: 0.5,
      metalness: 0.08,
    });
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: 0xd9914a,
      roughness: 0.34,
      metalness: 0.18,
    });

    [-1, 1].forEach((side) => {
      const rack = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.14, 7.7, 4, 0.08), rackMaterial);
      rack.position.set(side * 5.24, 0.02, 0);
      rack.castShadow = true;
      rack.receiveShadow = true;
      this.boardGroup.add(rack);

      const rail = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.1, 7.95, 3, 0.04), trimMaterial);
      rail.position.set(side * 4.82, 0.12, 0);
      rail.castShadow = true;
      rail.receiveShadow = true;
      this.boardGroup.add(rail);
    });
  }

  private createCoordinateLabels() {
    const labelMaterial = (text: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 96;
      const context = canvas.getContext("2d")!;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "rgba(246,241,231,0.9)";
      context.font = "800 44px Arial";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(text, 48, 50);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      return new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.76 });
    };

    files.forEach((file, index) => {
      const sprite = new THREE.Sprite(labelMaterial(file));
      sprite.position.set(index - 3.5, 0.16, 4.38);
      sprite.scale.setScalar(0.28);
      this.boardGroup.add(sprite);
    });

    ranks.forEach((rank, index) => {
      const sprite = new THREE.Sprite(labelMaterial(rank));
      sprite.position.set(-4.38, 0.16, 3.5 - index);
      sprite.scale.setScalar(0.28);
      this.boardGroup.add(sprite);
    });
  }

  private rebuildPieces(animation?: PieceMoveAnimation | null) {
    this.pieceMeshes.length = 0;
    this.disposeGroupChildren(this.pieceGroup);

    for (let rank = 0; rank < 8; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        const square = `${files[file]}${ranks[rank]}` as Square;
        const piece = this.game.get(square);
        if (!piece) {
          continue;
        }

        const group = this.createPiece(piece.type, piece.color);
        const position = this.squareToLocal(square);
        group.position.set(position.x, squareTopY, position.z);
        if (animation && square === animation.to) {
          const from = this.squareToLocal(animation.from);
          group.position.set(from.x, squareTopY, from.z);
          group.userData.motion = {
            from: new THREE.Vector3(from.x, squareTopY, from.z),
            to: new THREE.Vector3(position.x, squareTopY, position.z),
            startedAt: performance.now(),
            duration: animation.capture ? 520 : 420,
            lift: animation.capture ? 0.54 : 0.36,
            spin: animation.capture ? 0.28 : 0.12,
          } satisfies SceneMotion;
        }
        group.userData.square = square;
        group.userData.kind = "piece";
        group.userData.homeY = squareTopY;
        group.traverse((object) => {
          object.userData.square = square;
          object.userData.kind = "piece";
          if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
            this.pieceMeshes.push(object);
          }
        });
        this.pieceGroup.add(group);
      }
    }
  }

  private createPiece(type: PieceSymbol, color: Color) {
    const group = new THREE.Group();
    const isWhite = color === "w";
    const body = isWhite ? this.whitePieceMaterial : this.blackPieceMaterial;
    const trim = isWhite ? this.whiteTrimMaterial : this.blackTrimMaterial;
    const scale = type === "p" ? 0.82 : type === "k" || type === "q" ? 1.02 : 0.94;
    const baseRadius = type === "p" ? 0.3 : 0.35;
    group.scale.setScalar(scale);

    this.addBaseShadow(group, baseRadius + 0.04);
    this.addCylinder(group, baseRadius * 0.82, baseRadius, 0.13, 0.065, trim);
    this.addCylinder(group, baseRadius * 0.68, baseRadius * 0.86, 0.14, 0.19, body);
    this.addTorus(group, baseRadius * 0.76, 0.024, 0.27, trim);
    this.addCylinder(group, baseRadius * 0.42, baseRadius * 0.56, 0.32, 0.43, body);
    this.addTorus(group, baseRadius * 0.45, 0.016, 0.58, trim);

    if (type === "p") {
      this.addSphere(group, 0.19, 0.73, body);
    }

    if (type === "r") {
      this.addCylinder(group, 0.22, 0.24, 0.24, 0.65, body);
      this.addRoundedBox(group, 0.55, 0.14, 0.55, 0, 0.82, 0, trim, 0.045);
      this.addCylinder(group, 0.18, 0.22, 0.1, 0.94, body);
      for (let i = 0; i < 4; i += 1) {
        const angle = Math.PI / 4 + (i * Math.PI) / 2;
        this.addRoundedBox(group, 0.13, 0.13, 0.13, Math.cos(angle) * 0.2, 1.05, Math.sin(angle) * 0.2, trim, 0.035);
      }
    }

    if (type === "n") {
      this.addCylinder(group, 0.16, 0.23, 0.2, 0.66, body);
      this.addTorus(group, 0.2, 0.016, 0.78, trim);
      this.addKnightHead(group, body, trim, color);
    }

    if (type === "b") {
      this.addSphere(group, 0.23, 0.75, body, 0.9, 1.2, 0.9);
      this.addCone(group, 0.16, 0.3, 1.02, body, 32);
      this.addTorus(group, 0.18, 0.015, 0.86, trim);
      this.addSphereAt(group, 0.052, 0, 1.2, 0, trim);
    }

    if (type === "q") {
      this.addCylinder(group, 0.16, 0.24, 0.22, 0.66, body);
      this.addSphere(group, 0.23, 0.84, body, 1, 0.85, 1);
      this.addTorus(group, 0.23, 0.022, 1.0, trim);
      for (let i = 0; i < 6; i += 1) {
        const angle = (i / 6) * Math.PI * 2;
        this.addSphereAt(group, 0.055, Math.cos(angle) * 0.2, 1.1, Math.sin(angle) * 0.2, trim);
      }
      this.addOctahedron(group, 0.09, 0, 1.19, 0, trim, 0.9, 1.15, 0.9);
    }

    if (type === "k") {
      this.addCylinder(group, 0.16, 0.24, 0.23, 0.66, body);
      this.addSphere(group, 0.22, 0.84, body, 1, 0.86, 1);
      this.addRoundedBox(group, 0.08, 0.4, 0.08, 0, 1.09, 0, trim, 0.025);
      this.addRoundedBox(group, 0.31, 0.075, 0.075, 0, 1.18, 0, trim, 0.025);
    }

    return group;
  }

  private addCylinder(
    group: THREE.Group,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    y: number,
    material: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 48), material);
    mesh.position.y = y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  private addBaseShadow(group: THREE.Group, radius: number) {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 48),
      new THREE.MeshBasicMaterial({
        color: 0x050605,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
      }),
    );
    mesh.position.y = 0.006;
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
  }

  private addSphere(
    group: THREE.Group,
    radius: number,
    y: number,
    material: THREE.Material,
    scaleX = 1,
    scaleY = 1,
    scaleZ = 1,
  ) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 18), material);
    mesh.position.y = y;
    mesh.scale.set(scaleX, scaleY, scaleZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  private addSphereAt(group: THREE.Group, radius: number, x: number, y: number, z: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 18, 12), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
  }

  private addCone(
    group: THREE.Group,
    radius: number,
    height: number,
    y: number,
    material: THREE.Material,
    radialSegments = 32,
  ) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, radialSegments), material);
    mesh.position.y = y;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  private addOctahedron(
    group: THREE.Group,
    radius: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    scaleX = 1,
    scaleY = 1,
    scaleZ = 1,
  ) {
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), material);
    mesh.position.set(x, y, z);
    mesh.scale.set(scaleX, scaleY, scaleZ);
    mesh.rotation.y = Math.PI / 4;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  private addKnightHead(group: THREE.Group, body: THREE.Material, trim: THREE.Material, color: Color) {
    this.addRoundedBox(group, 0.16, 0.42, 0.24, -0.12, 0.84, 0, body, 0.055, -0.28);
    this.addRoundedBox(group, 0.07, 0.36, 0.28, -0.22, 0.93, 0, trim, 0.024, -0.24);

    const headGroup = new THREE.Group();
    headGroup.position.set(0.03, 0.15, 0);
    headGroup.scale.set(0.7, 0.76, 0.8);
    group.add(headGroup);

    const profile = new THREE.Shape();
    profile.moveTo(-0.26, 0.62);
    profile.bezierCurveTo(-0.34, 0.78, -0.31, 1.02, -0.13, 1.15);
    profile.bezierCurveTo(-0.06, 1.21, -0.02, 1.3, 0.08, 1.34);
    profile.bezierCurveTo(0.18, 1.39, 0.31, 1.35, 0.38, 1.24);
    profile.bezierCurveTo(0.5, 1.2, 0.58, 1.1, 0.55, 1);
    profile.bezierCurveTo(0.52, 0.9, 0.4, 0.86, 0.28, 0.89);
    profile.bezierCurveTo(0.14, 0.92, 0.05, 0.81, -0.04, 0.63);
    profile.lineTo(-0.26, 0.62);

    const depth = 0.28;
    const geometry = new THREE.ExtrudeGeometry(profile, {
      depth,
      bevelEnabled: true,
      bevelSegments: 3,
      bevelSize: 0.024,
      bevelThickness: 0.018,
      curveSegments: 18,
    });
    geometry.translate(0, 0, -depth / 2);
    const head = new THREE.Mesh(geometry, body);
    head.castShadow = true;
    head.receiveShadow = true;
    headGroup.add(head);

    this.addKnightMane(headGroup, trim);
    this.addConeAt(headGroup, 0.055, 0.22, 0.04, 1.39, -0.06, trim, -0.18, 0.22, 0.18, 4);
    this.addConeAt(headGroup, 0.05, 0.2, 0.13, 1.36, 0.08, trim, -0.34, -0.18, 0.18, 4);
    this.addEllipsoidAt(headGroup, 0.11, 0.06, 0.09, 0.43, 1.02, 0, body);
    this.addSphereAt(headGroup, 0.014, 0.46, 1.04, 0.145, trim);
    this.addSphereAt(headGroup, 0.014, 0.46, 1.04, -0.145, trim);

    const eye = color === "w" ? this.blackPieceMaterial : this.whitePieceMaterial;
    this.addSphereAt(headGroup, 0.016, 0.2, 1.2, 0.15, eye);
    this.addSphereAt(headGroup, 0.016, 0.2, 1.2, -0.15, eye);
  }

  private addKnightMane(group: THREE.Group, trim: THREE.Material) {
    const tufts = [
      { x: -0.18, y: 1.2, z: 0, rz: -0.55 },
      { x: -0.23, y: 1.08, z: 0, rz: -0.42 },
      { x: -0.25, y: 0.95, z: 0, rz: -0.28 },
      { x: -0.23, y: 0.82, z: 0, rz: -0.18 },
    ];

    tufts.forEach((tuft) => {
      this.addRoundedBox(group, 0.08, 0.17, 0.34, tuft.x, tuft.y, tuft.z, trim, 0.024, tuft.rz);
    });
  }

  private addEllipsoidAt(
    group: THREE.Group,
    radiusX: number,
    radiusY: number,
    radiusZ: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), material);
    mesh.position.set(x, y, z);
    mesh.scale.set(radiusX, radiusY, radiusZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  private addConeAt(
    group: THREE.Group,
    radius: number,
    height: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    rotationZ = 0,
    rotationY = 0,
    rotationX = 0,
    radialSegments = 32,
  ) {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(radius, height, radialSegments), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotationX, rotationY, rotationZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  private addRoundedBox(
    group: THREE.Group,
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    radius = 0.035,
    rotationZ = 0,
    rotationY = 0,
  ) {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 3, radius), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, rotationY, rotationZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  private addTorus(group: THREE.Group, radius: number, tube: number, y: number, material: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 12, 48), material);
    mesh.position.y = y;
    mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    group.add(mesh);
  }

  private setupCameraControls() {
    document.body.classList.add("camera-controls-enabled");
    if (this.cameraTestMode) {
      document.body.classList.add("camera-test-mode");
    }
    this.renderer.domElement.dataset.cameraMode = "orbit";

    const controls = new OrbitControls(this.camera, this.renderer.domElement);
    controls.target.copy(this.boardGroup.position);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.72;
    controls.zoomSpeed = 0.82;
    controls.panSpeed = 0.56;
    controls.minDistance = this.fullScaleMode ? 8 : 5.2;
    controls.maxDistance = this.fullScaleMode ? 34 : 18;
    controls.minPolarAngle = this.fullScaleMode ? 0.18 : 0.22;
    controls.maxPolarAngle = this.fullScaleMode ? Math.PI / 1.94 : Math.PI / 2.05;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    controls.update();
    this.cameraControls = controls;
  }

  private bindEvents() {
    window.addEventListener("resize", () => this.onResize());
    window.addEventListener("pointerdown", () => void this.sound.unlock(), { once: true, capture: true });
    this.renderer.domElement.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.renderer.domElement.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.renderer.domElement.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.renderer.domElement.addEventListener("pointercancel", () => {
      this.boardPointerStart = null;
    });
    this.renderer.domElement.addEventListener("contextmenu", (event) => {
      if (this.cameraControls) {
        event.preventDefault();
      }
    });

    document.querySelector<HTMLButtonElement>("#newGameBtn")!.addEventListener("click", () => {
      if (!this.game.isGameOver()) {
        this.flashStatus("Новая партия доступна после завершения.", "warning");
        return;
      }
      if (this.online) {
        this.sendToServer({ type: "newGame" });
        return;
      }
      this.game.reset();
      this.selectedSquare = null;
      this.lastMove = null;
      this.recordedResult = null;
      this.pendingPromotion = null;
      this.lastTrophyCaptureKey = null;
      this.lastAnimatedGameId = null;
      this.lastAnimatedMoveCount = 0;
      this.lastSoundedGameId = null;
      this.lastSoundedMoveCount = 0;
      this.advanceLocalGameId();
      this.hidePromotionDialog();
      this.rebuildPieces();
      this.updateHighlights();
      this.updateHud();
      this.sound.play("start");
    });

    document.querySelector<HTMLButtonElement>("#flipBtn")!.addEventListener("click", () => {
      this.flipped = !this.flipped;
      this.targetRotation = this.flipped ? Math.PI : 0;
    });

    document.querySelector<HTMLButtonElement>("#playersBtn")!.addEventListener("click", () => {
      this.showPlayerDialog(false);
    });

    this.roleBadge.addEventListener("click", () => {
      this.showPlayerDialog(false);
    });

    this.soundBtn.addEventListener("click", () => {
      const enabled = this.sound.toggle();
      this.updateSoundButton();
      if (enabled) {
        this.sound.play("start");
      }
    });

    this.playerForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.savePlayerNames();
    });

    this.playerCancelBtn.addEventListener("click", () => {
      this.hidePlayerDialog();
    });

    this.promotionDialog.querySelectorAll<HTMLButtonElement>("[data-promotion]").forEach((button) => {
      button.addEventListener("click", () => {
        const piece = button.dataset.promotion as PromotionPiece;
        if (this.pendingPromotion) {
          this.commitMove(this.pendingPromotion.from, this.pendingPromotion.to, piece);
        }
      });
    });
  }

  private onResize() {
    const width = this.mount.clientWidth;
    const height = this.mount.clientHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    const small = width < 760;
    this.boardGroup.position.x = small ? 0 : this.fullScaleMode ? -0.35 : -1.05;
    if (!this.cameraControls) {
      if (this.fullScaleMode) {
        this.camera.position.set(small ? 14 : 12.8, small ? 13.5 : 10.8, small ? 20 : 17.4);
        this.camera.fov = small ? 54 : 42;
      } else {
        this.camera.position.set(small ? 8.4 : 7.35, small ? 10.8 : 9.55, small ? 12.2 : 9.65);
        this.camera.fov = small ? 48 : 35;
      }
      this.camera.lookAt(0, 0, 0);
    } else {
      this.cameraControls.target.copy(this.boardGroup.position);
    }
    this.camera.updateProjectionMatrix();
  }

  private onPointerMove(event: PointerEvent) {
    if (this.pendingPromotion) {
      return;
    }

    if (this.cameraControls && this.boardPointerStart) {
      const dragDistance = Math.hypot(event.clientX - this.boardPointerStart.x, event.clientY - this.boardPointerStart.y);
      if (dragDistance > 5) {
        this.boardPointerStart.moved = true;
      }
    }

    const square = this.pickSquare(event);
    this.hoverSquare = square;
    if (this.cameraControls) {
      this.renderer.domElement.style.cursor = this.boardPointerStart?.moved
        ? "grabbing"
        : square && this.canInteractWithBoard()
          ? "pointer"
          : "grab";
      return;
    }
    this.renderer.domElement.style.cursor = square && this.canInteractWithBoard() ? "pointer" : "default";
  }

  private onPointerDown(event: PointerEvent) {
    if (this.pendingPromotion) {
      return;
    }

    if (this.cameraControls) {
      if (event.button === 0) {
        this.boardPointerStart = {
          pointerId: event.pointerId,
          button: event.button,
          x: event.clientX,
          y: event.clientY,
          square: this.pickSquare(event),
          moved: false,
        };
      }
      return;
    }

    const square = this.pickSquare(event);
    if (!square) {
      this.selectedSquare = null;
      this.updateHighlights();
      return;
    }

    this.handleSquare(square);
  }

  private onPointerUp(event: PointerEvent) {
    if (!this.cameraControls || !this.boardPointerStart) {
      return;
    }

    const start = this.boardPointerStart;
    this.boardPointerStart = null;

    if (event.pointerId !== start.pointerId || start.button !== 0 || start.moved || this.pendingPromotion) {
      return;
    }

    const square = this.pickSquare(event) ?? start.square;
    if (!square) {
      this.selectedSquare = null;
      this.updateHighlights();
      return;
    }

    this.handleSquare(square);
  }

  private pickSquare(event: PointerEvent): Square | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const squareHits = this.raycaster.intersectObjects(this.squareMeshes, false);
    const squareHit = squareHits.find((candidate) => candidate.object.userData.square);
    if (squareHit) {
      return squareHit.object.userData.square as Square;
    }

    const pieceHits = this.raycaster.intersectObjects(this.pieceMeshes, false);
    const pieceHit = pieceHits.find((candidate) => candidate.object.userData.square);
    return (pieceHit?.object.userData.square as Square | undefined) ?? null;
  }

  private handleSquare(square: Square) {
    const piece = this.game.get(square);
    const turn = this.game.turn();

    if (!this.canInteractWithBoard()) {
      this.flashStatus(this.role === "spectator" ? "Только просмотр" : "Сначала войдите", "warning");
      return;
    }

    if (this.online && this.role !== turn) {
      this.flashStatus(this.turnStatus(turn), "warning");
      return;
    }

    if (this.game.isGameOver()) {
      this.flashStatus("Партия окончена", "warning");
      return;
    }

    if (!this.selectedSquare) {
      if (piece?.color === turn) {
        this.selectSquare(square);
      } else {
        this.flashStatus(this.turnStatus(turn), "warning");
      }
      return;
    }

    if (square === this.selectedSquare) {
      this.selectedSquare = null;
      this.updateHighlights();
      return;
    }

    if (piece?.color === turn) {
      this.selectSquare(square);
      return;
    }

    if (!this.legalTargets.includes(square)) {
      this.flashStatus("Недопустимый ход", "danger");
      return;
    }

    const movingPiece = this.game.get(this.selectedSquare);
    const promotes =
      movingPiece?.type === "p" &&
      ((movingPiece.color === "w" && square.endsWith("8")) || (movingPiece.color === "b" && square.endsWith("1")));

    if (promotes) {
      this.pendingPromotion = { from: this.selectedSquare, to: square };
      this.showPromotionDialog();
      return;
    }

    this.commitMove(this.selectedSquare, square);
  }

  private selectSquare(square: Square) {
    this.selectedSquare = square;
    this.legalTargets = [...new Set(this.game.moves({ square, verbose: true }).map((move) => move.to))];
    this.updateHighlights();
  }

  private canInteractWithBoard() {
    return !this.online || this.role === "w" || this.role === "b";
  }

  private commitMove(from: Square, to: Square, promotion?: PromotionPiece) {
    if (this.online) {
      this.selectedSquare = null;
      this.legalTargets = [];
      this.pendingPromotion = null;
      this.hidePromotionDialog();
      this.updateHighlights();
      this.sendToServer({ type: "move", from, to, promotion });
      return;
    }

    try {
      const move = this.game.move({ from, to, promotion });
      if (!move) {
        this.flashStatus("Недопустимый ход", "danger");
        return;
      }

      this.lastMove = { from, to };
      this.selectedSquare = null;
      this.legalTargets = [];
      this.pendingPromotion = null;
      this.hidePromotionDialog();
      this.rebuildPieces({ from, to, capture: Boolean(move.captured) });
      this.updateHighlights();
      this.updateHud();
      this.playMoveSound(move);
    } catch {
      this.flashStatus("Недопустимый ход", "danger");
    }
  }

  private showPromotionDialog() {
    this.promotionDialog.hidden = false;
    const queen = this.promotionDialog.querySelector<HTMLButtonElement>("[data-promotion='q']");
    queen?.focus();
  }

  private hidePromotionDialog() {
    this.promotionDialog.hidden = true;
    this.pendingPromotion = null;
  }

  private getClientKey() {
    const existing = window.localStorage.getItem("chessAtelierClientKey");
    if (existing) {
      return existing;
    }
    const key = crypto.randomUUID();
    window.localStorage.setItem("chessAtelierClientKey", key);
    return key;
  }

  private shouldUseServer() {
    return window.location.hostname !== "github.io" && !window.location.hostname.endsWith(".github.io");
  }

  private connectToServer() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    this.socket = new WebSocket(`${protocol}//${window.location.host}/game`);

    this.socket.addEventListener("open", () => {
      this.online = true;
      this.sendToServer({ type: "hello", clientKey: this.clientKey, leaderboard: this.leaderboard });
      this.updateControls();
    });

    this.socket.addEventListener("message", (event) => {
      let message: ServerStateMessage | { type: "error"; message: string };
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (message.type === "error") {
        this.flashStatus(message.message, "warning");
        return;
      }

      if (message.type === "state") {
        this.applyServerState(message);
      }
    });

    this.socket.addEventListener("close", () => {
      this.online = false;
      this.role = null;
      this.roleBadge.textContent = "Оффлайн";
      this.updateControls();
    });
  }

  private sendToServer(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.flashStatus("Связь еще не готова", "warning");
      return;
    }
    this.socket.send(JSON.stringify({ ...payload, clientKey: this.clientKey }));
  }

  private applyServerState(state: ServerStateMessage) {
    this.online = true;
    this.role = state.role;
    this.serverHistory = state.history;
    this.sessionScore.white = state.score.white;
    this.sessionScore.black = state.score.black;
    this.sessionScore.draws = state.score.draws;
    this.recordedResult = state.recordedResult;
    this.playerNames.w = state.names.w;
    this.playerNames.b = state.names.b;
    if (state.game.id) {
      this.currentGameId = state.game.id;
    }
    if (state.leaderboard) {
      this.mergeLeaderboard(state.leaderboard);
    }

    const moveAnimation = this.getServerMoveAnimation(state);
    this.game.load(state.game.fen);
    this.playServerStateSound(state);
    this.selectedSquare = null;
    this.legalTargets = [];
    this.pendingPromotion = null;
    this.hidePromotionDialog();
    this.lastMove = this.serverHistory.length
      ? {
          from: this.serverHistory[this.serverHistory.length - 1].from,
          to: this.serverHistory[this.serverHistory.length - 1].to,
        }
      : null;

    this.rebuildPieces(moveAnimation);
    this.updateHighlights();
    this.updateHud();
    this.updateControls();

    if (this.role) {
      this.hidePlayerDialog();
    } else if (!this.cameraTestMode && !this.fullScaleMode) {
      this.showPlayerDialog(true);
    }
  }

  private playServerStateSound(state: ServerStateMessage) {
    const gameId = state.game.id ?? this.currentGameId;
    const moveCount = state.history.length;

    if (!this.lastSoundedGameId) {
      this.lastSoundedGameId = gameId;
      this.lastSoundedMoveCount = moveCount;
      return;
    }

    if (gameId !== this.lastSoundedGameId) {
      this.lastSoundedGameId = gameId;
      this.lastSoundedMoveCount = moveCount;
      if (moveCount === 0) {
        this.sound.play("start");
      }
      return;
    }

    if (moveCount > this.lastSoundedMoveCount) {
      const move = state.history[moveCount - 1];
      if (move) {
        this.playMoveSound(move);
      }
    }
    this.lastSoundedMoveCount = moveCount;
  }

  private getServerMoveAnimation(state: ServerStateMessage): PieceMoveAnimation | null {
    const gameId = state.game.id ?? this.currentGameId;
    const moveCount = state.history.length;

    if (!this.lastAnimatedGameId) {
      this.lastAnimatedGameId = gameId;
      this.lastAnimatedMoveCount = moveCount;
      return null;
    }

    if (gameId !== this.lastAnimatedGameId) {
      this.lastAnimatedGameId = gameId;
      this.lastAnimatedMoveCount = moveCount;
      return null;
    }

    const move = moveCount > this.lastAnimatedMoveCount ? state.history[moveCount - 1] : null;
    this.lastAnimatedMoveCount = moveCount;

    return move ? { from: move.from, to: move.to, capture: Boolean(move.captured) } : null;
  }

  private playMoveSound(move: Move) {
    if (this.game.isCheckmate()) {
      this.sound.play("mate");
    } else if (this.game.isGameOver()) {
      this.sound.play("gameOver");
    } else if (this.game.isCheck()) {
      this.sound.play("check");
    } else if (move.captured) {
      this.sound.play("capture");
    } else {
      this.sound.play("move");
    }
  }

  private updateControls() {
    const canPlay = !this.online || this.role === "w" || this.role === "b";
    document.querySelector<HTMLButtonElement>("#newGameBtn")!.disabled = !canPlay || !this.game.isGameOver();

    if (!this.online) {
      this.roleBadge.textContent = "Локально";
    } else if (this.role === "w") {
      this.roleBadge.textContent = "Белые";
    } else if (this.role === "b") {
      this.roleBadge.textContent = "Черные";
    } else if (this.role === "spectator") {
      this.roleBadge.textContent = "Зритель";
    } else {
      this.roleBadge.textContent = "Войти";
    }
    this.roleBadge.title =
      this.role === "w" || this.role === "b" ? "Изменить имя игрока" : "Войти в партию";
    this.updateLeaderboardSyncLabel();
    this.updateSoundButton();
  }

  private updateSoundButton() {
    this.soundBtn.textContent = this.sound.enabled ? "Звук" : "Тихо";
    this.soundBtn.classList.toggle("muted", !this.sound.enabled);
    this.soundBtn.setAttribute("aria-pressed", String(this.sound.enabled));
    this.soundBtn.title = this.sound.enabled ? "Выключить звук" : "Включить звук";
  }

  private showPlayerDialog(initial: boolean) {
    this.playerNameInput.value = this.getDialogNameValue();
    this.playerCancelBtn.hidden = initial && !this.role;
    this.playerSubmitBtn.textContent = this.role === "w" || this.role === "b" ? "Сохранить" : "Войти";
    this.playerDialogCopy.textContent =
      this.role === "spectator"
        ? "Оба места игроков уже заняты. С этого браузера можно только смотреть."
        : "Введите имя, чтобы занять следующее свободное место. После белых и черных остальные зрители только смотрят.";
    this.playerDialog.hidden = false;
    window.setTimeout(() => this.playerNameInput.focus(), 0);
  }

  private hidePlayerDialog() {
    this.playerDialog.hidden = true;
  }

  private savePlayerNames() {
    this.displayName = this.cleanPlayerName(this.playerNameInput.value, "Игрок");
    window.localStorage.setItem("chessAtelierDisplayName", this.displayName);
    if (this.online) {
      this.sendToServer({
        type: this.role === "w" || this.role === "b" ? "rename" : "join",
        name: this.displayName,
        leaderboard: this.leaderboard,
      });
    } else {
      this.playerNames.w = this.displayName;
    }
    this.hidePlayerDialog();
    this.updateHud();
  }

  private getDialogNameValue() {
    const savedName = this.displayName.trim();
    if (savedName && !this.isWaitingSeatName(savedName)) {
      return savedName;
    }

    const seatName =
      this.role === "w" ? this.playerNames.w : this.role === "b" ? this.playerNames.b : "";
    return this.isWaitingSeatName(seatName) ? "" : seatName;
  }

  private isWaitingSeatName(name: string) {
    return (
      name === "Waiting for White" ||
      name === "Waiting for Black" ||
      name === "Ждем белых" ||
      name === "Ждем черных"
    );
  }

  private cleanPlayerName(value: string, fallback: string) {
    const clean = value.trim().replace(/\s+/g, " ").slice(0, 18);
    return clean.length > 0 ? clean : fallback;
  }

  private createLocalGameId() {
    return `${this.localMatchId}:${this.localGameCounter}`;
  }

  private advanceLocalGameId() {
    this.localGameCounter += 1;
    this.currentGameId = this.createLocalGameId();
  }

  private emptyLeaderboard(): LeaderboardState {
    return {
      version: 1,
      updatedAt: Date.now(),
      records: {},
      games: {},
      removedGames: {},
    };
  }

  private loadLeaderboard() {
    try {
      if (new URLSearchParams(window.location.search).has("clearLeaderboard")) {
        window.localStorage.removeItem(leaderboardStorageKey);
        window.history.replaceState(null, "", window.location.pathname);
        return this.emptyLeaderboard();
      }
      const raw = window.localStorage.getItem(leaderboardStorageKey);
      if (!raw) {
        return this.emptyLeaderboard();
      }
      return this.sanitizeLeaderboard(JSON.parse(raw));
    } catch {
      return this.emptyLeaderboard();
    }
  }

  private saveLeaderboard() {
    window.localStorage.setItem(leaderboardStorageKey, JSON.stringify(this.leaderboard));
  }

  private sanitizeLeaderboard(raw: unknown): LeaderboardState {
    const source = raw && typeof raw === "object" ? (raw as Partial<LeaderboardState>) : {};
    const clean = this.emptyLeaderboard();
    clean.updatedAt = this.safeTimestamp(source.updatedAt);

    Object.values(source.records ?? {})
      .slice(0, 100)
      .forEach((record) => {
        const cleaned = this.sanitizeLeaderboardRecord(record);
        clean.records[cleaned.id] = cleaned;
        clean.updatedAt = Math.max(clean.updatedAt, cleaned.updatedAt);
      });

    Object.values(source.games ?? {})
      .slice(0, 400)
      .forEach((game) => {
        const cleaned = this.sanitizeLeaderboardGame(game);
        if (cleaned) {
          clean.games[cleaned.id] = cleaned;
          clean.updatedAt = Math.max(clean.updatedAt, cleaned.updatedAt);
        }
      });

    Object.entries(source.removedGames ?? {})
      .slice(0, 400)
      .forEach(([id, removedAt]) => {
        const cleanId = this.storageId(id);
        if (cleanId) {
          clean.removedGames[cleanId] = this.safeTimestamp(removedAt);
          clean.updatedAt = Math.max(clean.updatedAt, clean.removedGames[cleanId]);
        }
      });

    return clean;
  }

  private sanitizeLeaderboardRecord(raw: unknown): LeaderboardRecord {
    const source = raw && typeof raw === "object" ? (raw as Partial<LeaderboardRecord>) : {};
    const name = this.cleanPlayerName(source.name ?? "", "Игрок");
    const id = this.playerId(source.id ?? name);
    const wins = this.safeCount(source.wins);
    const losses = this.safeCount(source.losses);
    const draws = this.safeCount(source.draws);
    return {
      id,
      name,
      wins,
      losses,
      draws,
      games: this.safeCount(source.games) || wins + losses + draws,
      updatedAt: this.safeTimestamp(source.updatedAt),
    };
  }

  private sanitizeLeaderboardGame(raw: unknown): LeaderboardGame | null {
    const source = raw && typeof raw === "object" ? (raw as Partial<LeaderboardGame>) : {};
    const id = this.storageId(source.id);
    const result = source.result;
    if (!id || (result !== "white" && result !== "black" && result !== "draw")) {
      return null;
    }
    return {
      id,
      whiteId: this.playerId(source.whiteId ?? "Белые"),
      blackId: this.playerId(source.blackId ?? "Черные"),
      result,
      completedAt: this.safeTimestamp(source.completedAt),
      updatedAt: this.safeTimestamp(source.updatedAt ?? source.completedAt),
    };
  }

  private safeCount(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
  }

  private safeTimestamp(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : Date.now();
  }

  private playerId(name: unknown) {
    return this.cleanPlayerName(String(name ?? ""), "Игрок").toLocaleLowerCase("ru-RU");
  }

  private storageId(value: unknown) {
    return String(value ?? "").trim().slice(0, 140);
  }

  private mergeLeaderboard(incoming: unknown) {
    if (!incoming || typeof incoming !== "object") {
      return false;
    }

    const clean = this.sanitizeLeaderboard(incoming);
    let changed = false;

    Object.values(clean.records).forEach((record) => {
      const existing = this.leaderboard.records[record.id];
      if (!existing || record.updatedAt > existing.updatedAt) {
        this.leaderboard.records[record.id] = record;
        changed = true;
      }
    });

    Object.entries(clean.removedGames).forEach(([id, removedAt]) => {
      if (!this.leaderboard.removedGames[id] || removedAt > this.leaderboard.removedGames[id]) {
        this.leaderboard.removedGames[id] = removedAt;
        delete this.leaderboard.games[id];
        changed = true;
      }
    });

    Object.values(clean.games).forEach((game) => {
      if (this.leaderboard.removedGames[game.id] && this.leaderboard.removedGames[game.id] >= game.updatedAt) {
        return;
      }
      const existing = this.leaderboard.games[game.id];
      if (!existing || game.updatedAt > existing.updatedAt) {
        this.leaderboard.games[game.id] = game;
        changed = true;
      }
    });

    if (changed) {
      this.leaderboard.updatedAt = Math.max(this.leaderboard.updatedAt, clean.updatedAt, Date.now());
      this.saveLeaderboard();
      this.renderLeaderboard();
    }

    return changed;
  }

  private publishLeaderboard() {
    if (this.online && this.socket?.readyState === WebSocket.OPEN) {
      this.sendToServer({ type: "leaderboard", leaderboard: this.leaderboard });
    }
  }

  private ensureLeaderboardRecord(name: string) {
    const id = this.playerId(name);
    const existing = this.leaderboard.records[id];
    if (existing) {
      return existing;
    }
    const now = Date.now();
    const record: LeaderboardRecord = {
      id,
      name: this.cleanPlayerName(name, "Игрок"),
      wins: 0,
      losses: 0,
      draws: 0,
      games: 0,
      updatedAt: now,
    };
    this.leaderboard.records[id] = record;
    return record;
  }

  private touchLeaderboardRecord(
    record: LeaderboardRecord,
    delta: Partial<Pick<LeaderboardRecord, "wins" | "losses" | "draws">>,
  ) {
    record.wins = Math.max(0, record.wins + (delta.wins ?? 0));
    record.losses = Math.max(0, record.losses + (delta.losses ?? 0));
    record.draws = Math.max(0, record.draws + (delta.draws ?? 0));
    record.games = record.wins + record.losses + record.draws;
    record.updatedAt = Date.now();
    this.leaderboard.updatedAt = record.updatedAt;
  }

  private recordLeaderboardResult(result: ScoreResult) {
    if (this.leaderboard.games[this.currentGameId]) {
      return;
    }
    delete this.leaderboard.removedGames[this.currentGameId];

    const white = this.ensureLeaderboardRecord(this.playerName("w"));
    const black = this.ensureLeaderboardRecord(this.playerName("b"));
    const completedAt = Date.now();

    this.leaderboard.games[this.currentGameId] = {
      id: this.currentGameId,
      whiteId: white.id,
      blackId: black.id,
      result,
      completedAt,
      updatedAt: completedAt,
    };

    if (result === "white") {
      this.touchLeaderboardRecord(white, { wins: 1 });
      this.touchLeaderboardRecord(black, { losses: 1 });
    } else if (result === "black") {
      this.touchLeaderboardRecord(white, { losses: 1 });
      this.touchLeaderboardRecord(black, { wins: 1 });
    } else {
      this.touchLeaderboardRecord(white, { draws: 1 });
      this.touchLeaderboardRecord(black, { draws: 1 });
    }

    this.saveLeaderboard();
    this.renderLeaderboard();
    this.publishLeaderboard();
  }

  private renderLeaderboard() {
    this.leaderboardList.replaceChildren();
    const records = Object.values(this.leaderboard.records)
      .filter((record) => record.games > 0)
      .sort((a, b) => {
        const pointsA = a.wins * 3 + a.draws;
        const pointsB = b.wins * 3 + b.draws;
        return pointsB - pointsA || b.wins - a.wins || b.games - a.games || b.updatedAt - a.updatedAt;
      })
      .slice(0, 6);

    if (!records.length) {
      const empty = document.createElement("li");
      empty.className = "leaderboard-empty";
      empty.textContent = "Сыграйте партию, чтобы сохранить результат";
      this.leaderboardList.append(empty);
      this.updateLeaderboardSyncLabel();
      return;
    }

    records.forEach((record, index) => {
      const row = document.createElement("li");
      row.className = "leaderboard-row";

      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = String(index + 1);

      const name = document.createElement("span");
      name.className = "leaderboard-name";
      name.textContent = record.name;

      const score = document.createElement("span");
      score.className = "leaderboard-score";
      score.textContent = `${record.wins}-${record.losses}-${record.draws}`;

      row.append(rank, name, score);
      this.leaderboardList.append(row);
    });

    this.updateLeaderboardSyncLabel();
  }

  private updateLeaderboardSyncLabel() {
    this.leaderboardSync.textContent = this.online ? "Синхр." : "Локально";
  }

  private updateHighlights() {
    this.disposeGroupChildren(this.highlightGroup);

    if (this.lastMove) {
      this.addSquareOverlay(this.lastMove.from, this.boardMaterials.lastMove, 0.02, 0.94);
      this.addSquareOverlay(this.lastMove.to, this.boardMaterials.lastMove, 0.021, 0.94);
    }

    if (this.selectedSquare) {
      this.addSquareOverlay(this.selectedSquare, this.boardMaterials.selected, 0.03, 0.96);
    }

    this.legalTargets.forEach((square) => {
      const occupied = this.game.get(square);
      const material = occupied ? this.boardMaterials.captureMarker : this.boardMaterials.marker;
      const geometry = occupied ? new THREE.RingGeometry(0.27, 0.42, 40) : new THREE.CircleGeometry(0.16, 40);
      const marker = new THREE.Mesh(geometry, material.clone());
      const position = this.squareToLocal(square);
      marker.position.set(position.x, 0.095, position.z);
      marker.rotation.x = -Math.PI / 2;
      marker.userData.pulse = true;
      this.highlightGroup.add(marker);
    });
  }

  private addSquareOverlay(square: Square, material: THREE.Material, yOffset: number, size: number) {
    const geometry = new THREE.PlaneGeometry(size, size);
    const overlay = new THREE.Mesh(geometry, material.clone());
    const position = this.squareToLocal(square);
    overlay.position.set(position.x, 0.083 + yOffset, position.z);
    overlay.rotation.x = -Math.PI / 2;
    this.highlightGroup.add(overlay);
  }

  private updateHud() {
    const turn = this.game.turn();
    const history = this.serverHistory ?? (this.game.history({ verbose: true }) as Move[]);
    const result = this.getGameResult();

    if (!this.online && result && !this.recordedResult) {
      this.applyScoreResult(result, 1);
      this.recordedResult = result;
      this.recordLeaderboardResult(result);
    }

    this.moveCount.textContent = String(Math.ceil(history.length / 2));
    this.turnBadge.textContent = this.playerName(turn);
    this.turnBadge.classList.toggle("white", turn === "w");
    this.turnBadge.classList.toggle("black", turn === "b");

    this.statusText.className = "status-text";
    if (this.game.isCheckmate()) {
      const winner = turn === "w" ? "b" : "w";
      this.statusText.textContent = `Мат. Победитель: ${this.playerName(winner)}`;
      this.statusText.classList.add("danger");
    } else if (this.game.isStalemate()) {
      this.statusText.textContent = "Ничья: пат";
      this.statusText.classList.add("warning");
    } else if (this.game.isDraw()) {
      this.statusText.textContent = "Ничья";
      this.statusText.classList.add("warning");
    } else if (this.game.inCheck()) {
      this.statusText.textContent = this.turnStatus(turn, " - шах");
      this.statusText.classList.add("warning");
    } else {
      this.statusText.textContent = this.turnStatus(turn);
    }

    this.renderMoveList(history);
    this.renderCaptures(history);
    this.renderScoreboard(history);
    this.renderLeaderboard();

    this.moveCount.textContent = String(Math.ceil(history.length / 2));
  }

  private getGameResult(): ScoreResult | null {
    if (this.game.isCheckmate()) {
      return this.game.turn() === "w" ? "black" : "white";
    }
    if (this.game.isStalemate() || this.game.isDraw()) {
      return "draw";
    }
    return null;
  }

  private applyScoreResult(result: ScoreResult, delta: 1 | -1) {
    if (result === "white") {
      this.sessionScore.white = Math.max(0, this.sessionScore.white + delta);
    } else if (result === "black") {
      this.sessionScore.black = Math.max(0, this.sessionScore.black + delta);
    } else {
      this.sessionScore.draws = Math.max(0, this.sessionScore.draws + delta);
    }
  }

  private renderMoveList(history: Move[]) {
    this.moveList.replaceChildren();
    for (let index = 0; index < history.length; index += 2) {
      const row = document.createElement("li");
      row.className = "move-row";
      if (index >= history.length - 2) {
        row.classList.add("latest");
      }

      const number = document.createElement("span");
      number.className = "move-number";
      number.textContent = `${index / 2 + 1}.`;

      const white = document.createElement("span");
      white.className = "move-san";
      white.textContent = this.formatMoveSan(history[index]?.san ?? "");

      const black = document.createElement("span");
      black.className = "move-san";
      black.textContent = this.formatMoveSan(history[index + 1]?.san ?? "");

      row.append(number, white, black);
      this.moveList.append(row);
    }
    this.moveList.scrollTop = this.moveList.scrollHeight;
  }

  private formatMoveSan(san: string) {
    return san
      .replace(/^K/, "Кр")
      .replace(/^Q/, "Ф")
      .replace(/^R/, "Л")
      .replace(/^B/, "С")
      .replace(/^N/, "К")
      .replace(/=Q/g, "=Ф")
      .replace(/=R/g, "=Л")
      .replace(/=B/g, "=С")
      .replace(/=N/g, "=К");
  }

  private renderCaptures(history: Move[]) {
    const captures = this.getCaptures(history);
    this.whiteCaptures.textContent = captures.white.map((piece) => pieceGlyphs.b[piece]).join(" ");
    this.blackCaptures.textContent = captures.black.map((piece) => pieceGlyphs.w[piece]).join(" ");

    const trophies = this.getCaptureTrophies(history);
    const latest = trophies[trophies.length - 1];
    const animateKey = latest && latest.key !== this.lastTrophyCaptureKey ? latest.key : null;
    this.rebuildCaptureTrophies(trophies, animateKey);
    this.lastTrophyCaptureKey = latest?.key ?? null;
  }

  private getCaptures(history: Move[]) {
    const captures: Captures = { white: [], black: [] };
    history.forEach((move) => {
      if (!move.captured) {
        return;
      }
      if (move.color === "w") {
        captures.white.push(move.captured);
      } else {
        captures.black.push(move.captured);
      }
    });

    captures.white.sort((a, b) => pieceOrder[a] - pieceOrder[b]);
    captures.black.sort((a, b) => pieceOrder[a] - pieceOrder[b]);
    return captures;
  }

  private getCaptureTrophies(history: Move[]) {
    const trophies: CaptureTrophy[] = [];
    history.forEach((move, index) => {
      if (!move.captured) {
        return;
      }
      trophies.push({
        by: move.color,
        color: move.color === "w" ? "b" : "w",
        key: `${index}:${move.from}:${move.to}:${move.captured}`,
        piece: move.captured,
        square: move.to,
      });
    });
    return trophies;
  }

  private rebuildCaptureTrophies(trophies: CaptureTrophy[], animateKey: string | null) {
    this.disposeGroupChildren(this.trophyGroup);
    const counts: Record<Color, number> = { w: 0, b: 0 };
    const now = performance.now();

    trophies.forEach((trophy) => {
      const index = counts[trophy.by];
      counts[trophy.by] += 1;
      const target = this.trophyPosition(trophy.by, index);
      const group = this.createPiece(trophy.piece, trophy.color);
      group.scale.multiplyScalar(0.46);
      group.position.copy(target);
      group.rotation.y = trophy.by === "w" ? -0.2 : 0.2;
      group.userData.kind = "trophy";

      if (trophy.key === animateKey) {
        const from = this.squareToLocal(trophy.square);
        group.position.set(from.x, squareTopY + 0.18, from.z);
        group.userData.motion = {
          from: new THREE.Vector3(from.x, squareTopY + 0.18, from.z),
          to: target,
          startedAt: now,
          duration: 680,
          lift: 0.9,
          spin: trophy.by === "w" ? 1.1 : -1.1,
        } satisfies SceneMotion;
      }

      this.trophyGroup.add(group);
    });
  }

  private trophyPosition(by: Color, index: number) {
    const side = by === "w" ? 1 : -1;
    const row = index % 8;
    const column = Math.floor(index / 8);
    return new THREE.Vector3(side * (5.24 + column * 0.42), 0.17, 3.08 - row * 0.88);
  }

  private renderScoreboard(history: Move[]) {
    const captures = this.getCaptures(history);
    const whiteMaterial = captures.white.reduce((score, piece) => score + pieceValues[piece], 0);
    const blackMaterial = captures.black.reduce((score, piece) => score + pieceValues[piece], 0);
    const materialDiff = whiteMaterial - blackMaterial;
    const scoreDiff = this.sessionScore.white - this.sessionScore.black;

    this.whiteGameScore.textContent = String(this.sessionScore.white);
    this.blackGameScore.textContent = String(this.sessionScore.black);
    this.drawGameScore.textContent = String(this.sessionScore.draws);
    this.whitePlayerName.textContent = this.playerName("w");
    this.blackPlayerName.textContent = this.playerName("b");
    this.whiteCaptureLabel.textContent = this.playerName("w");
    this.blackCaptureLabel.textContent = this.playerName("b");
    this.whiteMaterial.textContent = `М: ${this.formatSigned(materialDiff)}`;
    this.blackMaterial.textContent = `М: ${this.formatSigned(-materialDiff)}`;
    this.scoreLead.textContent =
      scoreDiff === 0 ? "Ровный матч" : `${this.playerName(scoreDiff > 0 ? "w" : "b")} +${Math.abs(scoreDiff)}`;
  }

  private formatSigned(value: number) {
    if (value === 0) {
      return "+0";
    }
    return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
  }

  private turnStatus(color: Color, suffix = "") {
    const name = this.playerName(color);
    return this.isWaitingSeatName(name) ? `${name}${suffix}` : `Ход: ${name}${suffix}`;
  }

  private flashStatus(message: string, tone: "warning" | "danger") {
    const previous = this.statusText.textContent ?? "";
    const previousClass = this.statusText.className;
    this.statusText.textContent = message;
    this.statusText.className = `status-text ${tone}`;
    if (tone === "danger") {
      this.sound.play("illegal");
    }
    window.setTimeout(() => {
      this.statusText.textContent = previous;
      this.statusText.className = previousClass;
    }, 900);
  }

  private playerName(color: Color) {
    return this.playerNames[color];
  }

  private squareToLocal(square: Square) {
    const file = files.indexOf(square[0] as (typeof files)[number]);
    const rank = ranks.indexOf(square[1] as (typeof ranks)[number]);
    return new THREE.Vector3(file - 3.5, 0, 3.5 - rank);
  }

  private squareToScreen(square: Square) {
    const local = this.squareToLocal(square);
    const world = this.boardGroup.localToWorld(local.clone());
    world.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((world.x + 1) / 2) * rect.width,
      y: rect.top + ((-world.y + 1) / 2) * rect.height,
    };
  }

  private disposeGroupChildren(group: THREE.Group) {
    const children = [...group.children];
    children.forEach((child) => {
      group.remove(child);
      child.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          this.disposeMaterial(object.material);
        }
        if (object instanceof THREE.Sprite) {
          this.disposeMaterial(object.material);
        }
      });
    });
  }

  private disposeMaterial(material: THREE.Material | THREE.Material[]) {
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((item) => {
      if (this.isSharedMaterial(item)) {
        return;
      }
      const maybeWithMap = item as THREE.Material & { map?: THREE.Texture };
      maybeWithMap.map?.dispose();
      item.dispose();
    });
  }

  private isSharedMaterial(material: THREE.Material) {
    return (
      material === this.whitePieceMaterial ||
      material === this.whiteTrimMaterial ||
      material === this.blackPieceMaterial ||
      material === this.blackTrimMaterial ||
      Object.values(this.boardMaterials).some((shared) => shared === material)
    );
  }

  private installDebugApi() {
    const api = {
      probe: () => this.debugProbe(),
      squareScreen: (square: Square) => this.squareToScreen(square),
      snapshot: () => ({
        fen: this.game.fen(),
        status: this.statusText.textContent,
        selectedSquare: this.selectedSquare,
        legalTargets: this.legalTargets,
      }),
    };
    Object.assign(window, { __chessAtelier: api });
  }

  private debugProbe(): DebugProbe {
    const gl = this.renderer.getContext();
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixel = new Uint8Array(4);
    let nonTransparentSamples = 0;

    for (let y = 0; y < 5; y += 1) {
      for (let x = 0; x < 5; x += 1) {
        const px = Math.floor((width * (x + 0.5)) / 5);
        const py = Math.floor((height * (y + 0.5)) / 5);
        gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        const luminance = pixel[0] + pixel[1] + pixel[2];
        if (pixel[3] > 0 && luminance > 20) {
          nonTransparentSamples += 1;
        }
      }
    }

    return {
      canvas: {
        width,
        height,
        clientWidth: this.renderer.domElement.clientWidth,
        clientHeight: this.renderer.domElement.clientHeight,
      },
      camera: {
        freeCamera: Boolean(this.cameraControls),
        fullScale: this.fullScaleMode,
        position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
        testMode: this.cameraTestMode,
      },
      fen: this.game.fen(),
      frame: this.frame,
      nonTransparentSamples,
      movingPieceCount: this.pieceGroup.children.filter((piece) => Boolean(piece.userData.motion)).length,
      movingTrophyCount: this.trophyGroup.children.filter((piece) => Boolean(piece.userData.motion)).length,
      pieceCount: this.pieceGroup.children.length,
      trophyCount: this.trophyGroup.children.length,
      score: { ...this.sessionScore },
      leaderboard: this.leaderboard,
      role: this.role,
      selectedSquare: this.selectedSquare,
      soundEnabled: this.sound.enabled,
      status: this.statusText.textContent ?? "",
      playerNames: { ...this.playerNames },
    };
  }

  private animateMotion(object: THREE.Object3D, now: number) {
    const motion = object.userData.motion as SceneMotion | undefined;
    if (!motion) {
      return false;
    }

    const progress = Math.min(1, Math.max(0, (now - motion.startedAt) / motion.duration));
    const eased = 1 - (1 - progress) ** 3;
    object.position.lerpVectors(motion.from, motion.to, eased);
    object.position.y = THREE.MathUtils.lerp(motion.from.y, motion.to.y, eased) + Math.sin(progress * Math.PI) * motion.lift;
    object.rotation.y += motion.spin * (1 - progress) * 0.08;

    if (progress >= 1) {
      object.position.copy(motion.to);
      delete object.userData.motion;
    }

    return true;
  }

  private animate() {
    this.frame += 1;
    const elapsed = this.clock.getElapsedTime();
    const now = performance.now();

    this.boardGroup.rotation.y += (this.targetRotation - this.boardGroup.rotation.y) * 0.08;
    this.highlightGroup.children.forEach((child) => {
      const material = child instanceof THREE.Mesh ? child.material : null;
      if (child.userData.pulse && material instanceof THREE.MeshBasicMaterial) {
        material.opacity = 0.44 + Math.sin(elapsed * 4.2) * 0.12;
      }
    });

    this.pieceGroup.children.forEach((piece) => {
      if (this.animateMotion(piece, now)) {
        return;
      }
      const square = piece.userData.square as Square | undefined;
      if (square && square === this.hoverSquare) {
        piece.position.y += (0.16 - piece.position.y) * 0.18;
      } else {
        piece.position.y += (squareTopY - piece.position.y) * 0.18;
      }
    });
    this.trophyGroup.children.forEach((piece) => {
      this.animateMotion(piece, now);
    });
    if (this.fullScaleMode) {
      this.scene.traverse((object) => {
        if (object.userData.flame) {
          const pulse = 0.86 + Math.sin(elapsed * 8.5 + object.id) * 0.1 + Math.sin(elapsed * 15.2 + object.id) * 0.04;
          object.scale.set(1, pulse, 1);
        }
        if (object instanceof THREE.PointLight && object.userData.flameLight) {
          object.intensity = 2.7 + Math.sin(elapsed * 7.4 + object.id) * 0.42 + Math.sin(elapsed * 13.1) * 0.18;
        }
      });
    }

    this.cameraControls?.update();
    this.renderer.render(this.scene, this.camera);
    window.requestAnimationFrame(() => this.animate());
  }
}

new ChessAtelier();

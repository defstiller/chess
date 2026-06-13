import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";
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
type PieceStyle = "fantasy" | "classic";

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
  stateRevision?: number;
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

type ServerHoverMessage = {
  type: "hover";
  by: Color;
  square: Square | null;
};

type ServerMessage = ServerStateMessage | ServerHoverMessage | { type: "error"; message: string };

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
  pieceStyle: PieceStyle;
  trophyCount: number;
  score: SessionScore;
  leaderboard: LeaderboardState;
  online: boolean;
  serverExpected: boolean;
  serverConnection: string;
  awaitingMoveAck: boolean;
  stateRevision: number;
  role: PlayerRole;
  hoverSquare: string | null;
  lastSentHoverSquare: string | null;
  selectedSquare: string | null;
  remoteHoverSquare: string | null;
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

type ModelAsset = {
  scene: THREE.Object3D;
  clips: THREE.AnimationClip[];
};

type ModelFit = {
  maxWidth: number;
  maxDepth: number;
  maxHeight: number;
  groundY: number;
};

type ClassicModelFit = {
  maxWidth: number;
  maxDepth: number;
  maxHeight: number;
};

type DecorativeStatueSpec = {
  color: Color;
  piece: PieceSymbol;
  rotation: number;
  scale: number;
  x: number;
  z: number;
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
const pieceStyleStorageKey = "chessAtelierPieceStyle";
const assetBaseUrl = import.meta.env.BASE_URL || "/";
const modelAssetBaseUrl = assetBaseUrl.replace(/\/$/, "");
const modelCacheKey = "ru-models-1";
const classicModelCacheKey = "staunton-set-1";
const classicPieceUrls: Record<PieceSymbol, string> = {
  p: `${modelAssetBaseUrl}/models/classic/staunton-pawn.stl?v=${classicModelCacheKey}`,
  r: `${modelAssetBaseUrl}/models/classic/staunton-rook.stl?v=${classicModelCacheKey}`,
  n: `${modelAssetBaseUrl}/models/classic/staunton-knight.stl?v=${classicModelCacheKey}`,
  b: `${modelAssetBaseUrl}/models/classic/staunton-bishop.stl?v=${classicModelCacheKey}`,
  q: `${modelAssetBaseUrl}/models/classic/staunton-queen.stl?v=${classicModelCacheKey}`,
  k: `${modelAssetBaseUrl}/models/classic/staunton-king.stl?v=${classicModelCacheKey}`,
};
const modelPieceUrls: Record<PieceSymbol, string> = {
  p: `${modelAssetBaseUrl}/models/custom/ru-peshka.glb?v=${modelCacheKey}`,
  r: `${modelAssetBaseUrl}/models/custom/ru-ladya.glb?v=${modelCacheKey}`,
  n: `${modelAssetBaseUrl}/models/custom/ru-kon.glb?v=${modelCacheKey}`,
  b: `${modelAssetBaseUrl}/models/custom/ru-slon.glb?v=${modelCacheKey}`,
  q: `${modelAssetBaseUrl}/models/custom/ru-ferz.glb?v=${modelCacheKey}`,
  k: `${modelAssetBaseUrl}/models/custom/ru-korol.glb?v=${modelCacheKey}`,
};
const modelPieceFits: Record<PieceSymbol, ModelFit> = {
  p: { maxWidth: 0.62, maxDepth: 0.56, maxHeight: 1.05, groundY: 0.25 },
  r: { maxWidth: 0.92, maxDepth: 1.18, maxHeight: 1.08, groundY: 0.28 },
  n: { maxWidth: 0.86, maxDepth: 1.02, maxHeight: 1.4, groundY: 0.29 },
  b: { maxWidth: 0.9, maxDepth: 1.05, maxHeight: 1.26, groundY: 0.27 },
  q: { maxWidth: 0.98, maxDepth: 0.82, maxHeight: 1.45, groundY: 0.27 },
  k: { maxWidth: 0.96, maxDepth: 0.78, maxHeight: 1.45, groundY: 0.27 },
};
const classicPieceFits: Record<PieceSymbol, ClassicModelFit> = {
  p: { maxWidth: 0.56, maxDepth: 0.56, maxHeight: 0.94 },
  r: { maxWidth: 0.72, maxDepth: 0.72, maxHeight: 1.08 },
  n: { maxWidth: 0.78, maxDepth: 0.78, maxHeight: 1.38 },
  b: { maxWidth: 0.72, maxDepth: 0.72, maxHeight: 1.28 },
  q: { maxWidth: 0.78, maxDepth: 0.78, maxHeight: 1.48 },
  k: { maxWidth: 0.8, maxDepth: 0.8, maxHeight: 1.58 },
};
const decorativeStatueSpecs: DecorativeStatueSpec[] = [
  { color: "w", piece: "q", x: -11.2, scale: 1.55, z: -5.7, rotation: -2.04 },
  { color: "b", piece: "k", x: 11.2, scale: 1.55, z: -5.7, rotation: -1.1 },
];

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
  private readonly routeParams = new URLSearchParams(window.location.search);
  private readonly classicMode = window.location.pathname.startsWith("/classic") || this.routeParams.get("mode") === "classic";
  private readonly fullScaleMode = !this.classicMode;
  private readonly cameraTestMode =
    window.location.pathname.startsWith("/camera-test") || this.routeParams.get("mode") === "camera";
  private readonly game = new Chess();
  private readonly mount: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly boardGroup = new THREE.Group();
  private readonly highlightGroup = new THREE.Group();
  private readonly pieceGroup = new THREE.Group();
  private readonly trophyGroup = new THREE.Group();
  private readonly decorativeStatueGroup = new THREE.Group();
  private readonly sound = new SoundEngine();
  private readonly modelLoader = new GLTFLoader();
  private readonly stlLoader = new STLLoader();
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
  private readonly whiteClothMaterial: THREE.MeshStandardMaterial;
  private readonly blackClothMaterial: THREE.MeshStandardMaterial;
  private readonly classicWhiteMaterial: THREE.MeshStandardMaterial;
  private readonly classicWhiteTrimMaterial: THREE.MeshStandardMaterial;
  private readonly classicBlackMaterial: THREE.MeshStandardMaterial;
  private readonly classicBlackTrimMaterial: THREE.MeshStandardMaterial;
  private readonly feltMaterial: THREE.MeshStandardMaterial;
  private readonly leatherMaterial: THREE.MeshStandardMaterial;
  private readonly goldMaterial: THREE.MeshStandardMaterial;
  private readonly steelMaterial: THREE.MeshStandardMaterial;
  private pieceStyle: PieceStyle = this.loadPieceStyle();
  private selectedSquare: Square | null = null;
  private legalTargets: Square[] = [];
  private pendingPromotion: PendingPromotion | null = null;
  private hoverSquare: Square | null = null;
  private remoteHoverSquare: Square | null = null;
  private remoteHoverBy: Color | null = null;
  private remoteHoverExpiresAt = 0;
  private lastSentHoverSquare: Square | null = null;
  private lastMove: { from: Square; to: Square } | null = null;
  private readonly sessionScore: SessionScore = { white: 0, black: 0, draws: 0 };
  private readonly playerNames: PlayerNames = { w: "Белые", b: "Черные" };
  private readonly clientKey = this.getClientKey();
  private socket: WebSocket | null = null;
  private readonly serverExpected = this.shouldUseServer();
  private online = false;
  private serverConnection: "offline" | "connecting" | "online" | "reconnecting" = this.serverExpected
    ? "connecting"
    : "offline";
  private reconnectTimer: number | null = null;
  private reconnectDelayMs = 1000;
  private awaitingMoveAck = false;
  private stateRevision = 0;
  private role: PlayerRole = null;
  private modelAssets: Partial<Record<PieceSymbol, ModelAsset>> = {};
  private classicPieceGeometries: Partial<Record<PieceSymbol, THREE.BufferGeometry>> = {};
  private loadingClassicPieces = false;
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
  private statusFlashTimer: number | null = null;

  private readonly statusText = document.querySelector<HTMLSpanElement>("#statusText")!;
  private readonly roleBadge = document.querySelector<HTMLButtonElement>("#roleBadge")!;
  private readonly turnBadge = document.querySelector<HTMLSpanElement>("#turnBadge")!;
  private readonly turnCluster = document.querySelector<HTMLElement>(".turn-cluster")!;
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
  private readonly pieceStyleBtn = document.querySelector<HTMLButtonElement>("#pieceStyleBtn")!;
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
      color: 0x315a6d,
      roughness: 0.42,
      metalness: 0.1,
    });
    this.blackTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0x89d6df,
      roughness: 0.32,
      metalness: 0.2,
    });
    this.whiteClothMaterial = new THREE.MeshStandardMaterial({
      color: 0x1f82c1,
      roughness: 0.62,
      metalness: 0.02,
      side: THREE.DoubleSide,
    });
    this.blackClothMaterial = new THREE.MeshStandardMaterial({
      color: 0x2a7587,
      roughness: 0.66,
      metalness: 0.03,
      side: THREE.DoubleSide,
    });
    this.classicWhiteMaterial = new THREE.MeshStandardMaterial({
      color: 0xd6a65a,
      roughness: 0.34,
      metalness: 0.08,
    });
    this.classicWhiteTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0c77a,
      roughness: 0.28,
      metalness: 0.12,
    });
    this.classicBlackMaterial = new THREE.MeshStandardMaterial({
      color: 0x30363d,
      roughness: 0.38,
      metalness: 0.08,
      emissive: 0x101821,
      emissiveIntensity: 0.18,
    });
    this.classicBlackTrimMaterial = new THREE.MeshStandardMaterial({
      color: 0x6f7a84,
      roughness: 0.32,
      metalness: 0.14,
      emissive: 0x121820,
      emissiveIntensity: 0.12,
    });
    this.feltMaterial = new THREE.MeshStandardMaterial({
      color: 0x184a2f,
      roughness: 0.82,
      metalness: 0.01,
    });
    this.leatherMaterial = new THREE.MeshStandardMaterial({
      color: 0x3a2418,
      roughness: 0.64,
      metalness: 0.04,
    });
    this.goldMaterial = new THREE.MeshStandardMaterial({
      color: 0xd5a348,
      roughness: 0.32,
      metalness: 0.42,
    });
    this.steelMaterial = new THREE.MeshStandardMaterial({
      color: 0x9ba4a8,
      roughness: 0.36,
      metalness: 0.48,
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
    this.scene.add(this.decorativeStatueGroup);
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
    this.updatePieceStyleButton();
    this.updateHud();
    this.installDebugApi();
    void this.loadModelAssets();
    if (this.pieceStyle === "classic") {
      void this.loadClassicPieceAssets();
    }
    if (this.serverExpected) {
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

    this.rebuildDecorativeStatues();
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

  private rebuildDecorativeStatues() {
    if (!this.fullScaleMode) {
      return;
    }

    this.disposeGroupChildren(this.decorativeStatueGroup);
    decorativeStatueSpecs.forEach((statue) => {
      this.createDecorativeStatue(statue);
    });
  }

  private createDecorativeStatue(spec: DecorativeStatueSpec) {
    const statue = this.createPiece(spec.piece, spec.color);
    statue.position.set(spec.x, -0.34, spec.z);
    statue.scale.setScalar(spec.scale);
    statue.rotation.y = spec.rotation;
    statue.traverse((object) => {
      object.userData.kind = "statue";
      if (object instanceof THREE.Mesh) {
        object.receiveShadow = true;
        object.castShadow = true;
      }
    });
    this.decorativeStatueGroup.add(statue);
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
      const rack = new THREE.Mesh(new RoundedBoxGeometry(1.58, 0.14, 7.9, 4, 0.08), rackMaterial);
      rack.position.set(side * 5.72, 0.02, 0);
      rack.castShadow = true;
      rack.receiveShadow = true;
      this.boardGroup.add(rack);

      [4.86, 6.56].forEach((x) => {
        const rail = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.1, 8.08, 3, 0.04), trimMaterial);
        rail.position.set(side * x, 0.12, 0);
        rail.castShadow = true;
        rail.receiveShadow = true;
        this.boardGroup.add(rail);
      });
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

  private async loadModelAssets() {
    if (!this.fullScaleMode) {
      return;
    }

    const loadedEntries = await Promise.all(
      (Object.entries(modelPieceUrls) as Array<[PieceSymbol, string]>).map(async ([type, url]) => {
        try {
          const gltf = await this.modelLoader.loadAsync(url);
          return [type, this.prepareModelAsset(gltf)] as const;
        } catch (error) {
          console.warn(`Model for ${type} failed to load; using procedural fallback.`, error);
          return null;
        }
      }),
    );

    this.modelAssets = { ...this.modelAssets };
    loadedEntries.forEach((entry) => {
      if (entry) {
        this.modelAssets[entry[0]] = entry[1];
      }
    });

    if (loadedEntries.some(Boolean)) {
      this.rebuildPieces();
      this.rebuildDecorativeStatues();
      this.renderCaptures(this.serverHistory ?? (this.game.history({ verbose: true }) as Move[]));
    }
  }

  private async loadClassicPieceAssets() {
    const unloadedEntries = (Object.entries(classicPieceUrls) as Array<[PieceSymbol, string]>).filter(
      ([type]) => !this.classicPieceGeometries[type],
    );

    if (unloadedEntries.length === 0 || this.loadingClassicPieces) {
      return;
    }

    this.loadingClassicPieces = true;
    try {
      const loadedEntries = await Promise.all(
        unloadedEntries.map(async ([type, url]) => {
          try {
            const geometry = await this.stlLoader.loadAsync(url);
            return [type, this.prepareClassicPieceGeometry(type, geometry)] as const;
          } catch (error) {
            console.warn(`Classic model for ${type} failed to load; using procedural fallback.`, error);
            return null;
          }
        }),
      );

      this.classicPieceGeometries = { ...this.classicPieceGeometries };
      loadedEntries.forEach((entry) => {
        if (entry) {
          this.classicPieceGeometries[entry[0]] = entry[1];
        }
      });

      if (loadedEntries.some(Boolean) && this.pieceStyle === "classic") {
        this.rebuildPieces();
        this.rebuildDecorativeStatues();
        this.renderCaptures(this.serverHistory ?? (this.game.history({ verbose: true }) as Move[]));
      }
    } finally {
      this.loadingClassicPieces = false;
    }
  }

  private prepareClassicPieceGeometry(type: PieceSymbol, geometry: THREE.BufferGeometry) {
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box) {
      return geometry;
    }

    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const fit = classicPieceFits[type];
    const scale = Math.min(fit.maxWidth / size.x, fit.maxHeight / size.y, fit.maxDepth / size.z);
    geometry.translate(-center.x, -box.min.y, -center.z);
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  }

  private prepareModelAsset(gltf: GLTF): ModelAsset {
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    return { scene: gltf.scene, clips: gltf.animations };
  }

  private createModelPiece(type: PieceSymbol, color: Color) {
    const asset = this.modelAssets[type];
    if (!asset) {
      return null;
    }

    const group = new THREE.Group();
    const body = color === "w" ? this.whitePieceMaterial : this.blackPieceMaterial;
    const trim = color === "w" ? this.whiteTrimMaterial : this.blackTrimMaterial;
    const baseRadius = 0.39;

    this.addBaseShadow(group, baseRadius + 0.05);
    this.addCylinder(group, baseRadius * 0.78, baseRadius, 0.12, 0.06, trim);
    this.addCylinder(group, baseRadius * 0.64, baseRadius * 0.82, 0.13, 0.18, body);
    this.addTorus(group, baseRadius * 0.72, 0.021, 0.27, trim);

    const model = this.cloneModelAsset(asset);
    this.styleModelPiece(model, color);
    model.rotation.y = this.modelPieceRotation(type, color);
    const fit = modelPieceFits[type];
    this.fitModelToBox(model, fit.maxWidth, fit.maxDepth, fit.maxHeight, fit.groundY);
    group.add(model);

    return group;
  }

  private modelPieceRotation(type: PieceSymbol, color: Color) {
    if (type === "r") {
      return color === "w" ? -Math.PI / 2 : Math.PI / 2;
    }
    return color === "w" ? Math.PI : 0;
  }

  private cloneModelAsset(asset: ModelAsset) {
    const clone = SkeletonUtils.clone(asset.scene);
    clone.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.userData.keepGeometry = true;
        object.material = this.cloneModelMaterial(object.material);
      }
    });
    return clone;
  }

  private cloneModelMaterial(material: THREE.Material | THREE.Material[]) {
    const cloneOne = (item: THREE.Material) => {
      const clone = item.clone();
      const maybeWithMap = clone as THREE.Material & { map?: THREE.Texture };
      if (maybeWithMap.map) {
        maybeWithMap.map.userData.sharedModelTexture = true;
      }
      return clone;
    };
    return Array.isArray(material) ? material.map(cloneOne) : cloneOne(material);
  }

  private styleModelPiece(model: THREE.Object3D, color: Color) {
    const clothColor = color === "w" ? 0x1f82c1 : 0x2a95ad;
    const plumeColor = color === "w" ? 0x45c7e6 : 0xb6fbff;
    const armorColor = color === "w" ? 0xb9c1bd : 0xa9bdc4;
    const horseColor = color === "w" ? 0x3a2519 : 0x4d3d33;
    const generatedColor = color === "w" ? 0xd7cdb4 : 0x3b6f82;

    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) {
        return;
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => {
        if (!(material instanceof THREE.MeshStandardMaterial)) {
          return;
        }
        if (material.name.includes("FactionCloth")) {
          material.color.setHex(clothColor);
        } else if (material.name.includes("FactionPlume")) {
          material.color.setHex(plumeColor);
        } else if (material.name.includes("KnightArmor")) {
          material.color.setHex(armorColor);
        } else if (material.name.includes("HorseLeather")) {
          material.color.setHex(horseColor);
        } else if (material.name.includes("Generated")) {
          material.color.setHex(generatedColor);
          material.roughness = 0.72;
          material.metalness = 0.04;
        }
        if (color === "b") {
          material.emissive.setHex(0x071820);
          material.emissiveIntensity = 0.22;
        }
        material.needsUpdate = true;
      });
    });
  }

  private fitModelToBox(model: THREE.Object3D, maxWidth: number, maxDepth: number, maxHeight: number, groundY: number) {
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const scale = Math.min(maxWidth / size.x, maxDepth / size.z, maxHeight / size.y);
    model.scale.multiplyScalar(scale);
    model.updateWorldMatrix(true, true);

    const fitted = new THREE.Box3().setFromObject(model);
    const center = fitted.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    model.position.y += groundY - fitted.min.y;
  }

  private createClassicPiece(type: PieceSymbol, color: Color) {
    const group = new THREE.Group();
    const body = color === "w" ? this.classicWhiteMaterial : this.classicBlackMaterial;
    const trim = color === "w" ? this.classicWhiteTrimMaterial : this.classicBlackTrimMaterial;
    const accent = color === "w" ? this.classicBlackTrimMaterial : this.classicWhiteTrimMaterial;
    const classicGeometry = this.classicPieceGeometries[type];
    if (classicGeometry) {
      const fit = classicPieceFits[type];
      this.addBaseShadow(group, Math.max(fit.maxWidth, fit.maxDepth) * 0.58);
      this.addClassicModelPiece(group, type, color, body);
      return group;
    }

    const scale = type === "p" ? 0.9 : type === "r" ? 0.96 : type === "n" ? 0.98 : type === "b" ? 1 : 1.06;
    group.scale.setScalar(scale);
    this.addClassicBase(group, body, trim);

    if (type === "p") {
      this.addClassicPawn(group, body, trim);
    } else if (type === "r") {
      this.addClassicRook(group, body, trim);
    } else if (type === "n") {
      this.addClassicKnight(group, body, trim, color);
    } else if (type === "b") {
      this.addClassicBishop(group, body, trim, accent);
    } else if (type === "q") {
      this.addClassicQueen(group, body, trim);
    } else {
      this.addClassicKing(group, body, trim);
    }

    return group;
  }

  private addClassicModelPiece(group: THREE.Group, type: PieceSymbol, color: Color, body: THREE.Material) {
    const geometry = this.classicPieceGeometries[type];
    if (!geometry) {
      return;
    }

    const mesh = new THREE.Mesh(geometry, body);
    mesh.rotation.y = this.classicModelPieceRotation(type, color);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.keepGeometry = true;
    group.add(mesh);
  }

  private classicModelPieceRotation(type: PieceSymbol, color: Color) {
    if (type !== "n") {
      return 0;
    }

    return color === "w" ? Math.PI / 2 : -Math.PI / 2;
  }

  private addClassicBase(group: THREE.Group, body: THREE.Material, trim: THREE.Material) {
    this.addBaseShadow(group, 0.44);
    this.addCylinder(group, 0.36, 0.38, 0.05, 0.025, this.feltMaterial);
    this.addCylinder(group, 0.31, 0.38, 0.12, 0.09, body);
    this.addTorus(group, 0.32, 0.025, 0.155, trim);
    this.addCylinder(group, 0.24, 0.3, 0.1, 0.21, body);
    this.addTorus(group, 0.24, 0.018, 0.27, trim);
  }

  private addClassicLathe(group: THREE.Group, points: Array<[number, number]>, material: THREE.Material, segments = 56) {
    const geometry = new THREE.LatheGeometry(
      points.map(([radius, y]) => new THREE.Vector2(radius, y)),
      segments,
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  private addClassicPawn(group: THREE.Group, body: THREE.Material, trim: THREE.Material) {
    this.addClassicLathe(
      group,
      [
        [0.14, 0.26],
        [0.22, 0.33],
        [0.16, 0.42],
        [0.12, 0.56],
        [0.17, 0.63],
        [0.13, 0.69],
      ],
      body,
    );
    this.addTorus(group, 0.16, 0.018, 0.65, trim);
    this.addSphere(group, 0.18, 0.83, body, 1, 1.02, 1);
  }

  private addClassicRook(group: THREE.Group, body: THREE.Material, trim: THREE.Material) {
    this.addClassicLathe(
      group,
      [
        [0.15, 0.26],
        [0.23, 0.35],
        [0.18, 0.54],
        [0.2, 0.78],
        [0.28, 0.84],
        [0.25, 0.96],
      ],
      body,
    );
    this.addTorus(group, 0.22, 0.018, 0.79, trim);
    this.addTorus(group, 0.26, 0.02, 0.95, trim);
    for (let i = 0; i < 6; i += 1) {
      const angle = (i / 6) * Math.PI * 2;
      this.addRoundedBox(group, 0.12, 0.15, 0.13, Math.cos(angle) * 0.19, 1.04, Math.sin(angle) * 0.19, trim, 0.025, 0, -angle);
    }
  }

  private addClassicKnight(group: THREE.Group, body: THREE.Material, trim: THREE.Material, color: Color) {
    this.addClassicLathe(
      group,
      [
        [0.14, 0.26],
        [0.24, 0.36],
        [0.16, 0.54],
        [0.2, 0.68],
        [0.18, 0.84],
      ],
      body,
    );
    this.addTorus(group, 0.2, 0.018, 0.69, trim);
    this.addClassicKnightHead(group, body, trim, color);
  }

  private addClassicBishop(group: THREE.Group, body: THREE.Material, trim: THREE.Material, accent: THREE.Material) {
    this.addClassicLathe(
      group,
      [
        [0.14, 0.26],
        [0.24, 0.35],
        [0.16, 0.55],
        [0.2, 0.74],
        [0.17, 0.98],
        [0.09, 1.16],
      ],
      body,
    );
    this.addTorus(group, 0.2, 0.018, 0.75, trim);
    this.addSphere(group, 0.2, 1.06, body, 0.92, 1.18, 0.92);
    this.addRoundedBox(group, 0.045, 0.34, 0.045, 0, 1.08, -0.17, accent, 0.012, -0.58);
    this.addSphereAt(group, 0.055, 0, 1.32, 0, trim);
  }

  private addClassicQueen(group: THREE.Group, body: THREE.Material, trim: THREE.Material) {
    this.addClassicLathe(
      group,
      [
        [0.14, 0.26],
        [0.27, 0.36],
        [0.16, 0.62],
        [0.24, 0.86],
        [0.2, 1.12],
        [0.12, 1.34],
      ],
      body,
    );
    this.addTorus(group, 0.23, 0.02, 0.86, trim);
    this.addTorus(group, 0.2, 0.02, 1.18, trim);
    for (let i = 0; i < 8; i += 1) {
      const angle = (i / 8) * Math.PI * 2;
      const tall = i % 2 === 0;
      this.addSphereAt(group, tall ? 0.045 : 0.037, Math.cos(angle) * 0.16, tall ? 1.37 : 1.32, Math.sin(angle) * 0.16, trim);
    }
    this.addSphereAt(group, 0.065, 0, 1.42, 0, trim);
  }

  private addClassicKing(group: THREE.Group, body: THREE.Material, trim: THREE.Material) {
    this.addClassicLathe(
      group,
      [
        [0.15, 0.26],
        [0.28, 0.36],
        [0.18, 0.58],
        [0.15, 0.78],
        [0.25, 0.94],
        [0.22, 1.08],
        [0.17, 1.22],
        [0.11, 1.34],
      ],
      body,
    );
    this.addTorus(group, 0.24, 0.022, 0.92, trim);
    this.addTorus(group, 0.18, 0.018, 1.15, trim);
    this.addSphere(group, 0.18, 1.31, body, 0.92, 0.78, 0.92);
    this.addCylinder(group, 0.11, 0.15, 0.1, 1.38, trim);
    this.addCylinder(group, 0.055, 0.075, 0.17, 1.49, body);
    this.addSphereAt(group, 0.055, 0, 1.59, 0, trim);
    this.addRoundedBox(group, 0.08, 0.34, 0.06, 0, 1.73, 0, trim, 0.018);
    this.addRoundedBox(group, 0.28, 0.06, 0.052, 0, 1.79, 0, trim, 0.018);
  }

  private addClassicKnightHead(group: THREE.Group, body: THREE.Material, trim: THREE.Material, color: Color) {
    const headGroup = new THREE.Group();
    headGroup.position.set(-0.01, 0.02, 0);
    headGroup.scale.set(0.96, 0.95, 0.9);
    group.add(headGroup);

    this.addEllipsoidAtRotated(headGroup, 0.12, 0.31, 0.12, -0.15, 0.98, 0, body, 0, 0, -0.18);
    this.addEllipsoidAtRotated(headGroup, 0.13, 0.27, 0.12, -0.03, 1.15, 0, body, 0, 0, -0.52);
    this.addEllipsoidAtRotated(headGroup, 0.24, 0.13, 0.125, 0.25, 1.33, 0, body, 0, 0, -0.1);
    this.addEllipsoidAtRotated(headGroup, 0.24, 0.07, 0.082, 0.58, 1.2, 0, body, 0, 0, -0.1);
    this.addEllipsoidAtRotated(headGroup, 0.13, 0.055, 0.095, 0.35, 1.12, 0, body, 0, 0, -0.22);
    this.addEllipsoidAtRotated(headGroup, 0.055, 0.032, 0.055, 0.76, 1.18, 0, trim, 0, 0, -0.04);

    this.addClassicHorseMane(headGroup, trim);
    this.addConeAt(headGroup, 0.036, 0.2, 0.11, 1.53, 0.07, trim, -0.12, 0.08, 0.1, 8);
    this.addConeAt(headGroup, 0.032, 0.18, 0.23, 1.51, -0.06, trim, -0.3, -0.08, 0.08, 8);
    const eye = color === "w" ? this.classicBlackMaterial : this.classicWhiteTrimMaterial;
    this.addSphereAt(headGroup, 0.017, 0.35, 1.35, 0.112, eye);
    this.addSphereAt(headGroup, 0.017, 0.35, 1.35, -0.112, eye);
    this.addSphereAt(headGroup, 0.011, 0.78, 1.18, 0.044, eye);
    this.addSphereAt(headGroup, 0.011, 0.78, 1.18, -0.044, eye);
    [-0.125, 0.125].forEach((z) => {
      this.addRoundedBox(headGroup, 0.22, 0.016, 0.012, 0.56, 1.18, z, eye, 0.006, -0.08);
      this.addRoundedBox(headGroup, 0.13, 0.014, 0.012, 0.22, 1.23, z, eye, 0.006, -0.64);
      this.addRoundedBox(headGroup, 0.1, 0.014, 0.012, 0.08, 1.39, z, trim, 0.005, -0.48);
    });
  }

  private addClassicHorseMane(group: THREE.Group, trim: THREE.Material) {
    const tufts = [
      { x: -0.12, y: 1.32, rz: -0.48, h: 0.2 },
      { x: -0.17, y: 1.2, rz: -0.42, h: 0.19 },
      { x: -0.2, y: 1.08, rz: -0.32, h: 0.18 },
      { x: -0.21, y: 0.96, rz: -0.22, h: 0.16 },
    ];

    tufts.forEach((tuft) => {
      this.addRoundedBox(group, 0.07, tuft.h, 0.16, tuft.x, tuft.y, 0, trim, 0.018, tuft.rz);
    });
  }

  private createPiece(type: PieceSymbol, color: Color) {
    if (this.pieceStyle === "classic") {
      return this.createClassicPiece(type, color);
    }

    if (this.fullScaleMode) {
      const modelPiece = this.createModelPiece(type, color);
      if (modelPiece) {
        return modelPiece;
      }
    }

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

    if (this.fullScaleMode) {
      this.addBattleFigure(group, type, color, body, trim);
    } else {
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
    }

    return group;
  }

  private addBattleFigure(group: THREE.Group, type: PieceSymbol, color: Color, body: THREE.Material, trim: THREE.Material) {
    const cloth = color === "w" ? this.whiteClothMaterial : this.blackClothMaterial;
    const metal = color === "w" ? this.goldMaterial : this.steelMaterial;

    if (type === "p") {
      this.addInfantryFigure(group, color, body, cloth, metal, 0.86);
      return;
    }

    if (type === "n") {
      this.addMountedKnightFigure(group, color, body, cloth, metal);
      return;
    }

    if (type === "r") {
      this.addSiegeTowerFigure(group, color, body, cloth, metal);
      return;
    }

    if (type === "b") {
      this.addBishopFigure(group, color, body, cloth, metal);
      return;
    }

    if (type === "q") {
      this.addRoyalFigure(group, color, body, cloth, metal, true);
      return;
    }

    this.addRoyalFigure(group, color, body, cloth, metal, false);
  }

  private addInfantryFigure(
    group: THREE.Group,
    color: Color,
    body: THREE.Material,
    cloth: THREE.Material,
    metal: THREE.Material,
    height = 1,
  ) {
    const forward = color === "w" ? -1 : 1;
    const y = 0.58;
    this.addCylinderAt(group, 0.035, 0.04, 0.28 * height, -0.055, y, 0.02, body, 0, 0, 0, 10);
    this.addCylinderAt(group, 0.035, 0.04, 0.28 * height, 0.055, y, 0.02, body, 0, 0, 0, 10);
    this.addEllipsoidAt(group, 0.12, 0.18 * height, 0.085, 0, y + 0.2 * height, 0, cloth);
    this.addSphereAt(group, 0.075 * height, 0, y + 0.43 * height, 0, body);
    this.addConeAt(group, 0.09, 0.13, 0, y + 0.51 * height, 0, metal, 0, 0, 0, 12);
    this.addCylinderAt(group, 0.018, 0.018, 0.72 * height, 0.18, y + 0.26 * height, forward * 0.08, metal, Math.PI / 2.8, 0, 0, 8);
    this.addConeAt(group, 0.045, 0.14, 0.18, y + 0.58 * height, forward * 0.36, metal, Math.PI / 2, 0, 0, 8);
    this.addRoundedBox(group, 0.18, 0.24 * height, 0.055, -0.17, y + 0.24 * height, forward * 0.08, metal, 0.03, 0, 0.18 * forward);
  }

  private addMountedKnightFigure(
    group: THREE.Group,
    color: Color,
    body: THREE.Material,
    cloth: THREE.Material,
    metal: THREE.Material,
  ) {
    const forward = color === "w" ? -1 : 1;
    const horseMaterial = color === "w" ? this.leatherMaterial : body;
    this.addEllipsoidAt(group, 0.22, 0.15, 0.38, 0, 0.78, 0, horseMaterial);
    [-0.12, 0.12].forEach((x) => {
      [-0.22, 0.22].forEach((z, legIndex) => {
        this.addCylinderAt(group, 0.026, 0.034, 0.45, x, 0.5, z, horseMaterial, legIndex % 2 ? 0.13 : -0.13, 0, 0, 8);
      });
    });
    this.addCylinderAt(group, 0.07, 0.09, 0.32, 0, 0.91, forward * 0.34, horseMaterial, forward * 0.72, 0, 0, 12);
    this.addEllipsoidAt(group, 0.11, 0.08, 0.15, 0, 1.06, forward * 0.52, horseMaterial);
    this.addConeAt(group, 0.042, 0.16, -0.06, 1.13, forward * 0.55, metal, forward * 0.5, 0, 0, 6);
    this.addConeAt(group, 0.042, 0.16, 0.06, 1.13, forward * 0.55, metal, forward * 0.5, 0, 0, 6);
    this.addRoundedBox(group, 0.32, 0.055, 0.32, 0, 0.96, -forward * 0.05, cloth, 0.025);
    this.addHumanoid(group, color, body, cloth, metal, 0, 0.92, -forward * 0.04, 0.86);
    this.addCape(group, color, 0, 1.22, -forward * 0.22, 0.36, 0.54, cloth);
    this.addCylinderAt(group, 0.018, 0.018, 1.1, 0.25, 1.28, forward * 0.14, metal, Math.PI / 2.25, 0, -0.08, 8);
    this.addConeAt(group, 0.05, 0.18, 0.25, 1.6, forward * 0.62, metal, Math.PI / 2, 0, 0, 8);
  }

  private addSiegeTowerFigure(
    group: THREE.Group,
    color: Color,
    body: THREE.Material,
    cloth: THREE.Material,
    metal: THREE.Material,
  ) {
    const forward = color === "w" ? -1 : 1;
    this.addRoundedBox(group, 0.45, 0.55, 0.45, 0, 0.78, 0, body, 0.05);
    this.addRoundedBox(group, 0.55, 0.13, 0.55, 0, 1.11, 0, metal, 0.035);
    for (let i = 0; i < 4; i += 1) {
      const angle = Math.PI / 4 + (i * Math.PI) / 2;
      this.addRoundedBox(group, 0.12, 0.13, 0.12, Math.cos(angle) * 0.2, 1.25, Math.sin(angle) * 0.2, metal, 0.025);
    }
    this.addCylinderAt(group, 0.025, 0.025, 0.78, 0.22, 1.18, forward * 0.2, metal, 0, 0, 0, 8);
    this.addBanner(group, color, 0.22, 1.52, forward * 0.2, 0.22, 0.32, cloth);
  }

  private addBishopFigure(
    group: THREE.Group,
    color: Color,
    body: THREE.Material,
    cloth: THREE.Material,
    metal: THREE.Material,
  ) {
    const forward = color === "w" ? -1 : 1;
    this.addCone(group, 0.26, 0.62, 0.82, cloth, 20);
    this.addSphere(group, 0.13, 1.14, body, 0.9, 1.05, 0.9);
    this.addConeAt(group, 0.14, 0.22, 0, 1.28, 0, cloth, 0, 0, 0, 20);
    this.addCylinderAt(group, 0.018, 0.018, 0.88, 0.2, 0.98, forward * 0.08, metal, 0.12, 0, 0, 8);
    this.addSphereAt(group, 0.07, 0.2, 1.43, forward * 0.08, metal);
    this.addCape(group, color, 0, 0.98, -forward * 0.13, 0.34, 0.56, cloth);
  }

  private addRoyalFigure(
    group: THREE.Group,
    color: Color,
    body: THREE.Material,
    cloth: THREE.Material,
    metal: THREE.Material,
    queen: boolean,
  ) {
    const forward = color === "w" ? -1 : 1;
    this.addHumanoid(group, color, body, cloth, metal, 0, 0.64, 0, queen ? 1.12 : 1.06);
    this.addCape(group, color, 0, 0.98, -forward * 0.16, queen ? 0.5 : 0.42, queen ? 0.72 : 0.64, cloth);
    const crownY = queen ? 1.28 : 1.23;
    this.addTorus(group, queen ? 0.12 : 0.105, 0.015, crownY, metal);
    const spikes = queen ? 6 : 4;
    for (let i = 0; i < spikes; i += 1) {
      const angle = (i / spikes) * Math.PI * 2;
      this.addConeAt(group, 0.03, queen ? 0.14 : 0.11, Math.cos(angle) * 0.11, crownY + 0.08, Math.sin(angle) * 0.11, metal, 0, 0, 0, 6);
    }
    if (queen) {
      this.addBanner(group, color, -0.22, 1.23, forward * 0.08, 0.24, 0.36, cloth);
    } else {
      this.addRoundedBox(group, 0.07, 0.4, 0.045, 0.24, 1.02, forward * 0.08, metal, 0.018, -0.4);
      this.addRoundedBox(group, 0.2, 0.055, 0.04, 0.24, 1.2, forward * 0.08, metal, 0.018, -0.4);
    }
  }

  private addHumanoid(
    group: THREE.Group,
    color: Color,
    body: THREE.Material,
    cloth: THREE.Material,
    metal: THREE.Material,
    x: number,
    y: number,
    z: number,
    scale: number,
  ) {
    const forward = color === "w" ? -1 : 1;
    this.addCylinderAt(group, 0.035 * scale, 0.04 * scale, 0.26 * scale, x - 0.045 * scale, y, z, body, 0, 0, 0, 10);
    this.addCylinderAt(group, 0.035 * scale, 0.04 * scale, 0.26 * scale, x + 0.045 * scale, y, z, body, 0, 0, 0, 10);
    this.addEllipsoidAt(group, 0.11 * scale, 0.17 * scale, 0.08 * scale, x, y + 0.2 * scale, z, cloth);
    this.addCylinderAt(group, 0.024 * scale, 0.025 * scale, 0.28 * scale, x - 0.13 * scale, y + 0.22 * scale, z + forward * 0.04, body, 0.45 * forward, 0, 0.35, 8);
    this.addCylinderAt(group, 0.024 * scale, 0.025 * scale, 0.28 * scale, x + 0.13 * scale, y + 0.22 * scale, z + forward * 0.04, body, 0.45 * forward, 0, -0.35, 8);
    this.addSphereAt(group, 0.072 * scale, x, y + 0.43 * scale, z, body);
    this.addConeAt(group, 0.087 * scale, 0.12 * scale, x, y + 0.5 * scale, z, metal, 0, 0, 0, 12);
  }

  private addCape(
    group: THREE.Group,
    color: Color,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    material: THREE.Material,
  ) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 3), material);
    mesh.position.set(x, y - height * 0.18, z);
    mesh.rotation.x = 0.06 * (color === "w" ? -1 : 1);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cape = { baseRotationZ: mesh.rotation.z, phase: Math.random() * Math.PI * 2 };
    group.add(mesh);
  }

  private addBanner(
    group: THREE.Group,
    color: Color,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    material: THREE.Material,
  ) {
    const forward = color === "w" ? -1 : 1;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 2), material);
    mesh.position.set(x, y - height * 0.32, z + forward * 0.03);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.banner = { baseRotationY: mesh.rotation.y, phase: Math.random() * Math.PI * 2 };
    group.add(mesh);
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

  private addCylinderAt(
    group: THREE.Group,
    radiusTop: number,
    radiusBottom: number,
    height: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
    radialSegments = 16,
  ) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSegments), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotationX, rotationY, rotationZ);
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

  private addEllipsoidAtRotated(
    group: THREE.Group,
    radiusX: number,
    radiusY: number,
    radiusZ: number,
    x: number,
    y: number,
    z: number,
    material: THREE.Material,
    rotationX = 0,
    rotationY = 0,
    rotationZ = 0,
  ) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 16), material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotationX, rotationY, rotationZ);
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
      this.setHoverSquare(null);
    });
    this.renderer.domElement.addEventListener("pointerleave", () => {
      this.boardPointerStart = null;
      this.setHoverSquare(null);
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

    this.pieceStyleBtn.addEventListener("click", () => {
      this.togglePieceStyle();
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
      this.setHoverSquare(null);
      return;
    }

    if (this.cameraControls && this.boardPointerStart) {
      const dragDistance = Math.hypot(event.clientX - this.boardPointerStart.x, event.clientY - this.boardPointerStart.y);
      if (dragDistance > 5) {
        this.boardPointerStart.moved = true;
      }
    }

    const square = this.pickSquare(event);
    const hoverSquare = this.boardPointerStart?.moved ? null : square;
    this.setHoverSquare(hoverSquare);
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

  private setHoverSquare(square: Square | null) {
    if (this.hoverSquare === square) {
      return;
    }

    this.hoverSquare = square;
    this.sendHoverToServer(square);
  }

  private ownHoverSquare(square: Square | null) {
    if (!square || (this.role !== "w" && this.role !== "b")) {
      return null;
    }
    const piece = this.game.get(square);
    return piece?.color === this.role ? square : null;
  }

  private sendHoverToServer(square: Square | null) {
    if (!this.serverExpected || !this.online) {
      this.lastSentHoverSquare = null;
      return;
    }

    const outgoingSquare = this.ownHoverSquare(square);
    if (outgoingSquare === this.lastSentHoverSquare) {
      return;
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      this.lastSentHoverSquare = null;
      return;
    }

    this.lastSentHoverSquare = outgoingSquare;
    this.socket.send(JSON.stringify({ type: "hover", square: outgoingSquare, clientKey: this.clientKey }));
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
      this.flashStatus(this.boardBlockedMessage(), "warning");
      return;
    }

    if (!this.canInteractWithBoard()) {
      this.flashStatus(this.role === "spectator" ? "Только просмотр" : "Сначала войдите", "warning");
      return;
    }

    if (this.online && this.role !== turn) {
      this.flashStatus(this.visibleTurnStatus(turn), "warning");
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
        this.flashStatus(this.visibleTurnStatus(turn), "warning");
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
    if (this.serverExpected) {
      return this.online && !this.awaitingMoveAck && (this.role === "w" || this.role === "b");
    }
    return !this.online || this.role === "w" || this.role === "b";
  }

  private boardBlockedMessage() {
    if (this.serverExpected && !this.online) {
      return "Ждем соединение с сервером";
    }
    if (this.awaitingMoveAck) {
      return "Ждем подтверждения хода сервером";
    }
    if (this.role === "spectator") {
      return "Только просмотр";
    }
    return "Сначала войдите";
  }

  private commitMove(from: Square, to: Square, promotion?: PromotionPiece) {
    this.setHoverSquare(null);
    if (this.serverExpected) {
      if (this.awaitingMoveAck) {
        this.flashStatus("Ждем подтверждения хода сервером", "warning");
        return;
      }
      const sent = this.sendToServer({ type: "move", from, to, promotion });
      if (!sent) {
        return;
      }
      this.awaitingMoveAck = true;
      this.selectedSquare = null;
      this.legalTargets = [];
      this.pendingPromotion = null;
      this.hidePromotionDialog();
      this.updateHighlights();
      this.updateControls();
      this.flashStatus("Ход отправлен на сервер", "warning");
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
    if (!this.serverExpected) {
      return;
    }
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.serverConnection = this.online ? "online" : this.serverConnection === "offline" ? "connecting" : "reconnecting";
    this.updateControls();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/game`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) {
        return;
      }
      this.online = true;
      this.serverConnection = "online";
      this.reconnectDelayMs = 1000;
      if (this.reconnectTimer) {
        window.clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.sendToServer({ type: "hello", clientKey: this.clientKey, leaderboard: this.leaderboard });
      this.updateControls();
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) {
        return;
      }
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return;
      }

      if (message.type === "error") {
        this.awaitingMoveAck = false;
        this.flashStatus(message.message, "warning");
        this.updateControls();
        return;
      }

      if (message.type === "state") {
        this.awaitingMoveAck = false;
        this.applyServerState(message);
        return;
      }

      if (message.type === "hover") {
        this.applyRemoteHover(message);
      }
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }
      this.online = false;
      this.awaitingMoveAck = false;
      this.hoverSquare = null;
      this.remoteHoverSquare = null;
      this.remoteHoverBy = null;
      this.remoteHoverExpiresAt = 0;
      this.lastSentHoverSquare = null;
      this.role = null;
      this.serverConnection = "reconnecting";
      this.socket = null;
      this.roleBadge.textContent = "Оффлайн";
      this.updateControls();
      this.scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      if (this.socket === socket) {
        this.serverConnection = "reconnecting";
        this.updateControls();
      }
    });
  }

  private scheduleReconnect() {
    if (!this.serverExpected || this.reconnectTimer) {
      return;
    }

    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(8000, this.reconnectDelayMs * 1.5);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectToServer();
    }, delay);
  }

  private sendToServer(payload: Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      if (this.serverExpected) {
        this.online = false;
        this.serverConnection = "reconnecting";
        this.scheduleReconnect();
      }
      this.flashStatus("Связь еще не готова", "warning");
      this.updateControls();
      return false;
    }
    this.socket.send(JSON.stringify({ ...payload, clientKey: this.clientKey }));
    return true;
  }

  private applyRemoteHover(message: ServerHoverMessage) {
    if (message.by === this.role) {
      return;
    }

    this.remoteHoverBy = message.by;
    this.remoteHoverSquare = message.square;
    this.remoteHoverExpiresAt = message.square ? performance.now() + 3500 : 0;
  }

  private applyServerState(state: ServerStateMessage) {
    this.online = true;
    this.serverConnection = "online";
    this.stateRevision = state.stateRevision ?? this.stateRevision;
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
    this.remoteHoverSquare = null;
    this.remoteHoverBy = null;
    this.remoteHoverExpiresAt = 0;
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
    const canPlay = this.serverExpected
      ? this.online && (this.role === "w" || this.role === "b")
      : !this.online || this.role === "w" || this.role === "b";
    document.querySelector<HTMLButtonElement>("#newGameBtn")!.disabled =
      !canPlay || this.awaitingMoveAck || !this.game.isGameOver();

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
    if (this.serverExpected && !this.online) {
      this.roleBadge.textContent = this.serverConnection === "connecting" ? "Подключение" : "Связь";
    } else if (this.awaitingMoveAck) {
      this.roleBadge.textContent = "Сервер";
    }
    this.roleBadge.title =
      this.role === "w" || this.role === "b" ? "Изменить имя игрока" : "Войти в партию";
    const activeTurn = this.game.turn();
    const myTurn = this.online && (this.role === "w" || this.role === "b") && this.role === activeTurn && !this.game.isGameOver();
    const theirTurn =
      this.online && (this.role === "w" || this.role === "b") && this.role !== activeTurn && !this.game.isGameOver();
    this.turnCluster.classList.toggle("my-turn", myTurn && !this.awaitingMoveAck);
    this.turnCluster.classList.toggle("their-turn", theirTurn);
    this.turnCluster.classList.toggle("waiting-server", this.serverExpected && (!this.online || this.awaitingMoveAck));
    document.body.classList.toggle("my-turn-active", myTurn && !this.awaitingMoveAck);
    this.updateLeaderboardSyncLabel();
    this.updateSoundButton();
  }

  private updateSoundButton() {
    this.soundBtn.textContent = this.sound.enabled ? "Звук" : "Тихо";
    this.soundBtn.classList.toggle("muted", !this.sound.enabled);
    this.soundBtn.setAttribute("aria-pressed", String(this.sound.enabled));
    this.soundBtn.title = this.sound.enabled ? "Выключить звук" : "Включить звук";
  }

  private loadPieceStyle(): PieceStyle {
    return window.localStorage.getItem(pieceStyleStorageKey) === "classic" ? "classic" : "fantasy";
  }

  private togglePieceStyle() {
    this.pieceStyle = this.pieceStyle === "fantasy" ? "classic" : "fantasy";
    window.localStorage.setItem(pieceStyleStorageKey, this.pieceStyle);
    this.updatePieceStyleButton();
    if (this.pieceStyle === "classic") {
      void this.loadClassicPieceAssets();
    }
    this.rebuildPieces();
    this.rebuildDecorativeStatues();
    this.renderCaptures(this.serverHistory ?? (this.game.history({ verbose: true }) as Move[]));
  }

  private updatePieceStyleButton() {
    const classic = this.pieceStyle === "classic";
    this.pieceStyleBtn.textContent = classic ? "Классика" : "Фэнтези";
    this.pieceStyleBtn.title = classic ? "Сменить на фэнтези-фигуры" : "Сменить на классические фигуры";
    this.pieceStyleBtn.setAttribute("aria-pressed", String(classic));
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
    if (this.serverExpected && !this.online) {
      this.statusText.textContent =
        this.serverConnection === "connecting" ? "Подключение к серверу..." : "Связь потеряна. Переподключение...";
      this.statusText.classList.add("warning");
    } else if (this.awaitingMoveAck) {
      this.statusText.textContent = "Сохраняем ход на сервере...";
      this.statusText.classList.add("warning");
    } else if (this.game.isCheckmate()) {
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
      this.statusText.textContent = this.visibleTurnStatus(turn, " - шах");
      this.statusText.classList.add("warning");
    } else {
      this.statusText.textContent = this.visibleTurnStatus(turn);
      const tone = this.turnTone(turn);
      if (tone) {
        this.statusText.classList.add(tone);
      }
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
      .replace(/^B/, "Сл")
      .replace(/^N/, "К")
      .replace(/=Q/g, "=Ф")
      .replace(/=R/g, "=Л")
      .replace(/=B/g, "=Сл")
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
      group.scale.multiplyScalar(this.fullScaleMode ? 0.36 : 0.42);
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
    const clampedColumn = Math.min(column, 1);
    const overflow = Math.max(0, column - 1);
    const x = side * (5.36 + clampedColumn * 0.78 + overflow * 0.24);
    const z = 3.2 - row * 0.9 - overflow * 0.04;
    return new THREE.Vector3(x, 0.18, z);
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

  private visibleTurnStatus(color: Color, suffix = "") {
    const name = this.playerName(color);
    if (this.isWaitingSeatName(name)) {
      return `${name}${suffix}`;
    }
    if (this.online && this.role === color) {
      return `ВАШ ХОД: ${name}${suffix}`;
    }
    if (this.online && (this.role === "w" || this.role === "b")) {
      return `Ход соперника: ${name}${suffix}`;
    }
    if (this.online && this.role === "spectator") {
      return `Сейчас ходит: ${name}${suffix}`;
    }
    return `Ход: ${name}${suffix}`;
  }

  private turnTone(color: Color) {
    if (!this.online || this.game.isGameOver()) {
      return "";
    }
    if (this.role === color) {
      return "my-turn";
    }
    if (this.role === "w" || this.role === "b") {
      return "their-turn";
    }
    return "";
  }

  private flashStatus(message: string, tone: "warning" | "danger") {
    if (this.statusFlashTimer) {
      window.clearTimeout(this.statusFlashTimer);
    }
    this.statusText.textContent = message;
    this.statusText.className = `status-text ${tone}`;
    if (tone === "danger") {
      this.sound.play("illegal");
    }
    this.statusFlashTimer = window.setTimeout(() => {
      this.statusFlashTimer = null;
      this.updateHud();
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
          if (!object.userData.keepGeometry) {
            object.geometry.dispose();
          }
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
      if (maybeWithMap.map && !maybeWithMap.map.userData.sharedModelTexture) {
        maybeWithMap.map.dispose();
      }
      item.dispose();
    });
  }

  private isSharedMaterial(material: THREE.Material) {
    return (
      material === this.whitePieceMaterial ||
      material === this.whiteTrimMaterial ||
      material === this.blackPieceMaterial ||
      material === this.blackTrimMaterial ||
      material === this.whiteClothMaterial ||
      material === this.blackClothMaterial ||
      material === this.classicWhiteMaterial ||
      material === this.classicWhiteTrimMaterial ||
      material === this.classicBlackMaterial ||
      material === this.classicBlackTrimMaterial ||
      material === this.feltMaterial ||
      material === this.leatherMaterial ||
      material === this.goldMaterial ||
      material === this.steelMaterial ||
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
      pieceStyle: this.pieceStyle,
      trophyCount: this.trophyGroup.children.length,
      score: { ...this.sessionScore },
      leaderboard: this.leaderboard,
      online: this.online,
      serverExpected: this.serverExpected,
      serverConnection: this.serverConnection,
      awaitingMoveAck: this.awaitingMoveAck,
      stateRevision: this.stateRevision,
      role: this.role,
      hoverSquare: this.hoverSquare,
      lastSentHoverSquare: this.lastSentHoverSquare,
      selectedSquare: this.selectedSquare,
      remoteHoverSquare: this.remoteHoverSquare,
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

  private animateBattleDetails(elapsed: number) {
    const animateObject = (object: THREE.Object3D) => {
      const cape = object.userData.cape as { baseRotationZ: number; phase: number } | undefined;
      if (cape) {
        object.rotation.z = cape.baseRotationZ + Math.sin(elapsed * 2.8 + cape.phase) * 0.045;
      }
      const banner = object.userData.banner as { baseRotationY: number; phase: number } | undefined;
      if (banner) {
        object.rotation.y = banner.baseRotationY + Math.sin(elapsed * 3.4 + banner.phase) * 0.08;
      }
    };

    this.pieceGroup.traverse(animateObject);
    this.trophyGroup.traverse(animateObject);
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

    if (this.remoteHoverSquare && now > this.remoteHoverExpiresAt) {
      this.remoteHoverSquare = null;
      this.remoteHoverBy = null;
      this.remoteHoverExpiresAt = 0;
    }

    this.pieceGroup.children.forEach((piece) => {
      if (this.animateMotion(piece, now)) {
        return;
      }
      const square = piece.userData.square as Square | undefined;
      if (square && (square === this.hoverSquare || square === this.remoteHoverSquare)) {
        piece.position.y += (0.16 - piece.position.y) * 0.18;
      } else {
        piece.position.y += (squareTopY - piece.position.y) * 0.18;
      }
    });
    this.trophyGroup.children.forEach((piece) => {
      this.animateMotion(piece, now);
    });
    this.animateBattleDetails(elapsed);
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

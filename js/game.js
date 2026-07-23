// ツミボシ — 3D Block Blast
// three.js シーン構築・タッチ操作・演出・UIフロー

import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GRID_N as N, PLANE_COLORS, SCORE, STORAGE_PREFIX } from "./config.js";
import { generatePiece } from "./shapes.js";
import { Board } from "./board.js";
import { initAudio, setMuted, sfx } from "./audio.js";
import {
  isOnlineEnabled, submitWorldScore, fetchWorldRanks,
  getLocalRanks, addLocalRank,
} from "./ranking.js";

// ---------------------------------------------------------------- 定数

const OFF = (N - 1) / 2;               // グリッド中心合わせオフセット
const CUBE = 0.92;                     // ブロックの一辺 (1マス=1.0)
const TARGET = new THREE.Vector3(0, N * 0.42, 0);
const LIFT_PX = 64;                    // 指よりこれだけ上をポイントする
const store = {
  get: (k, d) => localStorage.getItem(STORAGE_PREFIX + k) ?? d,
  set: (k, v) => { try { localStorage.setItem(STORAGE_PREFIX + k, v); } catch {} },
};

// ---------------------------------------------------------------- 状態

let state = "title";                   // title | play | over
const board = new Board(N);
const hand = [null, null, null];       // 手持ち3ピース
let score = 0;
let best = Number(store.get("best", 0)) || 0;
let combo = 0;                         // 連続クリア数
let submitted = false;

// カメラ軌道 (目標値へ毎フレーム減衰追従)
const cam = {
  az: -0.65, pol: 1.05, r: N * 3.4,
  tAz: -0.65, tPol: 1.05, tR: N * 3.4,
};
const POL_MIN = 0.32, POL_MAX = 1.42;
const R_MIN = N * 2.0, R_MAX = N * 6.0;

// 入力
const pointers = new Map();            // pointerId -> {x, y}
let orbit = null;                      // {id, lastX, lastY}
let pinch = null;                      // {ids:[a,b], dist, r}
let held = null;                       // ドラッグ中ピース

// ---------------------------------------------------------------- DOM

const $ = (id) => document.getElementById(id);
const canvas = $("gl");
const trayCards = [...document.querySelectorAll(".tray-card")];
const trayRects = [null, null, null];  // CSSピクセルのスロット矩形
let trayTopY = Infinity;

// ---------------------------------------------------------------- three.js 基盤

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.autoClear = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);

const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
scene.environment = envTex;

scene.add(new THREE.AmbientLight(0xffffff, 0.62));
const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
keyLight.position.set(6, 12, 4);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
keyLight.shadow.camera.left = keyLight.shadow.camera.bottom = -N * 1.6;
keyLight.shadow.camera.right = keyLight.shadow.camera.top = N * 1.6;
keyLight.shadow.camera.far = 40;
keyLight.shadow.bias = -0.002;
scene.add(keyLight);
// ネオンのリムライト2灯 (シアン & マゼンタ) でキャンディをギラつかせる
const rimCyan = new THREE.DirectionalLight(0x18e0ff, 1.4);
rimCyan.position.set(-8, 4, -6);
scene.add(rimCyan);
const rimPink = new THREE.DirectionalLight(0xff2e88, 1.2);
rimPink.position.set(7, 2, -7);
scene.add(rimPink);

const blocksGroup = new THREE.Group();
const fxGroup = new THREE.Group();
scene.add(blocksGroup, fxGroup);

// ---------------------------------------------------------------- 素材

const cubeGeo = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
const cubeEdgeGeo = new THREE.EdgesGeometry(cubeGeo);

function makeBlockMaterial(plane) {
  const c = PLANE_COLORS[plane];
  return new THREE.MeshStandardMaterial({
    color: c.base,
    emissive: c.emissive,
    emissiveIntensity: 0.85,
    roughness: 0.16,
    metalness: 0.0,
    envMapIntensity: 1.2,
  });
}

/** 1ブロック (立方体+発光エッジ) */
function makeCube(plane) {
  const mesh = new THREE.Mesh(cubeGeo, makeBlockMaterial(plane));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const edges = new THREE.LineSegments(
    cubeEdgeGeo,
    new THREE.LineBasicMaterial({
      color: PLANE_COLORS[plane].edge,
      transparent: true,
      opacity: 0.7,
    })
  );
  mesh.add(edges);
  return mesh;
}

/** ピース全体のグループ。ghost=true で半透明の仮置き表示 */
function makePieceGroup(piece, ghost = false) {
  const g = new THREE.Group();
  for (const [dx, dy, dz] of piece.cells) {
    let m;
    if (ghost) {
      m = new THREE.Mesh(
        cubeGeo,
        new THREE.MeshBasicMaterial({
          color: 0xcfe2ff, transparent: true, opacity: 0.22, depthWrite: false,
        })
      );
      const e = new THREE.LineSegments(
        cubeEdgeGeo,
        new THREE.LineBasicMaterial({ color: 0xdfe9ff, transparent: true, opacity: 0.8 })
      );
      m.add(e);
    } else {
      m = makeCube(piece.plane);
    }
    m.position.set(dx, dy, dz);
    g.add(m);
  }
  return g;
}

function pieceCentroid(piece) {
  const c = new THREE.Vector3();
  for (const [dx, dy, dz] of piece.cells) c.add(new THREE.Vector3(dx, dy, dz));
  return c.divideScalar(piece.cells.length);
}

function cellWorld(x, y, z, out = new THREE.Vector3()) {
  return out.set(x - OFF, y + 0.5, z - OFF);
}

// ---------------------------------------------------------------- 舞台装置

let floorPlate;
{
  // 床プレート
  const plateGeo = new THREE.BoxGeometry(N + 0.7, 0.18, N + 0.7);
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0x1c0b48, roughness: 0.42, metalness: 0.5, envMapIntensity: 0.9,
  });
  floorPlate = new THREE.Mesh(plateGeo, plateMat);
  floorPlate.position.y = -0.09;
  floorPlate.receiveShadow = true;
  scene.add(floorPlate);

  // 床グリッド線
  const pts = [];
  for (let i = 0; i <= N; i++) {
    pts.push(i - OFF - 0.5, 0.005, -OFF - 0.5, i - OFF - 0.5, 0.005, N - OFF - 0.5);
    pts.push(-OFF - 0.5, 0.005, i - OFF - 0.5, N - OFF - 0.5, 0.005, i - OFF - 0.5);
  }
  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(
    gridGeo,
    new THREE.LineBasicMaterial({ color: 0x8b5bff, transparent: true, opacity: 0.55 })
  ));

  // 外枠ケージ
  const s = N / 2;
  const cage = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(N, N, N)),
    new THREE.LineBasicMaterial({ color: 0xa878ff, transparent: true, opacity: 0.55 })
  );
  cage.position.y = s;
  scene.add(cage);

  // 格子の頂点に小さな光点
  const dotPts = [];
  for (let x = 0; x <= N; x++)
    for (let y = 0; y <= N; y++)
      for (let z = 0; z <= N; z++)
        dotPts.push(x - OFF - 0.5, y, z - OFF - 0.5);
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(dotPts, 3));
  scene.add(new THREE.Points(
    dotGeo,
    new THREE.PointsMaterial({
      color: 0xffffff, size: 0.05, transparent: true, opacity: 0.6,
    })
  ));

  // 床下のグロー
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 256;
  const gctx = glowCanvas.getContext("2d");
  const grad = gctx.createRadialGradient(128, 128, 8, 128, 128, 128);
  grad.addColorStop(0, "rgba(190,90,255,0.6)");
  grad.addColorStop(0.5, "rgba(255,60,150,0.2)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  gctx.fillStyle = grad;
  gctx.fillRect(0, 0, 256, 256);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(N * 3.1, N * 3.1),
    new THREE.MeshBasicMaterial({
      map: glowTex, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -0.22;
  scene.add(glow);
}

// 星空 (2層でゆっくり逆回転)
const starLayers = [];
for (let layer = 0; layer < 2; layer++) {
  const count = 260;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 34 + Math.random() * 55;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.7 + 6;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    color: layer ? 0x9fb4ff : 0xffffff,
    size: layer ? 0.32 : 0.2,
    transparent: true,
    opacity: layer ? 0.5 : 0.8,
    sizeAttenuation: true,
  }));
  scene.add(stars);
  starLayers.push(stars);
}

// ---------------------------------------------------------------- 盤面メッシュ管理

const blockMeshes = new Map();         // board idx -> mesh

function addBlockMesh(x, y, z, plane, delay = 0) {
  const mesh = makeCube(plane);
  cellWorld(x, y, z, mesh.position);
  mesh.scale.setScalar(0.01);
  blocksGroup.add(mesh);
  blockMeshes.set(board.idx(x, y, z), mesh);
  anims.push(popIn(mesh, delay));
}

function popIn(mesh, delay) {
  let t = -delay;
  return (dt) => {
    t += dt;
    if (t < 0) return true;
    const k = Math.min(t / 0.22, 1);
    const s = 1 + 0.35 * Math.sin(k * Math.PI) - 0.99 * (1 - k) * (1 - k);
    mesh.scale.setScalar(Math.max(0.01, s));
    if (k >= 1) { mesh.scale.setScalar(1); return false; }
    return true;
  };
}

// ---------------------------------------------------------------- トレイ (ネクスト3枠)

// メインカメラと同じ向きで回る正射影ミニシーン。1マスの見かけサイズを全枠で統一
const trayScenes = [];
const TRAY_HALF = 2.55;
const trayCam = new THREE.OrthographicCamera(-TRAY_HALF, TRAY_HALF, TRAY_HALF, -TRAY_HALF, 0.1, 40);

for (let i = 0; i < 3; i++) {
  const s = new THREE.Scene();
  s.environment = envTex;
  const amb = new THREE.AmbientLight(0x9aa2d8, 0.7);
  const dir = new THREE.DirectionalLight(0xfff4e0, 1.6);
  dir.position.set(4, 8, 3);
  s.add(amb, dir);
  trayScenes.push({ scene: s, group: null });
}

function setTrayPiece(slot, piece) {
  const ts = trayScenes[slot];
  if (ts.group) { ts.scene.remove(ts.group); disposeGroup(ts.group); ts.group = null; }
  trayCards[slot].classList.toggle("empty", !piece);
  if (!piece) return;
  const g = makePieceGroup(piece);
  const c = pieceCentroid(piece);
  g.position.set(-c.x, -c.y, -c.z);
  const wrap = new THREE.Group();
  wrap.add(g);
  ts.scene.add(wrap);
  ts.group = wrap;
}

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.material && !o.geometry?.shared) o.material.dispose?.();
  });
}

function layoutTray() {
  const w = innerWidth, h = innerHeight;
  const gap = 12;
  const total = Math.min(w - 28, 420);
  const size = Math.min((total - gap * 2) / 3, 128);
  const x0 = (w - (size * 3 + gap * 2)) / 2;
  const y = h - size - 16 - envSafeBottom();
  for (let i = 0; i < 3; i++) {
    const x = x0 + i * (size + gap);
    const card = trayCards[i];
    card.style.left = x + "px";
    card.style.top = y + "px";
    card.style.width = size + "px";
    card.style.height = size + "px";
    trayRects[i] = { x, y, w: size, h: size };
  }
  trayTopY = y - 12;
  const label = $("trayLabel");
  label.style.top = (y - 20) + "px";
}

function envSafeBottom() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;bottom:0;height:env(safe-area-inset-bottom,0px)";
  document.body.appendChild(probe);
  const v = probe.getBoundingClientRect().height;
  probe.remove();
  return v;
}

function slotAtPoint(x, y) {
  for (let i = 0; i < 3; i++) {
    const r = trayRects[i];
    if (r && x >= r.x - 6 && x <= r.x + r.w + 6 && y >= r.y - 6 && y <= r.y + r.h + 6)
      return i;
  }
  return null;
}

// ---------------------------------------------------------------- 手持ちピース

function refillHand() {
  for (let i = 0; i < 3; i++) {
    hand[i] = generatePiece(N);
    setTrayPiece(i, hand[i]);
  }
}

function handEmpty() {
  return hand.every((p) => !p);
}

// ---------------------------------------------------------------- ドラッグ&スナップ

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function setRayFromClient(cx, cy) {
  ndc.set((cx / innerWidth) * 2 - 1, -((cy - LIFT_PX) / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
}

function pickUp(slot, e) {
  const piece = hand[slot];
  if (!piece) return;
  const placements = board.allPlacements(piece.cells);
  held = {
    slot,
    piece,
    pointerId: e.pointerId,
    placements,
    snapped: null,          // [x,y,z] | null
    wouldClear: [],
    litMeshes: [],
    group: makePieceGroup(piece),
    ghost: makePieceGroup(piece, true),
    centroid: pieceCentroid(piece),
    pos: new THREE.Vector3(),
    posTarget: new THREE.Vector3(),
    hasPos: false,
    overTray: false,
    radius: 0,
  };
  for (const [dx, dy, dz] of piece.cells) {
    held.radius = Math.max(held.radius, held.centroid.distanceTo(new THREE.Vector3(dx, dy, dz)));
  }
  held.group.traverse((o) => {
    if (o.material) { o.material.transparent = true; o.material.opacity = 0.92; }
  });
  held.ghost.visible = false;
  scene.add(held.group, held.ghost);
  setTrayPiece(slot, null);
  trayCards[slot].classList.remove("empty");
  sfx.pick();
  updateDrag(e.clientX, e.clientY);
}

function updateDrag(cx, cy) {
  if (!held) return;
  held.overTray = cy > trayTopY;
  trayCards[held.slot].classList.toggle("cancel-hint", held.overTray);

  setRayFromClient(cx, cy);

  // 指の指し先: 既存ブロック or 床
  const targets = [floorPlate, ...blockMeshes.values()];
  const hits = raycaster.intersectObjects(targets, false);
  const hitPoint = hits.length ? hits[0].point : null;

  // 最も近い有効配置を探す
  let bestP = null, bestD = Infinity;
  const c = new THREE.Vector3();
  for (const p of held.placements) {
    cellWorld(p[0], p[1], p[2], c).add(held.centroid);
    const d = hitPoint
      ? c.distanceTo(hitPoint)
      : raycaster.ray.distanceToPoint(c) + 0.5;
    if (d < bestD) { bestD = d; bestP = p; }
  }
  const snapDist = 1.55 + held.radius * 0.9;
  const snapped = (!held.overTray && bestP && bestD < snapDist) ? bestP : null;
  setSnap(snapped);

  // 指追従位置 (グリッド中心を通るカメラ正対面との交点)
  const planeN = new THREE.Vector3();
  camera.getWorldDirection(planeN);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeN, TARGET);
  const follow = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(plane, follow)) {
    follow.sub(held.centroid);
    if (held.snapped) {
      cellWorld(held.snapped[0], held.snapped[1], held.snapped[2], held.posTarget);
    } else {
      held.posTarget.copy(follow);
    }
    if (!held.hasPos) { held.pos.copy(held.posTarget); held.hasPos = true; }
  }
}

function setSnap(p) {
  const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  if (same(held.snapped, p)) return;
  // 消去予告のハイライトを戻す
  for (const m of held.litMeshes) m.material.emissiveIntensity = 0.55;
  held.litMeshes = [];
  held.snapped = p;
  if (!p) { held.ghost.visible = false; return; }

  held.ghost.visible = true;
  cellWorld(p[0], p[1], p[2], held.ghost.position);
  held.wouldClear = board.linesIfPlaced(held.piece.cells, p[0], p[1], p[2]);
  const clearing = held.wouldClear.length > 0;
  held.ghost.traverse((o) => {
    if (o.isMesh) o.material.color.set(clearing ? 0xffd98a : 0xcfe2ff);
    else if (o.isLineSegments) o.material.color.set(clearing ? 0xffe9b8 : 0xdfe9ff);
  });
  if (clearing) {
    for (const line of held.wouldClear) {
      for (const [x, y, z] of line.cells) {
        const m = blockMeshes.get(board.idx(x, y, z));
        if (m) { m.material.emissiveIntensity = 1.6; held.litMeshes.push(m); }
      }
    }
    if (navigator.vibrate) navigator.vibrate(8);
  }
}

function drop() {
  if (!held) return;
  const h = held;
  held = null;
  trayCards[h.slot].classList.remove("cancel-hint");
  for (const m of h.litMeshes) m.material.emissiveIntensity = 0.55;
  scene.remove(h.group, h.ghost);
  disposeGroup(h.group);
  disposeGroup(h.ghost);

  if (!h.overTray && h.snapped && board.canPlace(h.piece.cells, ...h.snapped)) {
    commitPlacement(h.slot, h.piece, h.snapped);
  } else {
    hand[h.slot] = h.piece;
    setTrayPiece(h.slot, h.piece);
    sfx.cancel();
  }
}

// ---------------------------------------------------------------- 配置と消去

function commitPlacement(slot, piece, [ax, ay, az]) {
  board.place(piece.cells, ax, ay, az);
  piece.cells.forEach(([dx, dy, dz], i) => {
    addBlockMesh(ax + dx, ay + dy, az + dz, piece.plane, i * 0.02);
  });
  hand[slot] = null;
  setTrayPiece(slot, null);
  addScore(piece.cells.length * SCORE.perPlacedCell);
  sfx.place();

  const lines = board.completedLines();
  if (lines.length) {
    doClear(lines, [ax + piece.span[0] / 2 - 0.5, ay, az]);
  } else {
    combo = 0;
  }

  if (handEmpty()) refillHand();
  checkGameOver();
  return true;
}

function doClear(lines, nearCell) {
  combo++;
  const cleared = board.clearLines(lines);
  const pts =
    cleared.length * SCORE.perClearedCell * lines.length +
    (lines.length > 1 ? SCORE.multiLineBonus * (lines.length - 1) : 0) +
    (combo > 1 ? SCORE.comboBonus * combo : 0);
  addScore(pts);

  // 演出
  const toastText =
    lines.length >= 4 ? "ULTRA!!!!" :
    lines.length === 3 ? "TRIPLE!!!" :
    lines.length === 2 ? "DOUBLE!!" : "CLEAR!";
  showToast(combo > 1 ? `${toastText}  ×${combo} COMBO` : toastText);
  spawnScorePop(pts, nearCell);
  sfx.clear(lines.length);
  if (navigator.vibrate) navigator.vibrate(lines.length > 1 ? [24, 40, 24] : 18);

  // ブロックを流れ星化
  for (const line of lines) {
    const dir = new THREE.Vector3();
    dir.setComponent(line.axis, 1);
    line.cells.forEach((cell, i) => {
      const mesh = blockMeshes.get(board.idx(...cell));
      if (!mesh) return;
      blockMeshes.delete(board.idx(...cell));
      anims.push(meteor(mesh, dir, i * 0.045));
    });
    // ライン全体に沿った閃光バースト
    spawnBurst(line.cells);
  }
}

function meteor(mesh, dir, delay) {
  let t = -delay;
  const vel = dir.clone().multiplyScalar(9 + Math.random() * 3);
  vel.y += 1.4;
  const spin = new THREE.Vector3(Math.random(), Math.random(), Math.random())
    .multiplyScalar(6);
  return (dt) => {
    t += dt;
    if (t < 0) return true;
    if (t < 0.09) {
      // 一瞬白く発光
      mesh.material.emissiveIntensity = 4;
      mesh.scale.setScalar(1 + t * 2.4);
      return true;
    }
    vel.y -= 14 * dt;
    mesh.position.addScaledVector(vel, dt);
    mesh.rotation.x += spin.x * dt;
    mesh.rotation.y += spin.y * dt;
    const life = (t - 0.09) / 0.55;
    mesh.scale.setScalar(Math.max(0.001, 1.2 * (1 - life)));
    if (life >= 1) {
      blocksGroup.remove(mesh);
      mesh.material.dispose();
      return false;
    }
    return true;
  };
}

// 柔らかい光点スプライト (粒子用)
const sparkTex = (() => {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 1, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.85)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();

// バーストのキャンディ配色
const BURST_COLORS = [0x18e0ff, 0xffc300, 0xff2e88, 0xb6ff2d, 0xffffff, 0x8b5bff];

function spawnBurst(cells) {
  const count = cells.length * 10;
  const pos = new Float32Array(count * 3);
  const vels = [];
  const p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const cell = cells[i % cells.length];
    cellWorld(cell[0], cell[1], cell[2], p);
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    vels.push(new THREE.Vector3(
      (Math.random() - 0.5) * 5,
      Math.random() * 4.5,
      (Math.random() - 0.5) * 5,
    ));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: sparkTex,
    color: BURST_COLORS[Math.floor(Math.random() * BURST_COLORS.length)],
    size: 0.5, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  fxGroup.add(points);
  let t = 0;
  anims.push((dt) => {
    t += dt;
    const arr = geo.attributes.position.array;
    for (let i = 0; i < count; i++) {
      vels[i].y -= 9 * dt;
      arr[i * 3] += vels[i].x * dt;
      arr[i * 3 + 1] += vels[i].y * dt;
      arr[i * 3 + 2] += vels[i].z * dt;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = Math.max(0, 1 - t / 0.8);
    if (t >= 0.8) {
      fxGroup.remove(points);
      geo.dispose(); mat.dispose();
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------- スコア/UI

function addScore(pts) {
  score += pts;
  $("score").textContent = score;
  $("score").classList.remove("bump");
  void $("score").offsetWidth;
  $("score").classList.add("bump");
  if (score > best) {
    best = score;
    store.set("best", best);
    $("best").textContent = best;
  }
}

function showToast(text) {
  const el = $("comboToast");
  el.textContent = text;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
}

function spawnScorePop(pts, cell) {
  const p = cellWorld(cell[0], cell[1], cell[2]);
  p.project(camera);
  const el = document.createElement("div");
  el.className = "pop";
  el.textContent = "+" + pts;
  el.style.left = ((p.x + 1) / 2 * innerWidth) + "px";
  el.style.top = ((1 - (p.y + 1) / 2) * innerHeight) + "px";
  $("popLayer").appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

// ---------------------------------------------------------------- ゲームフロー

function startGame() {
  board.clearAll();
  for (const m of blockMeshes.values()) {
    blocksGroup.remove(m);
    m.material.dispose();
  }
  blockMeshes.clear();
  score = 0;
  combo = 0;
  submitted = false;
  $("score").textContent = "0";
  $("best").textContent = best;
  refillHand();
  hideOverlay("ovTitle");
  hideOverlay("ovOver");
  document.body.classList.add("playing");
  state = "play";
}

function checkGameOver() {
  for (const p of hand) {
    if (p && board.allPlacements(p.cells).length > 0) return;
  }
  state = "over";
  setTimeout(showGameOver, 650);
}

function showGameOver() {
  document.body.classList.remove("playing");
  sfx.over();
  $("overScore").textContent = score;
  $("overBestNote").textContent = score >= best && score > 0 ? "🎉 NEW BEST!" : "";
  $("submitResult").textContent = "";
  $("btnSubmit").disabled = false;
  $("btnSubmit").style.opacity = 1;
  $("nameInput").value = store.get("name", "");
  $("btnSubmit").textContent = isOnlineEnabled() ? "世界に記録する" : "記録する";
  showOverlay("ovOver");
}

// ---------------------------------------------------------------- ランキングUI

let rankTab = isOnlineEnabled() ? "world" : "local";

async function renderRankList() {
  const list = $("rankList");
  $("tabWorld").classList.toggle("active", rankTab === "world");
  $("tabLocal").classList.toggle("active", rankTab === "local");

  if (rankTab === "local") {
    const rows = getLocalRanks();
    list.innerHTML = rows.length
      ? rows.map((r, i) => rankRowHtml(i + 1, r.name, r.score)).join("")
      : `<div class="rank-note">まだ記録がありません。<br>星を積んで、最初の記録を残そう。</div>`;
    return;
  }

  if (!isOnlineEnabled()) {
    list.innerHTML = `<div class="rank-note">オンライン世界ランキングは未設定です。<br>README の手順(約5分)で有効化できます。<br><br>それまでは「この端末」タブの記録が使えます。</div>`;
    return;
  }
  list.innerHTML = `<div class="rank-note">星の記録を読み込み中…</div>`;
  try {
    const rows = await fetchWorldRanks();
    const myName = store.get("name", "");
    list.innerHTML = rows && rows.length
      ? rows.map((r, i) => rankRowHtml(i + 1, r.name, r.score, r.name === myName)).join("")
      : `<div class="rank-note">まだ誰も記録していません。<br>世界最初の1人になろう。</div>`;
  } catch {
    list.innerHTML = `<div class="rank-note">読み込みに失敗しました。<br>通信環境を確認してもう一度どうぞ。</div>`;
  }
}

function rankRowHtml(no, name, score, me = false) {
  const cls = ["rank-row", no <= 3 ? `top${no}` : "", me ? "me" : ""].join(" ");
  return `<div class="${cls}">
    <span class="no">${no}</span>
    <span class="nm">${escapeHtml(name)}</span>
    <span class="sc">${score}</span>
  </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function submitScore() {
  const name = ($("nameInput").value || "").trim() || defaultName();
  store.set("name", name);
  if (submitted) return;
  submitted = true;
  const btn = $("btnSubmit");
  btn.disabled = true;
  btn.style.opacity = 0.5;

  const localRank = addLocalRank(name, score);
  if (!isOnlineEnabled()) {
    $("submitResult").textContent = `この端末で ${localRank}位 に記録しました ✦`;
    return;
  }
  $("submitResult").textContent = "夜空に送信中…";
  try {
    await submitWorldScore(name, score);
    let posText = "";
    try {
      const rows = await fetchWorldRanks();
      const pos = rows.findIndex((r) => r.name === name && r.score === score) + 1;
      if (pos > 0) posText = ` — 世界 ${pos}位!`;
    } catch { /* 順位表示は任意 */ }
    $("submitResult").textContent = `世界ランキングに記録しました ✦${posText}`;
  } catch {
    submitted = false;
    btn.disabled = false;
    btn.style.opacity = 1;
    $("submitResult").textContent = "送信に失敗… 電波のよい場所でもう一度。";
  }
}

function defaultName() {
  return "Player" + String(1000 + Math.floor(Math.random() * 9000));
}

// ---------------------------------------------------------------- オーバーレイ

let ovTopZ = 10;
function showOverlay(id) {
  const el = $(id);
  el.style.zIndex = ++ovTopZ;   // 常に最前面へ (ゲームオーバー→ランキング等の重なり対策)
  el.classList.add("show");
}
function hideOverlay(id) { $(id).classList.remove("show"); }

// ---------------------------------------------------------------- 入力

canvas.addEventListener("pointerdown", (e) => {
  initAudio();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (pointers.size === 1) {
    if (state === "play") {
      const slot = slotAtPoint(e.clientX, e.clientY);
      if (slot !== null && hand[slot]) {
        pickUp(slot, e);
        return;
      }
    }
    orbit = { id: e.pointerId, lastX: e.clientX, lastY: e.clientY };
  } else if (pointers.size === 2 && !held) {
    orbit = null;
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), r: cam.tR };
  }
});

canvas.addEventListener("pointermove", (e) => {
  const pt = pointers.get(e.pointerId);
  if (!pt) return;
  pt.x = e.clientX;
  pt.y = e.clientY;

  if (held && e.pointerId === held.pointerId) {
    updateDrag(e.clientX, e.clientY);
    return;
  }
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (d > 8) {
      cam.tR = THREE.MathUtils.clamp(pinch.r * (pinch.dist / d), R_MIN, R_MAX);
    }
    return;
  }
  if (orbit && e.pointerId === orbit.id) {
    cam.tAz -= (e.clientX - orbit.lastX) * 0.0085;
    cam.tPol = THREE.MathUtils.clamp(
      cam.tPol - (e.clientY - orbit.lastY) * 0.006, POL_MIN, POL_MAX);
    orbit.lastX = e.clientX;
    orbit.lastY = e.clientY;
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (held && e.pointerId === held.pointerId) drop();
  if (orbit && e.pointerId === orbit.id) orbit = null;
  if (pinch && pointers.size < 2) pinch = null;
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

// iOS のダブルタップ拡大等を抑止
document.addEventListener("gesturestart", (e) => e.preventDefault());
document.addEventListener("dblclick", (e) => e.preventDefault());

// ---------------------------------------------------------------- ボタン類

$("btnStart").addEventListener("click", () => { sfx.ui(); initAudio(); startGame(); });
$("btnAgain").addEventListener("click", () => { sfx.ui(); startGame(); });
$("btnHowTitle").addEventListener("click", () => { sfx.ui(); showOverlay("ovHelp"); });
$("btnHelp").addEventListener("click", () => { sfx.ui(); showOverlay("ovHelp"); });
$("btnRank").addEventListener("click", () => {
  sfx.ui();
  showOverlay("ovRank");
  renderRankList();
});
$("btnOverRank").addEventListener("click", () => {
  sfx.ui();
  showOverlay("ovRank");
  renderRankList();
});
$("tabWorld").addEventListener("click", () => { rankTab = "world"; renderRankList(); });
$("tabLocal").addEventListener("click", () => { rankTab = "local"; renderRankList(); });
$("btnSubmit").addEventListener("click", submitScore);

document.querySelectorAll(".ov-close").forEach((btn) => {
  btn.addEventListener("click", () => { sfx.ui(); hideOverlay(btn.dataset.close); });
});

{
  const setMuteIcon = (m) => { $("btnMute").textContent = m ? "🔇" : "🔊"; };
  let mutedNow = store.get("muted", "0") === "1";
  setMuted(mutedNow);
  setMuteIcon(mutedNow);
  $("btnMute").addEventListener("click", () => {
    mutedNow = !mutedNow;
    setMuteIcon(mutedNow);
    setMuted(mutedNow);
    store.set("muted", mutedNow ? "1" : "0");
    if (!mutedNow) sfx.ui();
  });
}

$("best").textContent = best;
$("titleBest").textContent = best;

// ---------------------------------------------------------------- メインループ

const anims = [];                      // (dt)=>boolean 継続中true
const clock = new THREE.Clock();

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  layoutTray();
}
addEventListener("resize", resize);
resize();

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // タイトル中はゆっくり自動回転
  if (state === "title") cam.tAz += dt * 0.1;

  // カメラ減衰追従
  const k = 1 - Math.exp(-dt * 10);
  cam.az += (cam.tAz - cam.az) * k;
  cam.pol += (cam.tPol - cam.pol) * k;
  cam.r += (cam.tR - cam.r) * k;
  camera.position.set(
    TARGET.x + cam.r * Math.sin(cam.pol) * Math.sin(cam.az),
    TARGET.y + cam.r * Math.cos(cam.pol),
    TARGET.z + cam.r * Math.sin(cam.pol) * Math.cos(cam.az),
  );
  camera.lookAt(TARGET);

  starLayers[0].rotation.y = t * 0.008;
  starLayers[1].rotation.y = -t * 0.012;

  // アニメーション
  for (let i = anims.length - 1; i >= 0; i--) {
    if (!anims[i](dt)) anims.splice(i, 1);
  }

  // ドラッグ中ピース
  if (held) {
    if (held.hasPos) {
      const kk = 1 - Math.exp(-dt * 22);
      held.pos.lerp(held.posTarget, kk);
      held.group.position.copy(held.pos);
      const s = held.overTray ? 0.55 : 1;
      held.group.scale.lerp(new THREE.Vector3(s, s, s), kk);
    }
    if (held.ghost.visible) {
      const pulse = 0.2 + 0.12 * Math.sin(t * 7);
      held.ghost.traverse((o) => {
        if (o.isMesh) o.material.opacity = pulse;
      });
    }
  }

  // 描画: メイン → トレイ3枠
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, innerWidth, innerHeight);
  renderer.clear(true, true);
  renderer.render(scene, camera);

  const dirV = new THREE.Vector3().subVectors(camera.position, TARGET).normalize();
  trayCam.position.copy(dirV).multiplyScalar(12);
  trayCam.quaternion.copy(camera.quaternion);

  renderer.setScissorTest(true);
  const dpr = renderer.getPixelRatio();
  const hPx = renderer.domElement.height;
  for (let i = 0; i < 3; i++) {
    const r = trayRects[i];
    if (!r || !trayScenes[i].group) continue;
    const vx = r.x * dpr;
    const vy = hPx - (r.y + r.h) * dpr;
    const vw = r.w * dpr;
    const vh = r.h * dpr;
    renderer.setViewport(vx / dpr, vy / dpr, vw / dpr, vh / dpr);
    renderer.setScissor(vx / dpr, vy / dpr, vw / dpr, vh / dpr);
    renderer.clearDepth();
    renderer.render(trayScenes[i].scene, trayCam);
  }
  renderer.setScissorTest(false);
}

tick();

// ---------------------------------------------------------------- デバッグ/テスト用フック

window.__tsumi = {
  board,
  hand,
  state: () => state,
  score: () => score,
  start: startGame,
  place: (slot, x, y, z) => {
    const p = hand[slot];
    if (!p || !board.canPlace(p.cells, x, y, z)) return false;
    return commitPlacement(slot, p, [x, y, z]);
  },
  placements: (slot) => (hand[slot] ? board.allPlacements(hand[slot].cells) : []),
  checkOver: () => checkGameOver(),
};

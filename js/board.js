// 盤面の純ロジック (描画に依存しない)

export class Board {
  constructor(n) {
    this.n = n;
    this.cells = new Uint8Array(n * n * n);
  }

  idx(x, y, z) {
    return x + this.n * (y + this.n * z);
  }

  get(x, y, z) {
    return this.cells[this.idx(x, y, z)];
  }

  set(x, y, z, v) {
    this.cells[this.idx(x, y, z)] = v;
  }

  inBounds(x, y, z) {
    const n = this.n;
    return x >= 0 && y >= 0 && z >= 0 && x < n && y < n && z < n;
  }

  isEmptyBoard() {
    return this.cells.every((v) => v === 0);
  }

  clearAll() {
    this.cells.fill(0);
  }

  /** 床(y=0)に接するか、既存の立方体に面で接している必要がある */
  canPlace(cells, ax, ay, az) {
    let supported = false;
    for (const [dx, dy, dz] of cells) {
      const x = ax + dx, y = ay + dy, z = az + dz;
      if (!this.inBounds(x, y, z) || this.get(x, y, z)) return false;
      if (y === 0) supported = true;
    }
    if (!supported) {
      outer: for (const [dx, dy, dz] of cells) {
        const x = ax + dx, y = ay + dy, z = az + dz;
        for (const [nx, ny, nz] of NEIGHBORS) {
          const px = x + nx, py = y + ny, pz = z + nz;
          if (this.inBounds(px, py, pz) && this.get(px, py, pz)) {
            supported = true;
            break outer;
          }
        }
      }
    }
    return supported;
  }

  /** ピースを置ける全アンカー位置 */
  allPlacements(cells) {
    const out = [];
    const sx = Math.max(...cells.map((c) => c[0]));
    const sy = Math.max(...cells.map((c) => c[1]));
    const sz = Math.max(...cells.map((c) => c[2]));
    for (let x = 0; x <= this.n - 1 - sx; x++)
      for (let y = 0; y <= this.n - 1 - sy; y++)
        for (let z = 0; z <= this.n - 1 - sz; z++)
          if (this.canPlace(cells, x, y, z)) out.push([x, y, z]);
    return out;
  }

  place(cells, ax, ay, az) {
    for (const [dx, dy, dz] of cells) this.set(ax + dx, ay + dy, az + dz, 1);
  }

  /** place の取り消し (手札ディーラーの解探索用) */
  unplace(cells, ax, ay, az) {
    for (const [dx, dy, dz] of cells) this.set(ax + dx, ay + dy, az + dz, 0);
  }

  /**
   * 完成しているラインを列挙する。
   * @returns {{axis:number, fixed:number[], cells:number[][]}[]}
   *   axis: 0=x方向, 1=y方向, 2=z方向 / cells: ライン上の全セル
   */
  completedLines() {
    const n = this.n;
    const lines = [];
    for (let axis = 0; axis < 3; axis++) {
      for (let a = 0; a < n; a++) {
        for (let b = 0; b < n; b++) {
          const cells = [];
          let full = true;
          for (let i = 0; i < n; i++) {
            const p = axisCell(axis, i, a, b);
            if (!this.get(...p)) { full = false; break; }
            cells.push(p);
          }
          if (full) lines.push({ axis, fixed: [a, b], cells });
        }
      }
    }
    return lines;
  }

  /**
   * 完成している面(軸に垂直な N×N のレイヤー)を列挙する。
   * @returns {{axis:number, fixed:number, cells:number[][]}[]}
   *   axis: 面の法線となる軸 (0=x,1=y,2=z) / cells: 面上の全セル
   */
  completedPlanes() {
    const n = this.n;
    const planes = [];
    for (let axis = 0; axis < 3; axis++) {
      for (let f = 0; f < n; f++) {
        const cells = [];
        let full = true;
        loop:
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const p = planeCell(axis, f, i, j);
            if (!this.get(...p)) { full = false; break loop; }
            cells.push(p);
          }
        }
        if (full) planes.push({ axis, fixed: f, cells });
      }
    }
    return planes;
  }

  /** クリア種別に応じて完成グループ(ライン or 面)を返す */
  completedGroups(clear) {
    return clear === "plane" ? this.completedPlanes() : this.completedLines();
  }

  /** 置いたと仮定した場合に完成するグループ (仮置きプレビュー用) */
  groupsIfPlaced(cells, ax, ay, az, clear) {
    for (const [dx, dy, dz] of cells) this.set(ax + dx, ay + dy, az + dz, 1);
    const g = this.completedGroups(clear);
    for (const [dx, dy, dz] of cells) this.set(ax + dx, ay + dy, az + dz, 0);
    return g;
  }

  /** ライン群のセルを消去し、消えたセル一覧(重複なし)を返す */
  clearLines(lines) {
    const seen = new Set();
    const cleared = [];
    for (const line of lines) {
      for (const [x, y, z] of line.cells) {
        const k = this.idx(x, y, z);
        if (!seen.has(k)) {
          seen.add(k);
          cleared.push([x, y, z]);
          this.set(x, y, z, 0);
        }
      }
    }
    return cleared;
  }
}

const NEIGHBORS = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

// axis方向に i 番目、残り2軸を (a,b) で固定したセル座標
function axisCell(axis, i, a, b) {
  if (axis === 0) return [i, a, b];
  if (axis === 1) return [a, i, b];
  return [a, b, i];
}

// 法線 axis・その軸の固定座標 f の面上で、残り2軸を (i,j) としたセル座標
function planeCell(axis, f, i, j) {
  if (axis === 0) return [f, i, j];
  if (axis === 1) return [i, f, j];
  return [i, j, f];
}

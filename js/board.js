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

  /** 置いたと仮定した場合に完成するライン (仮置きプレビュー用) */
  linesIfPlaced(cells, ax, ay, az) {
    for (const [dx, dy, dz] of cells) this.set(ax + dx, ay + dy, az + dz, 1);
    const lines = this.completedLines();
    for (const [dx, dy, dz] of cells) this.set(ax + dx, ay + dy, az + dz, 0);
    return lines;
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

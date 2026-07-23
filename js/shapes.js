// 3Dブロックの形状定義と生成
// 「もう1軸は厚み1(板状)」の制約は撤廃。ピースは3軸に広がる立体ポリキューブ。

// 直方体(sx×sy×sz)のセル群を作るヘルパー
function box(sx, sy, sz) {
  const cells = [];
  for (let x = 0; x < sx; x++)
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        cells.push([x, y, z]);
  return cells;
}

// 形状定義 (3Dセル)。w は出現の重み
const SHAPE_DEFS = [
  // --- 小さめ (置きやすい) ---
  { name: "mono",   w: 11, cells: [[0, 0, 0]] },
  { name: "domino", w: 10, cells: [[0, 0, 0], [1, 0, 0]] },
  { name: "tri_i",  w: 9,  cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] },
  { name: "tri_l",  w: 10, cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] },

  // --- テトロミノ (平面) ---
  { name: "i4",     w: 6,  cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] },
  { name: "sq4",    w: 8,  cells: box(2, 2, 1) },
  { name: "l4",     w: 7,  cells: [[0, 0, 0], [0, 1, 0], [0, 2, 0], [1, 2, 0]] },
  { name: "t4",     w: 7,  cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 1, 0]] },
  { name: "s4",     w: 6,  cells: [[1, 0, 0], [2, 0, 0], [0, 1, 0], [1, 1, 0]] },

  // --- 立体テトロミノ (真の3D) ---
  { name: "tripod", w: 7,  cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] }, // 3方向コーナー
  { name: "twist",  w: 6,  cells: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]] }, // ねじれ階段

  // --- 中 (立体・平面) ---
  { name: "rect6",  w: 5,  cells: box(3, 2, 1) },                 // 2×3 平面
  { name: "flat9",  w: 6,  cells: box(3, 3, 1) },                 // 3×3 平面
  { name: "cube8",  w: 6,  cells: box(2, 2, 2) },                 // 2×2×2 立方体
  { name: "L5",     w: 5,  cells: [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0], [1, 3, 0]] },
  { name: "corner5",w: 5,  cells: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0]] }, // 立体かぎ
  { name: "plus7",  w: 3,  cells: [[1, 1, 1], [0, 1, 1], [2, 1, 1], [1, 0, 1], [1, 2, 1], [1, 1, 0], [1, 1, 2]] }, // 3D十字
  { name: "slab12", w: 3,  cells: box(3, 2, 2) },                 // 3×2×2

  // --- 大 (むずめ) ---
  { name: "cube27", w: 3,  cells: box(3, 3, 3) },                 // 3×3×3 立方体
];

// 90°回転 (各軸)
const rotX = ([x, y, z]) => [x, -z, y];
const rotY = ([x, y, z]) => [z, y, -x];
const rotZ = ([x, y, z]) => [-y, x, z];

function applyRot(cells, fn, times) {
  for (let i = 0; i < times; i++) cells = cells.map(fn);
  return cells;
}

function normalize3(cells) {
  const m = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
  return cells.map((c) => c.map((x, i) => x - m[i]));
}

function pickShape(rng, gridN) {
  // gridN に収まる形だけを対象にする
  const pool = SHAPE_DEFS.filter((s) => {
    const span = [0, 1, 2].map((i) => Math.max(...s.cells.map((c) => c[i])) + 1);
    return span.every((v) => v <= gridN);
  });
  const total = pool.reduce((a, s) => a + s.w, 0);
  let r = rng() * total;
  for (const s of pool) {
    r -= s.w;
    if (r <= 0) return s;
  }
  return pool[pool.length - 1];
}

/**
 * ピースを1つ生成する。
 * @returns {{cells:number[][], shape:string, span:number[]}}
 *   cells: 正規化済み3Dセル群 / span: 各軸の占有幅
 */
export function generatePiece(gridN, rng = Math.random) {
  const def = pickShape(rng, gridN);
  let cells = def.cells.map((c) => c.slice());
  cells = applyRot(cells, rotX, Math.floor(rng() * 4));
  cells = applyRot(cells, rotY, Math.floor(rng() * 4));
  cells = applyRot(cells, rotZ, Math.floor(rng() * 4));
  cells = normalize3(cells);
  const span = [0, 1, 2].map((i) => Math.max(...cells.map((c) => c[i])) + 1);
  return { cells, shape: def.name, span };
}

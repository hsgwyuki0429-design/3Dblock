// 2D形状の定義と、3D空間(2軸+厚み1)のピース生成

// 昔ながらのブロックブラスト形状 (u,v)。w は出現の重み
const SHAPE_DEFS = [
  { name: "dot",  w: 15, cells: [[0, 0]] },
  { name: "i2",   w: 13, cells: [[0, 0], [1, 0]] },
  { name: "i3",   w: 11, cells: [[0, 0], [1, 0], [2, 0]] },
  { name: "i4",   w: 6,  cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: "v3",   w: 12, cells: [[0, 0], [1, 0], [0, 1]] },
  { name: "o4",   w: 10, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: "l4",   w: 8,  cells: [[0, 0], [0, 1], [0, 2], [1, 2]] },
  { name: "t4",   w: 8,  cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { name: "s4",   w: 7,  cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: "z4",   w: 7,  cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
  { name: "o6",   w: 4,  cells: [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]] },
  { name: "plus", w: 5,  cells: [[1, 0], [0, 1], [1, 1], [2, 1], [1, 2]] },
];

const PLANES = ["XZ", "XY", "YZ"];

function rotate90(cells) {
  return cells.map(([u, v]) => [v, -u]);
}
function mirror(cells) {
  return cells.map(([u, v]) => [-u, v]);
}
function normalize2(cells) {
  const mu = Math.min(...cells.map((c) => c[0]));
  const mv = Math.min(...cells.map((c) => c[1]));
  return cells.map(([u, v]) => [u - mu, v - mv]);
}

function pickShape(rng, maxSpan) {
  const pool = SHAPE_DEFS.filter((s) =>
    s.cells.every(([u, v]) => u < maxSpan && v < maxSpan)
  );
  const total = pool.reduce((a, s) => a + s.w, 0);
  let r = rng() * total;
  for (const s of pool) {
    r -= s.w;
    if (r <= 0) return s;
  }
  return pool[pool.length - 1];
}

// (u,v) を plane に応じて3Dへ。v は垂直面では上方向(+y)に対応させる
function toPlane(cells2, plane) {
  switch (plane) {
    case "XZ": return cells2.map(([u, v]) => [u, 0, v]);
    case "XY": return cells2.map(([u, v]) => [u, v, 0]);
    case "YZ": return cells2.map(([u, v]) => [0, v, u]);
  }
}

function normalize3(cells) {
  const m = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
  return cells.map((c) => c.map((x, i) => x - m[i]));
}

/**
 * ピースを1つ生成する。
 * @returns {{cells:number[][], plane:string, shape:string, span:number[]}}
 *   cells: 正規化済み3Dセル群 / plane: 広がる面(生成後不変) / span: 各軸の占有幅
 */
export function generatePiece(gridN, rng = Math.random) {
  const def = pickShape(rng, gridN);
  let c2 = def.cells;
  const rot = Math.floor(rng() * 4);
  for (let i = 0; i < rot; i++) c2 = rotate90(c2);
  if (rng() < 0.5) c2 = mirror(c2);
  c2 = normalize2(c2);

  const plane = PLANES[Math.floor(rng() * PLANES.length)];
  const cells = normalize3(toPlane(c2, plane));
  const span = [0, 1, 2].map((i) => Math.max(...cells.map((c) => c[i])) + 1);
  return { cells, plane, shape: def.name, span };
}

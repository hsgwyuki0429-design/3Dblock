// 手札ディーラー: 人がその場面に合わせて選んだように3ピースを配る
//
// ねらい:
//  1. 盤面の「あと少しで消えるライン/面」にはまるピースを混ぜる (気持ちよさ)
//  2. ただし3つ全部が正解ピースにはしない (上位1 + 中位1 + ワイルド1 の構成で、
//     どれがどこにはまるかは自分で気づく必要がある)
//  3. 3つとも場に出た時点で「3つ全部を置き切れる手順が最低1つ存在する」ことを
//     解探索で保証する (最適手順を見つければ詰まない)

const CANDIDATES = 16;   // 1回のディールで生成する候補ピース数
const BRANCH_CAP = 8;    // 解探索の枝刈り (1手あたり試す配置数)
const NO_FIT = -1e9;     // どこにも置けないピース

/**
 * @param board 現在の盤面 (Board)
 * @param clear "line" | "plane"
 * @param makePiece ピースを1つ乱数生成する関数
 * @returns 3ピースの配列
 */
export function dealHand(board, clear, makePiece) {
  const groups = collectGroups(board, clear);

  // 候補を2ラウンドまで生成し、「3つとも置き切れる」組を確実に探す
  for (let round = 0; round < 2; round++) {
    const cands = [];
    for (let i = 0; i < CANDIDATES; i++) {
      const p = makePiece();
      p.fit = bestFit(board, groups, p);
      cands.push(p);
    }
    const placeable = cands.filter((p) => p.fit > NO_FIT);
    placeable.sort((a, b) => b.fit - a.fit);   // はまり具合の良い順
    const trio = findSolvableTrio(board, placeable);
    if (trio) return shuffle(trio);

    // 解ける組が無くても、置けるのが3つ以上あるならそれで妥協 (最終ラウンド)
    if (round === 1 && placeable.length >= 3) {
      return shuffle(placeable.slice(0, 3));
    }
  }

  // ほぼ満杯: 置けるものだけかき集める (ここに来たら実質ゲームオーバー間近)
  const last = [];
  for (let i = 0; i < CANDIDATES && last.length < 3; i++) last.push(makePiece());
  return last;
}

/**
 * 置ける候補の中から「3つとも順に置き切れる」組を探す。
 * まず はまり具合の良いピースを含む組を優先し(気持ちよさ)、
 * 見つからなければ総当りで解ける組を探す(詰み防止の保証)。
 */
function findSolvableTrio(board, placeable) {
  if (placeable.length < 3) return null;
  const M = Math.min(placeable.length, 12);   // 上位12個を対象
  let checked = 0;

  // pass1: 最上位(はまりの良い)ピースを必ず1つ含む組を優先
  const withTop = [];
  for (let a = 1; a < M; a++)
    for (let b = a + 1; b < M; b++) withTop.push([0, a, b]);
  shuffle(withTop);
  for (const [i, j, k] of withTop) {
    if (checked++ > 70) break;
    const trio = [placeable[i], placeable[j], placeable[k]];
    if (isSolvable(board, trio)) return trio;
  }

  // pass2: 上位12個の総当り
  const all = [];
  for (let i = 0; i < M; i++)
    for (let j = i + 1; j < M; j++)
      for (let k = j + 1; k < M; k++) all.push([i, j, k]);
  shuffle(all);
  checked = 0;
  for (const [i, j, k] of all) {
    if (checked++ > 140) break;
    const trio = [placeable[i], placeable[j], placeable[k]];
    if (isSolvable(board, trio)) return trio;
  }
  return null;
}

// ---- グループ (ライン/面) の充填状況 ----

function collectGroups(board, clear) {
  const n = board.n;
  const list = [];                          // {size, filled}
  const cellGroups = new Array(n * n * n);  // idx -> gid[]
  for (let i = 0; i < cellGroups.length; i++) cellGroups[i] = [];

  const addGroup = (cells) => {
    const gid = list.length;
    let filled = 0;
    for (const [x, y, z] of cells) {
      if (board.get(x, y, z)) filled++;
      cellGroups[board.idx(x, y, z)].push(gid);
    }
    list.push({ size: cells.length, filled });
  };

  if (clear === "plane") {
    for (let axis = 0; axis < 3; axis++) {
      for (let f = 0; f < n; f++) {
        const cells = [];
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++)
            cells.push(planeCell(axis, f, i, j));
        addGroup(cells);
      }
    }
  } else {
    for (let axis = 0; axis < 3; axis++) {
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n; b++) {
          const cells = [];
          for (let i = 0; i < n; i++) cells.push(axisCell(axis, i, a, b));
          addGroup(cells);
        }
    }
  }
  return { list, cellGroups };
}

function axisCell(axis, i, a, b) {
  if (axis === 0) return [i, a, b];
  if (axis === 1) return [a, i, b];
  return [a, b, i];
}
function planeCell(axis, f, i, j) {
  if (axis === 0) return [f, i, j];
  if (axis === 1) return [i, f, j];
  return [i, j, f];
}

// ---- ピースの「はまり具合」スコア ----

function bestFit(board, groups, piece) {
  const n = board.n;
  const [sx, sy, sz] = piece.span;
  let best = NO_FIT;
  for (let x = 0; x <= n - sx; x++)
    for (let y = 0; y <= n - sy; y++)
      for (let z = 0; z <= n - sz; z++) {
        if (!board.canPlace(piece.cells, x, y, z)) continue;
        const s = placementScore(board, groups, piece, x, y, z);
        if (s > best) best = s;
      }
  return best;
}

function placementScore(board, groups, piece, ax, ay, az) {
  const own = new Set(piece.cells.map(([dx, dy, dz]) =>
    board.idx(ax + dx, ay + dy, az + dz)));
  const gain = new Map();
  let s = 0;

  for (const [dx, dy, dz] of piece.cells) {
    const x = ax + dx, y = ay + dy, z = az + dz;
    for (const gid of groups.cellGroups[board.idx(x, y, z)]) {
      gain.set(gid, (gain.get(gid) || 0) + 1);
    }
    // 密着度: 埋まっている隣接面 + 床
    let c = 0;
    if (y === 0) c++;
    for (const [nx, ny, nz] of NB) {
      const px = x + nx, py = y + ny, pz = z + nz;
      if (board.inBounds(px, py, pz) && board.get(px, py, pz)) c++;
    }
    s += 0.3 * c;
    // 中に浮かせて穴を作る置き方は減点
    if (y > 0 && !board.get(x, y - 1, z) && !own.has(board.idx(x, y - 1, z))) s -= 0.7;
  }

  // 完成間近のグループへの貢献を重視 (r=充填率)
  for (const [gid, g] of gain) {
    const gr = groups.list[gid];
    const r = gr.filled / gr.size;
    s += g * r * r * 3;
    if (gr.filled + g === gr.size) s += gr.size * 1.2;   // そのまま完成する
  }

  s -= ay * 0.1;              // 低い場所を好む
  s += Math.random() * 1.5;   // 毎回同じ配給にならないよう揺らぎ
  return s;
}

const NB = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

// ---- 3ピースを置き切れる手順が存在するか (枝刈り付きDFS) ----

function isSolvable(board, pieces) {
  const dfs = (rem) => {
    if (rem.length === 0) return true;
    for (let i = 0; i < rem.length; i++) {
      const p = rem[i];
      const pl = board.allPlacements(p.cells);
      if (!pl.length) continue;
      // 低い位置を優先しつつ順序を少しばらす
      for (const pos of pl) pos._k = pos[1] * 100 + Math.random() * 30;
      pl.sort((a, b) => a._k - b._k);
      const rest = rem.filter((_, j) => j !== i);
      const cap = Math.min(pl.length, BRANCH_CAP);
      for (let k = 0; k < cap; k++) {
        const pos = pl[k];
        board.place(p.cells, pos[0], pos[1], pos[2]);
        const ok = dfs(rest);
        board.unplace(p.cells, pos[0], pos[1], pos[2]);
        if (ok) return true;
      }
    }
    return false;
  };
  return dfs(pieces);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 現在の手札(残っているピース)を置き切る手順を1つ探して返す。
 * 全部置ける解があればそれを、無ければ「最も多く置ける」部分解を返す。
 * @returns {{piece, pos:[x,y,z]}[]}  置く順の配列 (現在の盤面に順に place できる)
 */
export function solveHand(board, pieces) {
  const live = pieces.filter(Boolean);
  let best = [];
  const dfs = (rem, path) => {
    if (path.length > best.length) best = path.slice();
    if (rem.length === 0) return true;      // 完全解
    for (let i = 0; i < rem.length; i++) {
      const p = rem[i];
      const pl = board.allPlacements(p.cells);
      if (!pl.length) continue;
      for (const pos of pl) pos._k = pos[1] * 100 + Math.random() * 30;
      pl.sort((a, b) => a._k - b._k);
      const rest = rem.filter((_, j) => j !== i);
      const cap = Math.min(pl.length, BRANCH_CAP);
      for (let k = 0; k < cap; k++) {
        const pos = pl[k];
        board.place(p.cells, pos[0], pos[1], pos[2]);
        path.push({ piece: p, pos: [pos[0], pos[1], pos[2]] });
        const full = dfs(rest, path);
        board.unplace(p.cells, pos[0], pos[1], pos[2]);
        path.pop();
        if (full) return true;
      }
    }
    return false;
  };
  dfs(live, []);
  return best;
}

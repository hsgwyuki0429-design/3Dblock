// 手札ディーラー: 人がその場面に合わせて選んだように3ピースを配る
//
// ねらい:
//  1. 盤面の「あと少しで消えるライン/面」にはまるピースを、より賢く読んで混ぜる(気持ちよさ)
//  2. ただし3つ全部が正解ピースにはしない (good1 + mid1 + wild1 の構成)。さらに
//     「3つを置き切れる並びの通り数」が少ない=最適解が絞れる組を優先し、締まった一手に寄せる
//     (良いのが出過ぎて単調にならないように)
//  3. 3つとも場に出た時点で「3つ全部を置き切れる手順が最低1つ存在する」ことを
//     解探索で保証する (最適手順を選べば詰まない)
//  4. ごくたまに「盤面をまるごと空(全消し)」にできる組を配って最大のご褒美に。
//     たまに「大きく消せる(面1枚 / 複数ライン)」組も。出過ぎると単調なので確率で抑える。

const CANDIDATES = 20;      // 1回のディールで生成する候補ピース数 (体積UP分すこし増量)
const BRANCH_CAP = 8;       // 解探索の枝刈り (1手あたり試す配置数)
const NO_FIT = -1e9;        // どこにも置けないピース

const BIGCLEAR_PROB = 0.09; // たまに「大きく消せる」ご褒美(面1枚/複数ライン)。出過ぎ防止でやや控えめ

// 「全消し(盤面まるごと空)」を狙う設定。モード別。
//  prob = 発火確率 / lo,hi = 狙う盤面充填率の帯 / pool,combos = 発火時の探索の厚み
//  plane は 面(25マス)まるごと消す必要があり全消しが起きにくいので、発火・探索とも厚めにし、
//  band 下限も下げて(=より空いた=消しやすい局面も拾って)成功率を上げる。
const FULLCLEAR = {
  line:  { prob: 0.10, lo: 0.18, hi: 0.74, pool: 18, combos: 14 },
  plane: { prob: 0.32, lo: 0.12, hi: 0.70, pool: 26, combos: 26 },
};

const WAYS_CAP = 4;         // 「置き切れる並びの通り数」を数える上限。少ないほど最適解が一意=良い塩梅
const SOLVABLE_POOL = 5;    // 通り数を比べるために集める「解ける組」の数
const WAYS_MIN_FILL = 0.33; // これ以上埋まっている時だけ「締まった手(通り数)」を吟味する
                            // (空盤では解が無数=吟味しても無意味な上に重い。序盤は素直に軽く配る)

const OP_CAP = 4500;        // dealHand 1回で許す allPlacements 探索の上限。重い盤面で打ち切り、
                            // リフィル時のカクつきを防ぐ(打ち切ってもフォールバックで手は配れる)

const NONE = [];            // 消えなかった時の共有空配列 (中身は書き換えない)

// 探索で使った allPlacements 回数を数える(最悪時間の頭打ち用)。dealHand の頭でリセット。
let opUsed = 0;
const PL = (board, cells) => { opUsed++; return board.allPlacements(cells); };

/**
 * その場面で欲しいピースを勘ぐって3つ配る。
 *  - ごくたまに「全消し」できる組を配って最大のご褒美に
 *  - たまに「大きく消せる」組を配ってご褒美に (盤面が埋まっているほど確率↑)
 *  - 基本は「good1 + mid1 + wild1」で、置き切れる通り数の少ない締まった組を優先
 *  - どの組も「3つとも置き切れる手順」を解探索で保証(詰み防止)
 */
export function dealHand(board, clear, makePiece) {
  opUsed = 0;   // このディールの探索予算をリセット
  const groups = collectGroups(board, clear);
  const filledRatio = countFilled(board) / board.cells.length;

  // ★ ごくたまに: 盤面をまるごと空にできる「全消し」手。埋まり具合が手頃な時だけ狙う。
  //   幾何的に不可能な盤面がほとんどなので、確率を掛けても実際に出るのはごく稀。
  //   plane は全消しが起きにくいので設定を厚くしてある(FULLCLEAR 参照)。
  const fcCfg = FULLCLEAR[clear] || FULLCLEAR.line;
  if (filledRatio >= fcCfg.lo && filledRatio <= fcCfg.hi
      && Math.random() < fcCfg.prob) {
    const fc = findClearAllTrio(board, clear, makePiece, fcCfg);
    if (fc) return shuffle(fc);
  }

  for (let round = 0; round < 2; round++) {
    const cands = [];
    for (let i = 0; i < CANDIDATES; i++) {
      const p = makePiece();
      p.fit = bestFit(board, groups, p);
      cands.push(p);
    }
    const placeable = cands.filter((p) => p.fit > NO_FIT);
    placeable.sort((a, b) => b.fit - a.fit);   // はまり具合の良い順

    // ご褒美: たまに大きく消せる組 (埋まっているほど出やすい)
    if (Math.random() < BIGCLEAR_PROB * (0.4 + filledRatio)) {
      const jp = findJackpotTrio(board, clear, placeable);
      if (jp) return shuffle(jp);
    }

    const trio = findSolvableTrio(board, placeable, filledRatio >= WAYS_MIN_FILL);
    if (trio) return shuffle(trio);
    if (round === 1 && placeable.length >= 3) return shuffle(placeable.slice(0, 3));
  }

  // ほぼ満杯: 置けるものだけかき集める (実質ゲームオーバー間近)
  const last = [];
  for (let i = 0; i < CANDIDATES && last.length < 3; i++) last.push(makePiece());
  return last;
}

function countFilled(board) {
  let n = 0;
  for (let i = 0; i < board.cells.length; i++) n += board.cells[i];
  return n;
}

/**
 * 「good1 + それ以外2つ」で解ける組を探す。
 * 3つとも上位(good)の組は避けて、簡単すぎない塩梅にする。
 * さらに、解ける組をいくつか集めて「置き切れる並びの通り数」が最も少ない組を選ぶ
 * (= 最適解が絞れて締まった一手)。ただし通り数=1 が出たら即採用(最良の塩梅)。
 * 見つからなければ総当りで解ける組を返す(詰み防止の保証)。
 */
function findSolvableTrio(board, placeable, tight) {
  const P = placeable.length;
  if (P < 3) return null;
  const M = Math.min(P, 12);
  const goodMax = Math.min(3, M);   // 上位3つを "good" 帯とみなす

  // pass A: good を1つ含み、残り2つのうち少なくとも1つは good 以外
  const combosA = [];
  for (let g = 0; g < goodMax; g++)
    for (let a = g + 1; a < M; a++)
      for (let b = a + 1; b < M; b++) {
        if (a < goodMax && b < goodMax) continue;   // good 3つは避ける(簡単すぎ)
        combosA.push([g, a, b]);
      }
  shuffle(combosA);

  const solvable = [];
  let checked = 0;
  for (const [i, j, k] of combosA) {
    if (checked++ > 90 || opUsed > OP_CAP) break;
    const trio = [placeable[i], placeable[j], placeable[k]];
    if (!isSolvable(board, trio)) continue;
    if (!tight) return trio;                         // 序盤(スカスカ)は締まり吟味なしで軽く配る
    const ways = countWays(board, trio, WAYS_CAP);
    if (ways <= 1) return trio;                      // 最適解が一意=最良。即採用
    solvable.push({ trio, ways });
    if (solvable.length >= SOLVABLE_POOL) break;
  }
  if (solvable.length) {
    solvable.sort((a, b) => a.ways - b.ways);        // 通り数の少ない=締まった組を優先
    return solvable[0].trio;
  }

  // pass B (保証): 上位12個の総当りで、とにかく置き切れる組を返す
  const all = [];
  for (let i = 0; i < M; i++)
    for (let j = i + 1; j < M; j++)
      for (let k = j + 1; k < M; k++) all.push([i, j, k]);
  shuffle(all);
  checked = 0;
  for (const [i, j, k] of all) {
    if (checked++ > 150 || opUsed > OP_CAP) break;
    const trio = [placeable[i], placeable[j], placeable[k]];
    if (isSolvable(board, trio)) return trio;
  }
  return null;
}

/**
 * 「3つを置き切れる並び」が何通りあるかを cap まで数える。
 * 順番違いで同じ最終配置になるものは1通りに畳む(最終アンカー位置の集合で判定)。
 * 少ない=最適解が絞れる。多い=どこにでも置けてゆるい(=単調)。
 * isSolvable と同じ「消去は考えない」モデルで数えるので保証と整合する。
 */
function countWays(board, trio, cap) {
  const seen = new Set();
  const idOf = new Map(trio.map((p, i) => [p, i]));
  const key = [];
  const dfs = (rem) => {
    if (seen.size >= cap || opUsed > OP_CAP) return;
    if (rem.length === 0) { seen.add(key.slice().sort().join("|")); return; }
    for (let i = 0; i < rem.length; i++) {
      const p = rem[i];
      const pl = PL(board, p.cells);
      pl.sort((a, b) => a[1] - b[1]);   // 低い位置優先(isSolvable と揃える)
      const rest = rem.filter((_, j) => j !== i);
      const c = Math.min(pl.length, BRANCH_CAP);
      for (let n = 0; n < c; n++) {
        if (seen.size >= cap) return;
        const pos = pl[n];
        board.place(p.cells, pos[0], pos[1], pos[2]);
        key.push(idOf.get(p) + ":" + pos[0] + "," + pos[1] + "," + pos[2]);
        dfs(rest);
        key.pop();
        board.unplace(p.cells, pos[0], pos[1], pos[2]);
      }
    }
  };
  const snap = board.cells.slice();
  dfs(trio);
  board.cells.set(snap);
  return seen.size;
}

// ---- 全消し(盤面まるごと空)ができる組を探す ----

/**
 * いまの盤面を「まるごと空(全消し)」にできる3ピースを探す。
 * 候補を多めに生成し、消しに絡みやすい順に総当り(試行数は厳しく制限)。
 * 見つかった組は「消しながら置けば盤面が空になる並び」が存在する = 当然置き切れる。
 * 幾何条件が厳しいので大半は null (= このディールでは全消しは出ない)。
 */
function findClearAllTrio(board, clear, makePiece, cfg) {
  // 全消しは滅多に発火しないご褒美なので、発火時は厚めに候補を用意して成功率を上げる。
  // cfg.pool / cfg.combos で厚みを調整(plane は厚め)。
  const pool = [];
  for (let i = 0; i < cfg.pool; i++) {
    const p = makePiece();
    if (PL(board, p.cells).length) pool.push(p);
  }
  if (pool.length < 3) return null;
  for (const p of pool) p._cp = quickClearPotential(board, clear, p);
  pool.sort((a, b) => b._cp - a._cp);   // 単体で多く消せるピースを前へ

  const M = Math.min(pool.length, cfg.pool >= 24 ? 13 : 11);
  let tries = 0;
  for (let i = 0; i < M; i++)
    for (let j = i + 1; j < M; j++)
      for (let k = j + 1; k < M; k++) {
        if (++tries > cfg.combos || opUsed > OP_CAP) return null;   // 全体の試行上限
        const trio = [pool[i], pool[j], pool[k]];
        if (canEmptyBoard(board, clear, trio)) return trio;
      }
  return null;
}

/** ピース単体を置いたとき最大で何マス消せるか(全消し候補の並べ替え用。配置は上限サンプル) */
function quickClearPotential(board, clear, piece) {
  const pls = PL(board, piece.cells);
  let best = 0;
  const lim = Math.min(pls.length, 48);
  for (let i = 0; i < lim; i++) {
    const [x, y, z] = pls[i];
    board.place(piece.cells, x, y, z);
    const cc = countClearCells(board, clear);
    board.unplace(piece.cells, x, y, z);
    if (cc > best) best = cc;
  }
  return best;
}

/**
 * trio を「消しながら」順に置いて、途中または最後に盤面が空になる並びがあるか。
 * ある置き方で完成グループができたら実際に消して先へ進む(全消しは消去必須なので
 * ここだけ消去ありで探索する)。盤面は必ず元へ戻す。
 */
function canEmptyBoard(board, clear, trio) {
  const snap = board.cells.slice();
  let hit = false, tries = 0;
  const TRY_CAP = 140;
  const dfs = (rem) => {
    if (hit || tries > TRY_CAP || opUsed > OP_CAP) return;
    for (let i = 0; i < rem.length; i++) {
      const p = rem[i];
      const pls = PL(board, p.cells);
      if (!pls.length) continue;
      // 消える量の多い置き方から試す(全消しへ最短で寄せる)
      if (pls.length <= 16) {
        for (const pos of pls) {
          board.place(p.cells, pos[0], pos[1], pos[2]);
          pos._cc = countClearCells(board, clear);
          board.unplace(p.cells, pos[0], pos[1], pos[2]);
        }
        pls.sort((a, b) => b._cc - a._cc);
      }
      const rest = rem.filter((_, j) => j !== i);
      const cap = Math.min(pls.length, BRANCH_CAP);
      for (let c = 0; c < cap && !hit; c++) {
        if (tries++ > TRY_CAP) break;
        const pos = pls[c];
        board.place(p.cells, pos[0], pos[1], pos[2]);
        const gs = board.completedGroups(clear);
        const cleared = gs.length ? board.clearLines(gs) : NONE;
        if (board.isEmptyBoard()) hit = true;
        else if (rest.length) dfs(rest);
        for (let t = 0; t < cleared.length; t++)
          board.set(cleared[t][0], cleared[t][1], cleared[t][2], 1);   // 消去を戻す
        board.unplace(p.cells, pos[0], pos[1], pos[2]);                // 設置を戻す
      }
      if (hit) return;
    }
  };
  dfs(trio);
  board.cells.set(snap);
  return hit;
}

/** 大消し(面まるごと / 複数ライン)できる解ける組を探す */
function findJackpotTrio(board, clear, placeable) {
  const M = Math.min(placeable.length, 10);
  if (M < 3) return null;
  const n = board.n;
  const threshold = clear === "plane" ? n * n : n * 2;   // 面1枚 or 2ライン相当以上
  let best = null, bestClear = threshold - 1, tries = 0;
  const combos = [];
  for (let i = 0; i < M; i++)
    for (let j = i + 1; j < M; j++)
      for (let k = j + 1; k < M; k++) combos.push([i, j, k]);
  shuffle(combos);
  for (const [i, j, k] of combos) {
    if (tries++ > 40 || opUsed > OP_CAP) break;
    const trio = [placeable[i], placeable[j], placeable[k]];
    if (!isSolvable(board, trio)) continue;
    const cc = evalTrioClears(board, clear, trio);
    if (cc > bestClear) { bestClear = cc; best = trio; if (cc >= n * n) break; }
  }
  return best;
}

/** trio を貪欲に(最も消える置き方で)置いたときの合計消去マス数。盤面は元に戻す */
function evalTrioClears(board, clear, trio) {
  const snap = board.cells.slice();
  let cleared = 0, ok = true;
  for (const p of trio) {
    const pls = PL(board, p.cells);
    if (!pls.length) { ok = false; break; }
    let bestPos = pls[0], bestCC = -1;
    for (const pos of pls) {
      board.place(p.cells, pos[0], pos[1], pos[2]);
      const cc = countClearCells(board, clear);
      board.unplace(p.cells, pos[0], pos[1], pos[2]);
      if (cc > bestCC) { bestCC = cc; bestPos = pos; }
    }
    board.place(p.cells, bestPos[0], bestPos[1], bestPos[2]);
    const groups = board.completedGroups(clear);
    if (groups.length) cleared += board.clearLines(groups).length;
  }
  board.cells.set(snap);
  return ok ? cleared : -1;
}

function countClearCells(board, clear) {
  const groups = board.completedGroups(clear);
  if (!groups.length) return 0;
  const seen = new Set();
  for (const g of groups) for (const c of g.cells) seen.add(board.idx(c[0], c[1], c[2]));
  return seen.size;
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

  // 完成間近のグループへの貢献を強めに評価 (r=充填率)。より賢く「その場で欲しい一手」を読む。
  let completes = 0;
  for (const [gid, g] of gain) {
    const gr = groups.list[gid];
    const r = gr.filled / gr.size;
    s += g * r * r * 4.5;                          // 完成間近ほど強く読む
    if (gr.filled + g === gr.size) { s += gr.size * 2.2; completes++; }  // そのまま完成する = 加点
  }
  if (completes >= 2) s += 7 * (completes - 1);    // 一手で複数グループ完成=特大の気持ちよさ

  s -= ay * 0.12;             // 低い場所を好む
  s += Math.random() * 0.6;   // 毎回同じ配給にならないよう揺らぎ (読みを効かせるため控えめ)
  return s;
}

const NB = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

// ---- 3ピースを置き切れる手順が存在するか (枝刈り付きDFS。消去は考えない安全側の判定) ----

function isSolvable(board, pieces) {
  const dfs = (rem) => {
    if (rem.length === 0) return true;
    if (opUsed > OP_CAP) return false;      // 予算切れ: これ以上は探さない(安全側=不可扱い)
    for (let i = 0; i < rem.length; i++) {
      const p = rem[i];
      const pl = PL(board, p.cells);
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

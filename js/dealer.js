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

const CANDIDATES = 20;      // 1回のディールで用意する候補ピース数
const GAP_CANDIDATES = 3;   // うち「空欄の形から作る」ピースの数(混ぜすぎると大味になる)
const BRANCH_CAP = 8;       // 解探索の枝刈り (1手あたり試す配置数)
const NO_FIT = -1e9;        // どこにも置けないピース

const BIGCLEAR_PROB = 0.09; // たまに「大きく消せる」ご褒美(面1枚/複数ライン)。出過ぎ防止でやや控えめ

// 「全消し(盤面まるごと空)」を狙う設定。モード別。
//  prob = 発火確率 / lo,hi = 狙う盤面充填率の帯 / pool,combos = 発火時の探索の厚み
//  全消しは「残りブロックを覆う線/面の空きを、ちょうど3ピースで埋められる」時しか成立しない。
//  計測すると成否は確率ではなく盤面の薄さでほぼ決まる:
//    残26マス超 → ほぼ0% / 残16マス以下 → 3〜5割 で成立
//  そこで帯を薄い盤面に絞り、そこでは高確率で狙いにいく。厚い盤面は空振りする上に
//  探索が重いだけなので、そもそも抽選しない(結果としてリフィルも速くなる)。
const FULLCLEAR = {
  line:  { prob: 0.92, lo: 0.016, hi: 0.132, pool: 26, combos: 26 },   // 残 2〜16マス
  plane: { prob: 0.92, lo: 0.016, hi: 0.208, pool: 26, combos: 26 },   // 残 2〜26マス
};

// 「完成間近をどれだけ強く狙うか」はモードで最適値が違う。
//  line : 1列=5マスで頻繁に消えるので、狙いを強くしすぎると盤面が荒れて寿命が縮む
//  plane: 1面=25マスで滅多に揃わないので、強く狙わないとそもそも消えない
// (A/B計測: line は弱め・plane は強めが、消去量と1ゲームの長さの両立に良かった)
const READ = {
  line:  { done: 1.9, doneR: 0.7, near1: 1.0, near2: 0.4, multi: 7.5 },
  plane: { done: 1.6, doneR: 1.8, near1: 2.4, near2: 1.1, multi: 8.0 },
};

// たまに「正解がほぼ一つしかない」難問を配る確率。最適解(と、せいぜいもう1通り)を
// 見つけられないと詰む組。ライン中心に、出過ぎないよう控えめに。
// 失敗しても詰み時の解の自動再生で「こう置けばよかった」が見られる。
const TIGHT_PROB = { line: 0.10, plane: 0.05 };
const TIGHT_MAX_WAYS = 2;   // 正解と認める並びの通り数の上限

// 「罠」の手を配る確率。置ける場所はたくさんあるのに、そのほとんどが
// 置いた瞬間に詰む — つまり簡単そうに見えて置き場所を間違えると死ぬ組。
// (難問=そもそも正解が少ない、とは別物。こちらは選択肢が多いのに大半が地雷)
// 盤面が薄いうちはどこに置いても安全なので罠は成立しない(計測: 生存率ほぼ100%)。
// 厚くなってきた局面に狙いを絞り、そこでは高めの確率で罠を出す。
const TRAP_MIN_FILL = 0.17;   // これ以上埋まっている時だけ罠を狙う
const TRAP_PROB = { line: 0.45, plane: 0.35 };
const TRAP_MAX_RATIO = 0.55;  // 生き残る手が全体のこれ以下なら「罠」とみなす
const TRAP_MIN_SPOTS = 6;     // 置ける場所がこれ以上ある(=簡単そうに見える)のが条件
const TRAP_SAMPLES = 6;       // 1ピースあたり調べる置き方の数
const TRAP_COMBOS = 6;        // 調べる組の数

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
export function dealHand(board, clear, makePiece, opts = {}) {
  opUsed = 0;   // このディールの探索予算をリセット
  const groups = collectGroups(board, clear);
  const filled = countFilled(board);
  const filledRatio = filled / board.cells.length;

  // ★ ごくたまに: 盤面をまるごと空にできる「全消し」手。埋まり具合が手頃な時だけ狙う。
  //   幾何的に不可能な盤面がほとんどなので、確率を掛けても実際に出るのはごく稀。
  //   plane は全消しが起きにくいので設定を厚くしてある(FULLCLEAR 参照)。
  const fcCfg = FULLCLEAR[clear] || FULLCLEAR.line;
  if (filledRatio >= fcCfg.lo && filledRatio <= fcCfg.hi
      && Math.random() < fcCfg.prob) {
    // まず「狙って構成」する(偶然に頼るより桁違いに当たる)。だめなら従来の抽選。
    const built = buildClearAllTrio(board, clear, makePiece);
    if (built) return markFullClear(shuffle(built.slice()));
    const fc = findClearAllTrio(board, clear, makePiece, fcCfg);
    if (fc) return markFullClear(shuffle(fc));
  }

  // ★ 段階的な全消し(クリアラン)。
  //   1手の3ピースで空にできる盤面はごく限られるので、そこに届かない時は
  //   「毎回きちんとブロックが減る手」を配り続けて、何手かかけて空へ向かわせる。
  //   一度この流れに入ったら (opts.runActive) 減らし続ける。減らせなくなったら流れは切れる。
  if (filled > 0 && (opts.runActive || shouldStartRun(clear, filled, filledRatio))) {
    // 基本は「確実にブロックが減る」組。始まったあとで減らせない場面では、
    // 「完成まであと何マス」を確実に縮める仕込みの手だけ許して流れを繋ぐ
    // (plane は 1面=25マス消しなので、毎手必ず減らすのは幾何的に無理がある)。
    const red = findReducingTrio(board, clear, makePiece, filled, !!opts.allowSetup);
    if (red) return markRun(shuffle(red.trio), red.left);
  }

  // 盤面が苦しいほど 1 に近づく。読みの重心を「気持ちよさ」から「助け舟」へ寄せる。
  const pressure = Math.max(0, Math.min(1, (filledRatio - 0.35) / 0.4));
  // 死に穴の判定はそこそこ重い。スカスカな盤面では死に穴がまず生じないので省く。
  const checkHoles = filledRatio >= 0.24;
  const rd = READ[clear] || READ.line;   // 読みの重み(モード別)

  for (let round = 0; round < 2; round++) {
    const cands = [];
    // 空欄の形から作るピースを少しだけ混ぜる。既存ブロックに面した隙間に
    // ぴったり収まる形なので「ここに入れてほしかった形だ」という気持ちよさが出る。
    // ただし入れすぎると全部ぴったりで大味になるので少数だけ。
    if (filled > 0) {
      const seeds = collectGapSeeds(board);   // 種の走査は1回だけ
      for (let i = 0; i < GAP_CANDIDATES; i++) {
        const g = growGapPiece(board, GAP_MIN + Math.floor(Math.random() * (GAP_MAX - GAP_MIN + 1)), seeds);
        if (g) cands.push(g.piece);
      }
    }
    for (let i = cands.length; i < CANDIDATES; i++) cands.push(makePiece());
    for (const p of cands) {
      const r = bestFit(board, groups, p, pressure, checkHoles, rd);
      p.fit = r.fit;
      p.target = r.target;     // 主に狙えるグループ (3つが同じ所を狙わないように使う)
      p.spots = r.spots;
    }
    const placeable = cands.filter((p) => p.fit > NO_FIT);
    placeable.sort((a, b) => b.fit - a.fit);   // はまり具合の良い順

    // ご褒美: たまに大きく消せる組 (埋まっているほど出やすい)
    if (Math.random() < BIGCLEAR_PROB * (0.4 + filledRatio)) {
      const jp = findJackpotTrio(board, clear, placeable);
      if (jp) return shuffle(jp);
    }

    // ★ たまに罠: 置ける場所は多いのに、大半の置き方が詰みに繋がる組
    if (filledRatio >= TRAP_MIN_FILL && opUsed < 900
        && Math.random() < (TRAP_PROB[clear] ?? 0)) {
      const tp = findTrapTrio(board, clear, placeable);
      if (tp) { tp.trap = true; return shuffle(tp); }
    }

    // ★ たまに難問: 最適解ともう1つぐらいしか正解が無い、外すと詰む組を配る
    if (opUsed < 900 && Math.random() < (TIGHT_PROB[clear] ?? 0)) {
      const tg = findTightTrio(board, placeable);
      if (tg) { tg.tight = true; return shuffle(tg); }
    }

    const trio = findSolvableTrio(board, placeable, filledRatio >= WAYS_MIN_FILL);
    if (trio) return shuffle(trio);
    if (round === 1 && placeable.length >= 3) return shuffle(placeable.slice(0, 3));
  }

  // ここまで来た = 既存の形の中に「3つとも置ける組」が無い。
  // 形の種類が足りないだけで詰ませるのはもったいないので、
  // いまの空きにぴったり収まる形を新しく作って配る(必ず置ける)。
  const made = synthesizeTrio(board);
  if (made) return made;

  // それでも駄目(空きが本当に無い)= 実質ゲームオーバー
  const last = [];
  for (let i = 0; i < CANDIDATES && last.length < 3; i++) last.push(makePiece());
  return last;
}

// ---- 空欄の形から作るピース ----
//
// 「消える所にはまる形」だけでなく、盤面の空きそのものを見て
// 「この隙間にぴったり入る形」を作る。既存ブロックに面しているほど気持ちいいので、
// 接触の多い空きから育てる。既存の形の種類に無い形でも作れるので、
// 「形が足りなくて詰む」ことがなくなる。

const GAP_MIN = 3, GAP_MAX = 6;   // 作る形の大きさ(マス数)の範囲
const GAP_SEEDS = 14;             // 種として試す空きセルの数

/**
 * 空きセルから連結した形を育てて、その形のピースを作る。
 * @returns {{piece:object, anchor:number[]}|null} piece と、そこにぴったり置ける位置
 */
function collectGapSeeds(board) {
  const n = board.n;
  const seeds = [];
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++)
      for (let z = 0; z < n; z++) {
        if (board.get(x, y, z)) continue;
        let touch = (y === 0) ? 1 : 0;
        for (const [dx, dy, dz] of NB) {
          const px = x + dx, py = y + dy, pz = z + dz;
          if (board.inBounds(px, py, pz) && board.get(px, py, pz)) touch++;
        }
        if (touch > 0) seeds.push({ c: [x, y, z], touch: touch + Math.random() });
      }
  seeds.sort((a, b) => b.touch - a.touch);   // よく面している所を優先(気持ちよさ)
  return seeds;
}

function growGapPiece(board, size, seedList) {
  // 支えのある空きセル(床 or 既存ブロックに面している)から育てる
  const seeds = seedList || collectGapSeeds(board);
  if (!seeds.length) return null;

  const lim = Math.min(seeds.length, GAP_SEEDS);
  for (let s = 0; s < lim; s++) {
    const cells = growFrom(board, seeds[s].c, size);
    if (cells.length < size) continue;
    // 元の位置そのままで置けるか(支えの条件を満たすか)を確認する
    const m = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
    const norm = cells.map((c) => [c[0] - m[0], c[1] - m[1], c[2] - m[2]]);
    if (!board.canPlace(norm, m[0], m[1], m[2])) continue;
    const span = [0, 1, 2].map((i) => Math.max(...norm.map((c) => c[i])) + 1);
    return {
      piece: { cells: norm, shape: shapeKey(norm), span },
      anchor: m,
    };
  }
  return null;
}

/** 空きセルを連結に育てる。既存ブロックに面しているセルを優先して伸ばす */
function growFrom(board, seed, size) {
  const chosen = [seed];
  const inSet = new Set([board.idx(...seed)]);
  while (chosen.length < size) {
    const cand = [];
    for (const [x, y, z] of chosen) {
      for (const [dx, dy, dz] of NB) {
        const px = x + dx, py = y + dy, pz = z + dz;
        if (!board.inBounds(px, py, pz)) continue;
        const k = board.idx(px, py, pz);
        if (inSet.has(k) || board.cells[k]) continue;
        let touch = (py === 0) ? 1 : 0;
        for (const [ex, ey, ez] of NB) {
          const qx = px + ex, qy = py + ey, qz = pz + ez;
          if (board.inBounds(qx, qy, qz) && board.get(qx, qy, qz)) touch++;
        }
        cand.push({ c: [px, py, pz], k, score: touch + Math.random() * 0.9 });
      }
    }
    if (!cand.length) break;
    cand.sort((a, b) => b.score - a.score);
    const pick = cand[0];
    chosen.push(pick.c);
    inSet.add(pick.k);
  }
  return chosen;
}

/** 形から一意な名前を作る (game 側の輪郭キャッシュが形ごとに正しく効くように) */
function shapeKey(cells) {
  return "fit:" + cells.map((c) => c.join("")).sort().join("_");
}

/**
 * いまの空きに収まる形を3つ作る。1つ置いた前提で次を作るので、
 * 「3つとも順に置ける」ことが構成上保証される(詰み回避の最後の砦)。
 */
function synthesizeTrio(board) {
  const snap = board.cells.slice();
  const trio = [];
  for (let i = 0; i < 3; i++) {
    // 少しずつ小さめも混ぜて、最後の1つが置けなくなるのを避ける
    const size = GAP_MIN + Math.floor(Math.random() * (GAP_MAX - GAP_MIN + 1)) - i;
    let got = null;
    for (let sz = Math.max(1, size); sz >= 1 && !got; sz--) got = growGapPiece(board, sz);
    if (!got) break;
    trio.push(got.piece);
    board.place(got.piece.cells, got.anchor[0], got.anchor[1], got.anchor[2]);
  }
  board.cells.set(snap);
  return trio.length === 3 ? shuffle(trio) : null;
}

/**
 * 3ピースが「別々の狙い」を持っているか (狙えるグループの種類数)。
 * 3つとも同じラインを狙う組は、1つ置いた時点で残り2つが用済みになって薄い。
 */
function distinctTargets(trio) {
  const t = new Set();
  for (const p of trio) if (p.target >= 0) t.add(p.target);
  return t.size;
}

/** この手が「全消しチャンス」であることをゲーム側へ伝える目印 */
function markFullClear(trio) {
  trio.fullClear = true;
  trio.clearRun = true;    // 全消しへ向かう流れの一部でもある
  return trio;
}

/** この手が「段階的な全消し」の途中(置けばブロックが減る)であることの目印 */
function markRun(trio, left) {
  trio.clearRun = true;
  trio.runLeft = left;     // うまく置いたときに残るブロック数(進捗表示用)
  return trio;
}

// ---- 段階的な全消し(クリアラン) ----

const RUN_START_PROB = { line: 0.06, plane: 0.22 };  // 流れに入る確率(1配給あたり)
// これより厚い盤面からは始めない。plane は面(25マス)単位でしか消えず盤面が厚めに
// 推移する(計測で平均5割超)ので、範囲を広く取らないとそもそも流れに入れない。
const RUN_MAX_FILL = { line: 0.32, plane: 0.66 };
// 流れを探すときの厚み。plane は 1面=25マスを仕上げないと減らせず条件が厳しいので厚めに。
const RUN_POOL = { line: 13, plane: 20 };
const RUN_TRIES = { line: 12, plane: 22 };

/** 全消しへ向かう流れを今から始めるか */
function shouldStartRun(clear, filled, filledRatio) {
  if (filled === 0) return false;
  const maxFill = RUN_MAX_FILL[clear] ?? RUN_MAX_FILL.line;
  if (filledRatio > maxFill) return false;
  const p = RUN_START_PROB[clear] ?? RUN_START_PROB.line;
  return Math.random() < p;
}

/**
 * 「3つとも置き切れて、しかも置いたあとブロックが確実に減る」組を探す。
 * 減り幅がいちばん大きい組を選ぶので、何手か続けるうちに盤面が空へ近づいていく。
 * 減らせる組が無ければ null (= 流れはここで途切れる)。
 * @returns {{trio:object[], left:number}|null} left = うまく置いたときの残りブロック数
 */
function findReducingTrio(board, clear, makePiece, filled, allowSetup) {
  const poolN = RUN_POOL[clear] ?? RUN_POOL.line;
  const triesCap = RUN_TRIES[clear] ?? RUN_TRIES.line;
  const pool = [];
  for (let i = 0; i < poolN; i++) {
    const p = makePiece();
    if (PL(board, p.cells).length) pool.push(p);
  }
  if (pool.length < 3) return null;
  // 単体で多く消せるピースを前に寄せて、良い組から先に試す
  for (const p of pool) p._cp = quickClearPotential(board, clear, p);
  pool.sort((a, b) => b._cp - a._cp);

  const M = Math.min(pool.length, 9);
  const budget = opUsed + 900;   // この探索だけの上限。リフィルが重くなりすぎないように
  let best = null, bestLeft = filled, tries = 0;
  // 仕込み用: 「いちばん完成に近いグループの残り穴」をどこまで縮められるか
  const holesNow = minGroupHoles(board, clear);
  let setup = null, setupHoles = holesNow;
  outer:
  for (let i = 0; i < M; i++)
    for (let j = i + 1; j < M; j++)
      for (let k = j + 1; k < M; k++) {
        if (++tries > triesCap || opUsed > budget || opUsed > OP_CAP) break outer;   // 予算切れは全ループを抜ける
        const trio = [pool[i], pool[j], pool[k]];
        if (!isSolvable(board, trio)) continue;      // 詰ませない保証は維持
        const left = bestReachableFill(board, clear, trio, filled);
        if (left < bestLeft) {                        // より薄くなる組を採用
          bestLeft = left;
          best = trio;
          if (left === 0) return { trio, left };      // そのまま全消しできるなら即決
        } else if (allowSetup && !best) {
          // 減らせないが「あと少しで消える」に近づける手なら、流れを繋ぐ仕込みとして拾う
          const h = holesAfterBest(board, clear, trio);
          if (h < setupHoles) { setupHoles = h; setup = trio; }
        }
      }
  if (best) return { trio: best, left: bestLeft };
  if (setup) return { trio: setup, left: filled };    // 仕込みの手(数は減らないが前進する)
  return null;
}

/** いちばん完成に近いグループの「残り穴」。小さいほど消えるのが近い */
function minGroupHoles(board, clear) {
  const gs = groupCellsOf(board, clear);
  let best = Infinity;
  for (const cells of gs) {
    let holes = 0;
    for (const k of cells) if (!board.cells[k]) holes++;
    if (holes > 0 && holes < best) best = holes;
  }
  return best === Infinity ? 0 : best;
}

/** trio を貪欲に置いたあとの minGroupHoles (盤面は元に戻す) */
function holesAfterBest(board, clear, trio) {
  const snap = board.cells.slice();
  for (const p of trio) {
    const pls = PL(board, p.cells);
    if (!pls.length) continue;
    let bestPos = pls[0], bestH = Infinity;
    const lim = Math.min(pls.length, 24);
    for (let i = 0; i < lim; i++) {
      const pos = pls[i];
      board.place(p.cells, pos[0], pos[1], pos[2]);
      const h = minGroupHoles(board, clear);
      board.unplace(p.cells, pos[0], pos[1], pos[2]);
      if (h < bestH) { bestH = h; bestPos = pos; }
    }
    board.place(p.cells, bestPos[0], bestPos[1], bestPos[2]);
    const gs = board.completedGroups(clear);
    if (gs.length) board.clearLines(gs);
  }
  const out = minGroupHoles(board, clear);
  board.cells.set(snap);
  return out;
}

/** グループ(ライン/面)のセル index 一覧 */
function groupCellsOf(board, clear) {
  const n = board.n;
  const out = [];
  if (clear === "plane") {
    for (let axis = 0; axis < 3; axis++)
      for (let f = 0; f < n; f++) {
        const cells = [];
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) cells.push(board.idx(...planeCell(axis, f, i, j)));
        out.push(cells);
      }
  } else {
    for (let axis = 0; axis < 3; axis++)
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n; b++) {
          const cells = [];
          for (let i = 0; i < n; i++) cells.push(board.idx(...axisCell(axis, i, a, b)));
          out.push(cells);
        }
  }
  return out;
}

/**
 * trio を消しながら置いたとき、到達できる最小のブロック数。
 * 3つとも置き切れる並びだけを見る(途中で置けなくなる並びは詰みなので数えない)。
 */
function bestReachableFill(board, clear, trio, current) {
  const snap = board.cells.slice();
  let best = Infinity, tries = 0;
  const dfs = (rem) => {
    if (tries > 28 || best === 0 || opUsed > OP_CAP) return;
    if (!rem.length) {
      const f = countFilled(board);
      if (f < best) best = f;
      return;
    }
    for (let i = 0; i < rem.length; i++) {
      const p = rem[i];
      const pls = PL(board, p.cells);
      if (!pls.length) continue;
      for (const pos of pls) {
        board.place(p.cells, pos[0], pos[1], pos[2]);
        pos._cc = countClearCells(board, clear);
        board.unplace(p.cells, pos[0], pos[1], pos[2]);
      }
      pls.sort((a, b) => b._cc - a._cc);          // よく消える置き方から
      const rest = rem.filter((_, j) => j !== i);
      const cap = Math.min(pls.length, BRANCH_CAP);
      for (let c = 0; c < cap; c++) {
        if (tries++ > 28 || best === 0) break;
        const pos = pls[c];
        board.place(p.cells, pos[0], pos[1], pos[2]);
        const gs = board.completedGroups(clear);
        const cleared = gs.length ? board.clearLines(gs) : NONE;
        dfs(rest);
        for (let t = 0; t < cleared.length; t++)
          board.set(cleared[t][0], cleared[t][1], cleared[t][2], 1);
        board.unplace(p.cells, pos[0], pos[1], pos[2]);
      }
    }
  };
  dfs(trio);
  board.cells.set(snap);
  return best === Infinity ? current : best;
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
    if (!tight) {
      // 序盤(スカスカ)は締まり吟味をしないが、3つが同じ所を狙う組だけは避ける
      if (distinctTargets(trio) >= 2) return trio;
      solvable.push({ trio, ways: WAYS_CAP + 1 });
      if (solvable.length >= SOLVABLE_POOL) break;
      continue;
    }
    const ways = countWays(board, trio, WAYS_CAP);
    if (ways <= 1 && distinctTargets(trio) >= 2) return trio;   // 一意かつ役割が散っている=最良
    solvable.push({ trio, ways });
    if (solvable.length >= SOLVABLE_POOL) break;
  }
  if (solvable.length) {
    // 通り数が少ない(締まった)組を優先しつつ、3つが別々の狙いを持つ組を上に置く。
    // 3つとも同じラインを狙う組は「1つ使ったら残り2つが余る」ので歯応えが薄い。
    solvable.sort((a, b) =>
      (a.ways - b.ways) || (distinctTargets(b.trio) - distinctTargets(a.trio)));
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
 * 「罠」の組を探す。
 * 置ける場所はたくさんあるのに、その大半が「置いた瞬間に残りが置けなくなる」組。
 * 簡単そうに見えて、置き場所を間違えると死ぬ = 判断が効く歯応え。
 * 生き残る手が1つも無い組は返さない(正解は必ず存在する)。
 */
function findTrapTrio(board, clear, placeable) {
  const P = placeable.length;
  if (P < 3) return null;
  // 「置ける場所が多い」ピースだけを対象にする(いかにも簡単そうに見える手にするため)
  const roomy = placeable.filter((p) => (p.spots ?? 0) >= TRAP_MIN_SPOTS);
  const pool = roomy.length >= 3 ? roomy : placeable;
  const M = Math.min(pool.length, 10);

  const combos = [];
  for (let i = 0; i < M; i++)
    for (let j = i + 1; j < M; j++)
      for (let k = j + 1; k < M; k++) combos.push([i, j, k]);
  shuffle(combos);

  const budget = opUsed + 1100;
  let best = null, bestRatio = Infinity, checked = 0;
  for (const [i, j, k] of combos) {
    if (checked++ > TRAP_COMBOS || opUsed > budget || opUsed > OP_CAP) break;
    const trio = [pool[i], pool[j], pool[k]];
    const q = trapQuality(board, clear, trio);
    // 盤面がまだ安全すぎる(どこに置いても死なない)なら、探しても無駄なので即やめる。
    // ライン中盤のような薄い盤面ではここで抜けるので、配給が重くならない。
    if (checked === 1 && q.total > 0 && q.ratio > 0.85) return null;
    if (q.safe === 0) continue;                 // 正解が無い組は配らない
    if (q.ratio <= TRAP_MAX_RATIO && q.ratio < bestRatio) {
      bestRatio = q.ratio;
      best = trio;
      if (q.ratio <= 0.12) break;               // 十分に罠。これ以上探さない
    }
  }
  return best;
}

/**
 * 罠の度合い: 最初の一手として選べる置き方のうち、
 * 「置いたあとも残り2つを置き切れる」ものがどれだけの割合か。
 * 消去も実際に起こして判定するので、遊んだときの挙動と一致する。
 * @returns {{total:number, safe:number, ratio:number}} ratio が小さいほど罠
 */
function trapQuality(board, clear, trio) {
  let total = 0, safe = 0;
  for (let i = 0; i < trio.length; i++) {
    const p = trio[i];
    const pls = PL(board, p.cells);
    if (!pls.length) return { total: 0, safe: 0, ratio: 1 };   // そもそも置けない=対象外
    const rest = trio.filter((_, j) => j !== i);
    const step = Math.max(1, Math.floor(pls.length / TRAP_SAMPLES));
    for (let n = 0; n < pls.length; n += step) {
      if (opUsed > OP_CAP) break;
      const pos = pls[n];
      total++;
      board.place(p.cells, pos[0], pos[1], pos[2]);
      const gs = board.completedGroups(clear);
      const cleared = gs.length ? board.clearLines(gs) : NONE;
      const ok = isSolvable(board, rest);
      for (let t = 0; t < cleared.length; t++)
        board.set(cleared[t][0], cleared[t][1], cleared[t][2], 1);
      board.unplace(p.cells, pos[0], pos[1], pos[2]);
      if (ok) safe++;
    }
  }
  return { total, safe, ratio: total ? safe / total : 1 };
}

/**
 * 「正解がほぼ一つしかない」難問の組を探す。
 * 3つを置き切れる並びが 1〜TIGHT_MAX_WAYS 通りしかない = 最適解(かもう1つ)を
 * 見つけられなければ詰む、という歯応えのある組。
 * 通り数 0(置き切れない)は詰み確定なので絶対に返さない = 詰み防止の保証は保つ。
 */
function findTightTrio(board, placeable, maxWays = TIGHT_MAX_WAYS) {
  const P = placeable.length;
  if (P < 3) return null;
  const M = Math.min(P, 12);
  const combos = [];
  for (let i = 0; i < M; i++)
    for (let j = i + 1; j < M; j++)
      for (let k = j + 1; k < M; k++) combos.push([i, j, k]);
  shuffle(combos);

  const budget = opUsed + 1100;   // 難問探索だけの上限(リフィルを重くしない)
  let fallback = null, checked = 0;
  for (const [i, j, k] of combos) {
    if (checked++ > 28 || opUsed > budget || opUsed > OP_CAP) break;
    const trio = [placeable[i], placeable[j], placeable[k]];
    const ways = countWays(board, trio, maxWays + 1);
    if (ways === 0) continue;              // 置き切れない組は配らない(保証)
    if (ways === 1) return trio;           // 正解がただ一つ = いちばん歯応えがある
    if (ways <= maxWays && !fallback) fallback = trio;
  }
  return fallback;
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
const TILE_POOL = 80;     // 敷き詰め探索に使う候補ピース数(形と向きを広く集める)
const TILE_MAX_GAP = 22;   // 埋めるべき空きがこれより広いと3ピースでは覆えない
const TILE_MAX_COVER = 14; // 覆いに使うグループ数の上限(本数より下の gap 量が本質)
const TILE_NODE_CAP = 4500;   // 「試した置き方」の総数上限 (内側ループ込みの実作業量)

/**
 * 全消しチャンスを「狙って構成する」。
 *
 * ランダムな3ピースが偶然に全消しになる確率は極めて低い(残りブロックを覆うのに
 * 必要なライン数が3ピースで完成できる本数を超えるため)。そこで逆算する:
 *   1. 残っているブロックを覆うグループ(ライン/面)の組を貪欲に求める
 *   2. その中の空きセル = 「ここを埋めれば全部消える」領域 を求める
 *   3. その領域をちょうど3ピースで敷き詰められる組を探す(最小未被覆セル優先のDFS)
 *   4. 見つけたら canEmptyBoard で「実際に消しながら空にできる」ことを確認する
 *      (途中で線が消えて崩れる並びもあるため、最終確認は必須)
 *
 * @returns {object[]|null} 全消しできる3ピース
 */
function buildClearAllTrio(board, clear, makePiece) {
  const n = board.n;
  const filled = [];
  for (let x = 0; x < n; x++)
    for (let y = 0; y < n; y++)
      for (let z = 0; z < n; z++)
        if (board.get(x, y, z)) filled.push(board.idx(x, y, z));
  if (!filled.length) return null;

  // グループ(ライン or 面)ごとのセル一覧
  const groups = [];
  if (clear === "plane") {
    for (let axis = 0; axis < 3; axis++)
      for (let f = 0; f < n; f++) {
        const cells = [];
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) cells.push(board.idx(...planeCell(axis, f, i, j)));
        groups.push(cells);
      }
  } else {
    for (let axis = 0; axis < 3; axis++)
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n; b++) {
          const cells = [];
          for (let i = 0; i < n; i++) cells.push(board.idx(...axisCell(axis, i, a, b)));
          groups.push(cells);
        }
  }

  // 候補ピース(回転違いを広く。形+向きで重複を除く)
  const pool = [];
  const seen = new Set();
  for (let i = 0; i < TILE_POOL; i++) {
    const p = makePiece();
    const sig = p.cells.map((c) => c.join(",")).sort().join("|");
    if (seen.has(sig)) continue;
    seen.add(sig);
    pool.push(p);
  }
  if (pool.length < 3) return null;

  // 覆い方を数通り試す。狙いは「本数を減らす」ことではなく「埋める空きを小さくする」こと。
  //  → すでにほぼ埋まっている線(足す空きが少ない線)を優先する貪欲。
  //    ランダムなタイブレークで毎回わずかに違う覆いを試し、別解を狙う。
  for (let attempt = 0; attempt < 3; attempt++) {
    if (opUsed > OP_CAP) break;   // 予算切れ: 全消しは諦めて通常配給へ
    const need = new Set(filled);
    const gapSet = new Set();
    let ok = true;
    for (let step = 0; need.size && step < TILE_MAX_COVER; step++) {
      let best = null, bestScore = -Infinity;
      for (const g of groups) {
        let gain = 0, add = 0, ySum = 0, yN = 0;
        for (const k of g) {
          if (need.has(k)) gain++;
          else if (!board.cells[k] && !gapSet.has(k)) {
            add++;
            ySum += Math.floor(k / n) % n;   // 埋めることになる空きの高さ
            yN++;
          }
        }
        if (!gain) continue;
        // 覆える数が多く、新たに埋める空きが少ないほど良い。
        // さらに空きが低い位置(床や既存ブロックに支えられる所)にあるものを優先する。
        // 宙に浮いた空きは「支え」の制約で実際には置けず、全消しが成立しないため。
        const avgY = yN ? ySum / yN : 0;
        const score = gain / (1 + add) - avgY * 0.35 + Math.random() * 0.15;
        if (score > bestScore) { bestScore = score; best = g; }
      }
      if (!best) { ok = false; break; }
      for (const k of best) {
        need.delete(k);
        if (!board.cells[k]) gapSet.add(k);
      }
      if (gapSet.size > TILE_MAX_GAP) { ok = false; break; }   // 埋めきれない
    }
    if (!ok || need.size || !gapSet.size || gapSet.size > TILE_MAX_GAP) continue;

    // 空きが4つ以上に分断されていると、連結した3ピースでは埋めきれない(早期棄却)
    if (countComponents(board, gapSet) > 3) continue;

    // 戦略A: 空きをちょうど3ピースで敷き詰める(きっちり埋まる=確実に全部消える)
    // 同じ候補が2枠に入ると手札が同一オブジェクトを共有してしまうので必ず複製する
    const tiled = tileExactly(board, pool, gapSet);
    if (tiled) {
      const fresh = tiled.map(clonePiece);
      if (canEmptyBoard(board, clear, fresh)) return fresh;
    }

    // 戦略B: 空きの中に収まるピースを集め、その組合せを「消しながら」検証する。
    // 途中で線が消えれば残りは減るので、きっちり敷き詰めなくても空にできることがある。
    const fitters = piecesFittingGap(board, pool, gapSet);
    if (fitters.length >= 3) {
      const M = Math.min(fitters.length, 9);
      let tries = 0;
      for (let i = 0; i < M; i++)
        for (let j = i + 1; j < M; j++)
          for (let k = j + 1; k < M; k++) {
            if (++tries > 8 || opUsed > OP_CAP) break;
            const cand = [fitters[i], fitters[j], fitters[k]].map(clonePiece);
            if (canEmptyBoard(board, clear, cand)) return cand;
          }
    }
  }
  return null;
}

/** 空き領域が何個の塊に分かれているか (連結成分数) */
function countComponents(board, gapSet) {
  const n = board.n;
  const seen = new Set();
  let comps = 0;
  for (const start of gapSet) {
    if (seen.has(start)) continue;
    comps++;
    if (comps > 3) return comps;   // 早期打ち切り
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop();
      const x = k % n, y = Math.floor(k / n) % n, z = Math.floor(k / (n * n));
      for (const [dx, dy, dz] of NB) {
        const px = x + dx, py = y + dy, pz = z + dz;
        if (!board.inBounds(px, py, pz)) continue;
        const nk = board.idx(px, py, pz);
        if (gapSet.has(nk) && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
  }
  return comps;
}

/**
 * 空き領域の中にすっぽり収まる置き方がある候補ピースを、埋める量の多い順に集める。
 * 盤面全体を走査せず「空きセルにピースのどこかを合わせる」だけ試すので軽い。
 */
function piecesFittingGap(board, pool, gapSet) {
  const n = board.n;
  const gapList = [...gapSet];
  const out = [];
  for (const p of pool) {
    if (p.cells.length > gapSet.size) continue;
    let fits = false;
    for (const k of gapList) {
      if (fits) break;
      const tx = k % n, ty = Math.floor(k / n) % n, tz = Math.floor(k / (n * n));
      for (const [ox, oy, oz] of p.cells) {
        const ax = tx - ox, ay = ty - oy, az = tz - oz;
        if (ax < 0 || ay < 0 || az < 0) continue;
        let all = true;
        for (const [dx, dy, dz] of p.cells) {
          const x = ax + dx, y = ay + dy, z = az + dz;
          if (x >= n || y >= n || z >= n || !gapSet.has(board.idx(x, y, z))) { all = false; break; }
        }
        if (all) { fits = true; break; }
      }
    }
    if (fits) out.push(p);
    if (out.length >= 9) break;   // 組合せは上位だけ試すので集めすぎない
  }
  out.sort((a, b) => b.cells.length - a.cells.length);   // 大きく埋められるものを先に
  return out;
}

function clonePiece(p) {
  return { cells: p.cells.map((c) => c.slice()), shape: p.shape, span: p.span.slice() };
}

/**
 * 空き領域 gapSet を「ちょうど3ピース」で過不足なく敷き詰める組を探す。
 * 最小の未被覆セルを必ず覆う手だけを試す(exact cover の定石)ので枝が絞れる。
 * @returns {object[]|null}
 */
function tileExactly(board, pool, gapSet) {
  const n = board.n;
  const remain = new Set(gapSet);
  const chosen = [];
  let nodes = 0;

  const idxToXyz = (k) => [k % n, Math.floor(k / n) % n, Math.floor(k / (n * n))];

  const dfs = () => {
    // nodes は「試した置き方」を数える。DFS の呼び出し回数だけでは
    // 候補×合わせ方の内側ループ(数十万回になりうる)を抑えられないため。
    if (nodes > TILE_NODE_CAP) return false;
    if (remain.size === 0) return chosen.length === 3;
    if (chosen.length === 3) return false;

    // 未被覆のうち最小 index のセルを必ず覆う
    let target = -1;
    for (const k of remain) if (target < 0 || k < target) target = k;
    const [tx, ty, tz] = idxToXyz(target);

    for (const p of pool) {
      if (p.cells.length > remain.size) continue;
      // ピースのどのセルを target に合わせるか
      for (const [ox, oy, oz] of p.cells) {
        if (nodes++ > TILE_NODE_CAP) return false;
        const ax = tx - ox, ay = ty - oy, az = tz - oz;
        if (ax < 0 || ay < 0 || az < 0) continue;
        let fits = true;
        const ks = [];
        for (const [dx, dy, dz] of p.cells) {
          const x = ax + dx, y = ay + dy, z = az + dz;
          if (x >= n || y >= n || z >= n) { fits = false; break; }
          const k = board.idx(x, y, z);
          if (!remain.has(k)) { fits = false; break; }
          ks.push(k);
        }
        if (!fits) continue;
        for (const k of ks) remain.delete(k);
        chosen.push(p);
        if (dfs()) return true;
        chosen.pop();
        for (const k of ks) remain.add(k);
      }
    }
    return false;
  };

  return dfs() ? chosen.slice() : null;
}

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
 * いまの盤面と手持ちで「盤面をまるごと空(全消し)」にできる並びがまだ残っているか。
 * ゲーム側が「全消しチャンス」の告知を出す/引っ込めるのに使う。
 * 配給時だけでなく1手ごとに呼べるよう、探索は canEmptyBoard の枝刈り予算内で打ち切る。
 * (ディーラーが仕込んだチャンスは同じ探索で見つけたものなので、正しく置いている限り
 *  次の手でも見つかる。置き方を誤ってチャンスが消えたら false になる)
 * @returns {boolean}
 */
export function canClearAll(board, clear, pieces) {
  const live = pieces.filter(Boolean);
  if (!live.length || board.isEmptyBoard()) return false;
  opUsed = 0;   // 単発チェックなので予算をリセットして与える
  // 配給1回で何度も回す用途より探索を厚くする。ここをケチると
  // ディーラーが仕込んだチャンスを告知側が取りこぼす(=気づけない)。
  return canEmptyBoard(board, clear, live, 700);
}

/**
 * trio を「消しながら」順に置いて、途中または最後に盤面が空になる並びがあるか。
 * ある置き方で完成グループができたら実際に消して先へ進む(全消しは消去必須なので
 * ここだけ消去ありで探索する)。盤面は必ず元へ戻す。
 */
function canEmptyBoard(board, clear, trio, tryCap = 140) {
  const snap = board.cells.slice();
  let hit = false, tries = 0;
  const TRY_CAP = tryCap;
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

/**
 * ピースの「その場面での欲しさ」を測る。
 * 最良の置き方のスコアに加えて、盤面が苦しいときは「置ける場所の多さ(=逃げ道)」も見る。
 * これで、詰まりかけの場面では融通の利くピースが自然に混ざるようになる。
 * @param {number} pressure 0=余裕 1=苦しい
 * @returns {{fit:number, target:number, spots:number}}
 */
function bestFit(board, groups, piece, pressure = 0, checkHoles = false, rd = READ.line) {
  const n = board.n;
  const [sx, sy, sz] = piece.span;
  let best = NO_FIT, target = -1, spots = 0;
  for (let x = 0; x <= n - sx; x++)
    for (let y = 0; y <= n - sy; y++)
      for (let z = 0; z <= n - sz; z++) {
        if (!board.canPlace(piece.cells, x, y, z)) continue;
        spots++;
        const r = placementScore(board, groups, piece, x, y, z, checkHoles, rd);
        if (r.score > best) { best = r.score; target = r.target; }
      }
  if (best === NO_FIT) return { fit: NO_FIT, target: -1, spots: 0 };
  // 苦しいほど「置き場所が多いピース」を高く評価する(助け舟。余裕がある時は効かせない)
  const flex = Math.min(spots, 40) / 40;
  return { fit: best + pressure * flex * 3.2, target, spots };
}

/**
 * 「この置き方はどれくらい欲しい一手か」を読む。
 * 単に隙間に合うかではなく、盤面がいま何を必要としているかまで見る:
 *   - あと少しのライン/面を、残り穴数が少ないものほど強く狙う(=痒い所に手が届く)
 *   - 一手で複数そろう置き方は特大評価
 *   - 置いた結果ふさがって二度と埋められなくなる空き(死に穴)を作るなら大きく減点
 *   - 次の一手のお膳立て(置いた後に「残り1〜2マス」のグループができる)も評価
 * @returns {{score:number, target:number}} target = 最も貢献したグループid (組の重複回避用)
 */
function placementScore(board, groups, piece, ax, ay, az, checkHoles, rd) {
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

  // 死に穴を作らないか: このピースの周りにできる「まわりを全部ふさがれた空き」を数える。
  // そういう空きは後から埋められず、盤面をじわじわ殺すので強く避ける。
  // スカスカな盤面ではまず生じないので、その時は走らせない(配給を軽く保つため)。
  if (checkHoles) s -= 2.2 * countBuriedHoles(board, piece, own, ax, ay, az);

  // 完成間近のグループへの貢献を評価 (r=充填率)。残り穴が少ないほど「今まさに欲しい」。
  let completes = 0, target = -1, bestGain = 0;
  for (const [gid, g] of gain) {
    const gr = groups.list[gid];
    const r = gr.filled / gr.size;
    const left = gr.size - gr.filled;             // 完成まであと何マスか
    s += g * r * r * 4.5;
    if (g > bestGain) { bestGain = g; target = gid; }
    if (gr.filled + g === gr.size) {
      // そのまま完成。あと少しだったものほど「かゆい所に手が届いた」感が強い
      s += gr.size * (rd.done + rd.doneR * r);
      completes++;
    } else {
      // お膳立て: 置いたあと残り1〜2マスになるなら次の一手が見えて気持ちいい
      const after = left - g;
      if (after === 1) s += rd.near1;
      else if (after === 2) s += rd.near2;
    }
  }
  if (completes >= 2) s += rd.multi * (completes - 1);   // 一手で複数そろう = 特大

  s -= ay * 0.12;             // 低い場所を好む
  s += Math.random() * 0.6;   // 毎回同じ配給にならないよう揺らぎ (読みを効かせるため控えめ)
  return { score: s, target };
}

/**
 * ピースを置いたときにできる「まわりを完全にふさがれた空きマス」の数。
 * ピース周辺だけ見るので軽い。盤面は変更しない(own= これから埋まるマス として扱う)。
 */
function countBuriedHoles(board, piece, own, ax, ay, az) {
  const checked = new Set();
  let buried = 0;
  for (const [dx, dy, dz] of piece.cells) {
    const x = ax + dx, y = ay + dy, z = az + dz;
    for (const [nx, ny, nz] of NB) {
      const px = x + nx, py = y + ny, pz = z + nz;
      if (!board.inBounds(px, py, pz)) continue;
      const k = board.idx(px, py, pz);
      if (checked.has(k) || own.has(k) || board.cells[k]) continue;   // 空きだけ見る
      checked.add(k);
      let open = 0;
      for (const [mx, my, mz] of NB) {
        const qx = px + mx, qy = py + my, qz = pz + mz;
        if (!board.inBounds(qx, qy, qz)) continue;                    // 壁は塞がり扱い
        const q = board.idx(qx, qy, qz);
        if (!board.cells[q] && !own.has(q)) open++;
      }
      if (open === 0) buried++;
    }
  }
  return buried;
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
 * 現在の手札を置き切る手順のうち「いちばん点が高くなる」ものを探す。
 * 消去を実際にシミュレートするので、ラインや面がそろう置き方が自然に選ばれる。
 * これを「最適解」として good の判定に使う(=ブロックが消える気持ちいい所が正解になる)。
 *
 * @param {object} score config.js の SCORE
 * @param {number} combo 現在の連続クリア数 (コンボ加点の計算に使う)
 * @returns {{steps:{piece,pos:[x,y,z]}[], points:number}} 置く順の配列と合計点
 */
export function solveHandBest(board, clear, pieces, score, combo = 0) {
  const live = pieces.filter(Boolean);
  if (!live.length) return { steps: [], points: 0 };

  let best = { steps: [], points: -1 };
  let nodes = 0;
  const NODE_CAP = 2600;
  const TOP = 10;            // 1ピースあたり試す置き方 (消える所を優先して上位だけ)

  const dfs = (rem, path, pts, cmb) => {
    if (path.length > best.steps.length ||
        (path.length === best.steps.length && pts > best.points)) {
      best = { steps: path.slice(), points: pts };
    }
    if (!rem.length || nodes > NODE_CAP) return;

    for (let i = 0; i < rem.length; i++) {
      const p = rem[i];
      const pls = board.allPlacements(p.cells);
      if (!pls.length) continue;
      // 消える量が多い置き方から試す(高得点の枝を先に見る)
      for (const pos of pls) {
        board.place(p.cells, pos[0], pos[1], pos[2]);
        const g = board.completedGroups(clear);
        pos._cc = g.length ? countClearCells(board, clear) : 0;
        pos._g = g.length;
        board.unplace(p.cells, pos[0], pos[1], pos[2]);
      }
      pls.sort((a, b) => (b._cc - a._cc) || (a[1] - b[1]));
      const rest = rem.filter((_, j) => j !== i);
      const cap = Math.min(pls.length, TOP);
      for (let k = 0; k < cap; k++) {
        if (nodes++ > NODE_CAP) return;
        const pos = pls[k];
        board.place(p.cells, pos[0], pos[1], pos[2]);
        let gained = p.cells.length * score.perPlacedCell;
        let nextCombo = cmb;
        const groups = board.completedGroups(clear);
        let cleared = NONE;
        if (groups.length) {
          nextCombo = cmb + 1;
          cleared = board.clearLines(groups);
          gained += cleared.length * score.perClearedCell * groups.length
            + (groups.length > 1 ? score.multiLineBonus * (groups.length - 1) : 0)
            + (nextCombo > 1 ? score.comboBonus * nextCombo : 0);
          // 盤面がまるごと空になる手は最大のご褒美。最適解が自然と全消しを目指すようになる。
          if (board.isEmptyBoard()) gained += score.fullClearBonus || 0;
        } else {
          nextCombo = 0;
        }
        // 同点なら盤面が薄くなる方を選ぶ(全消しへ向かう流れを保つための小さな傾き)
        gained += (board.cells.length - countFilled(board)) * 0.02;
        path.push({ piece: p, pos: [pos[0], pos[1], pos[2]] });
        dfs(rest, path, pts + gained, nextCombo);
        path.pop();
        for (let t = 0; t < cleared.length; t++)
          board.set(cleared[t][0], cleared[t][1], cleared[t][2], 1);   // 消去を戻す
        board.unplace(p.cells, pos[0], pos[1], pos[2]);
      }
    }
  };

  const snap = board.cells.slice();
  dfs(live, [], 0, combo);
  board.cells.set(snap);
  return best;
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

// ========================== 3Dblocks 設定 ==========================

// アプリのバージョン (マージのたびに +0.1)
export const APP_VERSION = "3.2";

// グリッドの一辺 (既定)
export const GRID_N = 5;

// ゲームモード (どちらも 5×5×5)
//  line : 1軸そろえる = 1列(5マス)消し。全ピース(3×3×3含む)
//  plane: 2軸そろえる = 1面(5×5=25マス)消し。
//         面を埋めやすいよう大きすぎるピース(9マス超)は除外する
// grid / maxCells はモードごとに変更可能。clear は "line" か "plane"。
export const MODES = {
  line:  { key: "line",  grid: 5, clear: "line",  maxCells: Infinity, label: "ライン",   sub: "1列そろえる · 5³" },
  plane: { key: "plane", grid: 5, clear: "plane", maxCells: 9,        label: "プレーン", sub: "1面そろえる · 5³" },
};
export const DEFAULT_MODE = "line";

// ---- オンライン世界ランキング ----
// Firebase Realtime Database の URL を1行設定すると有効になる。
// 未設定 ("") のままなら「この端末のランキング」のみで動作する。
// セットアップ手順は README.md を参照。
export const RANKING = {
  endpoint: "https://dblock-9f767-default-rtdb.firebaseio.com/",           //例: "https://blocks3d-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app"
  path: "blocks3d/v1",      // データベース内の保存先
  limit: 100,               // 取得する上位件数
};

// ---- トーン (色合い) ----
//
// ブロックの柄(ストライプ/ドット)は廃止して、色合いそのものをご褒美にした。
// 1トーン = 「同じ色family の8色 + その色に合う舞台(ドーム)」のセット。
// スコアが TONE_STEP を超えるたびに次のトーンへ切り替わり、
// ドームも、場のブロックも、ネクストのピースもまとめてその色合いに変わる。
//
// 色は base(面色)だけ書けばよい。発光色と輪郭色は自動で作る。
// 新しいトーンを足したいときは TONES に1つ追加するだけ。

const mix = (hex, target, k) => {
  const r = (hex >> 16) & 255, g = (hex >> 8) & 255, b = hex & 255;
  const tr = (target >> 16) & 255, tg = (target >> 8) & 255, tb = target & 255;
  const m = (a, t) => Math.round(a + (t - a) * k);
  return (m(r, tr) << 16) | (m(g, tg) << 8) | m(b, tb);
};
const palette = (bases) => bases.map((base) => ({
  base,
  emissive: mix(base, 0x000000, 0.45),   // 発光は暗めに落とした同系色
  edge: mix(base, 0xffffff, 0.72),       // 輪郭は明るめ
}));

export const TONES = [
  {
    key: "daylight", label: "デイライト",
    // ドーム(背景グラデーション)と舞台の色
    dome: ["#ffffff", "#f5f5f7", "#ececf0"],
    floor: 0xf0f0f3, grid: 0xc7c7cc, cage: 0xc7c7cc,
    palette: palette([
      0xff3b6b, 0xff8a2b, 0xffd23e, 0x35d86b,
      0x26d3e6, 0x3b82ff, 0x9b6bff, 0xff5bd0,
    ]),
  },
  {
    key: "sunset", label: "サンセット",
    dome: ["#fffaf2", "#ffeedd", "#ffd9be"],
    floor: 0xfaeade, grid: 0xe8c8ab, cage: 0xe8c8ab,
    palette: palette([
      0xff6b5a, 0xff9068, 0xffb03a, 0xffd24a,
      0xff5f9e, 0xe2603c, 0xff8f7a, 0xc65fa0,
    ]),
  },
  {
    key: "ocean", label: "オーシャン",
    dome: ["#f6feff", "#e2f6fd", "#c9ecf8"],
    floor: 0xe9f6fb, grid: 0xa8cfe0, cage: 0xa8cfe0,
    palette: palette([
      0x1fc8db, 0x16b3a0, 0x3ba7ff, 0x2f6fe0,
      0x4fe0b0, 0x1f8fd8, 0x7f9bff, 0x27d6c4,
    ]),
  },
  {
    key: "forest", label: "フォレスト",
    dome: ["#fbfff7", "#eaf7e2", "#d7edcb"],
    floor: 0xeef8e8, grid: 0xb6d4a6, cage: 0xb6d4a6,
    palette: palette([
      0x3fbf5f, 0x8fd633, 0x5fa04a, 0x46d9a0,
      0xa8b93a, 0x2f8f63, 0x6fcf5f, 0xc9c24a,
    ]),
  },
  {
    key: "twilight", label: "トワイライト",
    dome: ["#fdfaff", "#f0e9fd", "#ded1f6"],
    floor: 0xf3edfc, grid: 0xc3b2e6, cage: 0xc3b2e6,
    palette: palette([
      0x8a5cf6, 0x5b6ef0, 0xe05bd0, 0xb06fe8,
      0x7f8ff5, 0xd16fe0, 0x9350c8, 0xf06ba8,
    ]),
  },
  {
    key: "citrus", label: "シトラス",
    dome: ["#fffef4", "#fdf6d9", "#f8ebbb"],
    floor: 0xfbf5df, grid: 0xdfd09a, cage: 0xdfd09a,
    palette: palette([
      0xffd83a, 0xff9f2e, 0xb7e02f, 0xff7a3a,
      0xffc65e, 0x7fd12f, 0xff6f61, 0xffab45,
    ]),
  },
];

// 何点ごとに次のトーンへ進むか。1列消し(ライン)と1面消し(プレーン)では
// 点の入り方が桁違いなのでモード別に持つ (計測した中央値で3〜6回変わる程度)。
export const TONE_STEP = { line: 4000, plane: 250 };

// スコア (8×8×8 は1列8マスと重いので消去報酬を高めに)
export const SCORE = {
  perPlacedCell: 5,     // 置いた1マスあたり
  perClearedCell: 12,   // 消えた1マスあたり (×ライン数)
  multiLineBonus: 120,  // 2ライン目以降、1ラインごとの追加ボーナス
  comboBonus: 50,       // 連続クリア1回ごとの追加ボーナス
  fullClearBonus: 800,  // 盤面をまるごと空にした(全消し)ときの特大ボーナス
};

export const STORAGE_PREFIX = "blocks3d.";

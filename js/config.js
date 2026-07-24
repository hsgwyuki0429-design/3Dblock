// ========================== 3Dblocks 設定 ==========================

// アプリのバージョン (マージのたびに +0.1)
export const APP_VERSION = "1.0";

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

// ピースの配色パレット。各ピースはここから1色を持つ (base=面色 / emissive=発光 / edge=輪郭)
export const PALETTE = [
  { base: 0xff3b6b, emissive: 0xb3103f, edge: 0xffd0dc },  // レッドピンク
  { base: 0xff8a2b, emissive: 0xb34d00, edge: 0xffe0c0 },  // オレンジ
  { base: 0xffd23e, emissive: 0xb38600, edge: 0xfff2c0 },  // ゴールド
  { base: 0x35d86b, emissive: 0x0f9e42, edge: 0xc6ffd8 },  // グリーン
  { base: 0x26d3e6, emissive: 0x0a95a6, edge: 0xc6f6ff },  // シアン
  { base: 0x3b82ff, emissive: 0x0f47c2, edge: 0xcfe0ff },  // ブルー
  { base: 0x9b6bff, emissive: 0x5f2fd6, edge: 0xe2d6ff },  // パープル
  { base: 0xff5bd0, emissive: 0xc21797, edge: 0xffd6f4 },  // マゼンタ
];

// スコア (8×8×8 は1列8マスと重いので消去報酬を高めに)
export const SCORE = {
  perPlacedCell: 5,     // 置いた1マスあたり
  perClearedCell: 12,   // 消えた1マスあたり (×ライン数)
  multiLineBonus: 120,  // 2ライン目以降、1ラインごとの追加ボーナス
  comboBonus: 50,       // 連続クリア1回ごとの追加ボーナス
};

export const STORAGE_PREFIX = "blocks3d.";

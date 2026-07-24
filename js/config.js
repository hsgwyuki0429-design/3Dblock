// ========================== 3Dblocks 設定 ==========================

// アプリのバージョン (マージのたびに +0.1)
export const APP_VERSION = "1.5";

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
// v1.5: モダンな宝石トーンに刷新 (ダーク背景で映える)
export const PALETTE = [
  { base: 0xff6b6b, emissive: 0x8f2626, edge: 0xffd4d4 },  // コーラル
  { base: 0xfbbf24, emissive: 0x8a5a06, edge: 0xffe9b0 },  // アンバー
  { base: 0xa3e635, emissive: 0x4d7c0f, edge: 0xe6ffb0 },  // ライム
  { base: 0x34d399, emissive: 0x0e6b49, edge: 0xc0ffe6 },  // エメラルド
  { base: 0x2dd4bf, emissive: 0x0c6b61, edge: 0xbdf7ef },  // ティール
  { base: 0x38bdf8, emissive: 0x0a6591, edge: 0xc7ecff },  // スカイ
  { base: 0x818cf8, emissive: 0x3438a0, edge: 0xdcdfff },  // インディゴ
  { base: 0xe879f9, emissive: 0x8a1c9e, edge: 0xf7d4ff },  // フクシア
];

// スコア (8×8×8 は1列8マスと重いので消去報酬を高めに)
export const SCORE = {
  perPlacedCell: 5,     // 置いた1マスあたり
  perClearedCell: 12,   // 消えた1マスあたり (×ライン数)
  multiLineBonus: 120,  // 2ライン目以降、1ラインごとの追加ボーナス
  comboBonus: 50,       // 連続クリア1回ごとの追加ボーナス
};

export const STORAGE_PREFIX = "blocks3d.";

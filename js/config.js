// ========================== ツミボシ 設定 ==========================

// グリッドの一辺 (3〜5)
export const GRID_N = 4;

// ---- オンライン世界ランキング ----
// Firebase Realtime Database の URL を1行設定すると有効になる。
// 未設定 ("") のままなら「この端末のランキング」のみで動作する。
// セットアップ手順は README.md を参照。
export const RANKING = {
  endpoint: "https://dblock-9f767-default-rtdb.firebaseio.com/",           //例: "https://blocks3d-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app"
  path: "blocks3d/v1",      // データベース内の保存先
  limit: 100,               // 取得する上位件数
};

// 面の向きごとの色 (XZ=水平 / XY=正面 / YZ=側面)
// シングルブルー基調: 同系統ブルーの明度差だけで向きを示す (一色を基調とするミニマル)
export const PLANE_COLORS = {
  XZ: { base: 0x0a84ff, emissive: 0x0a84ff, edge: 0x0a3d78 },  // ブルー(標準)
  XY: { base: 0x3ba3ff, emissive: 0x3ba3ff, edge: 0x125088 },  // ブルー(明)
  YZ: { base: 0x0060d6, emissive: 0x0060d6, edge: 0x08305e },  // ブルー(濃)
};

// スコア
export const SCORE = {
  perPlacedCell: 5,     // 置いた1マスあたり
  perClearedCell: 10,   // 消えた1マスあたり (×ライン数)
  multiLineBonus: 60,   // 2ライン目以降、1ラインごとの追加ボーナス
  comboBonus: 25,       // 連続クリア1回ごとの追加ボーナス
};

export const STORAGE_PREFIX = "blocks3d.";

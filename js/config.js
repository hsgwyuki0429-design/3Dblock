// ========================== ツミボシ 設定 ==========================

// グリッドの一辺 (3〜5)
export const GRID_N = 4;

// ---- オンライン世界ランキング ----
// Firebase Realtime Database の URL を1行設定すると有効になる。
// 未設定 ("") のままなら「この端末のランキング」のみで動作する。
// セットアップ手順は README.md を参照。
export const RANKING = {
  endpoint: "",             // 例: "https://blocks3d-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app"
  path: "blocks3d/v1",      // データベース内の保存先
  limit: 100,               // 取得する上位件数
};

// 面の向きごとの色 (XZ=水平 / XY=正面 / YZ=側面)
// キャンディ・ネオン: 高彩度で最大限にポップに、白エッジで輪郭を立てる
export const PLANE_COLORS = {
  XZ: { base: 0xffc300, emissive: 0xff7a00, edge: 0xfff6c0 },  // ゴールド
  XY: { base: 0x18e0ff, emissive: 0x00a2d6, edge: 0xffffff },  // エレクトリックシアン
  YZ: { base: 0xff2e88, emissive: 0xd6006a, edge: 0xffd9ec },  // ホットマゼンタ
};

// スコア
export const SCORE = {
  perPlacedCell: 5,     // 置いた1マスあたり
  perClearedCell: 10,   // 消えた1マスあたり (×ライン数)
  multiLineBonus: 60,   // 2ライン目以降、1ラインごとの追加ボーナス
  comboBonus: 25,       // 連続クリア1回ごとの追加ボーナス
};

export const STORAGE_PREFIX = "blocks3d.";

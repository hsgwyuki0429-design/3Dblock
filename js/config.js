// ========================== ツミボシ 設定 ==========================

// グリッドの一辺 (3〜5)
export const GRID_N = 4;

// ---- オンライン世界ランキング ----
// Firebase Realtime Database の URL を1行設定すると有効になる。
// 未設定 ("") のままなら「この端末のランキング」のみで動作する。
// セットアップ手順は README.md を参照。
export const RANKING = {
  endpoint: "",             // 例: "https://tsumiboshi-xxxx-default-rtdb.asia-southeast1.firebasedatabase.app"
  path: "tsumiboshi/v1",    // データベース内の保存先
  limit: 100,               // 取得する上位件数
};

// 面の向きごとの色 (XZ=水平 / XY=正面 / YZ=側面)
export const PLANE_COLORS = {
  XZ: { base: 0xf5b44e, emissive: 0x6b3f08, edge: 0xffe0a8 },
  XY: { base: 0x46d4f2, emissive: 0x073f52, edge: 0xbdf3ff },
  YZ: { base: 0xf2699f, emissive: 0x55123a, edge: 0xffc4dd },
};

// スコア
export const SCORE = {
  perPlacedCell: 5,     // 置いた1マスあたり
  perClearedCell: 10,   // 消えた1マスあたり (×ライン数)
  multiLineBonus: 60,   // 2ライン目以降、1ラインごとの追加ボーナス
  comboBonus: 25,       // 連続クリア1回ごとの追加ボーナス
};

export const STORAGE_PREFIX = "tsumiboshi.";

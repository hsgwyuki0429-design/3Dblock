// ランキング: Firebase Realtime Database REST (SDK不要) + 端末内フォールバック
// モード(line / plane)ごとに別ランキング。エントリに mode フィールド "m" を持たせ、
// 既存の Firebase ルール(blocks3d/v1)そのままでモード別に絞り込める。

import { RANKING, STORAGE_PREFIX } from "./config.js";

const LOCAL_KEY = STORAGE_PREFIX + "localRanks";

export function isOnlineEnabled() {
  return !!RANKING.endpoint;
}

function baseUrl() {
  return `${RANKING.endpoint.replace(/\/+$/, "")}/${RANKING.path}.json`;
}

// mode 未設定の旧データは "line" 扱い
const entryMode = (v) => (v && typeof v.m === "string" ? v.m : "line");

/** 世界ランキングへスコアを送信する */
export async function submitWorldScore(name, score, mode = "line") {
  if (!isOnlineEnabled()) throw new Error("online ranking disabled");
  const res = await fetch(baseUrl(), {
    method: "POST",
    body: JSON.stringify({ n: String(name).slice(0, 12), s: score, t: Date.now(), m: mode }),
  });
  if (!res.ok) throw new Error(`submit failed: ${res.status}`);
  return res.json();
}

/** 世界ランキング上位を取得する (指定モード・スコア降順) */
export async function fetchWorldRanks(mode = "line") {
  if (!isOnlineEnabled()) return null;
  // モードで絞るので全件取得してクライアント側でフィルタ+ソート
  const res = await fetch(baseUrl());
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const data = await res.json();
  const rows = Object.entries(data || {})
    .filter(([, v]) => entryMode(v) === mode)
    .map(([id, v]) => ({
      id,
      name: String(v?.n ?? "?").slice(0, 12),
      score: Number(v?.s) || 0,
      time: Number(v?.t) || 0,
    }));
  rows.sort((a, b) => b.score - a.score || a.time - b.time);
  return rows.slice(0, RANKING.limit);
}

// ---- 端末内ランキング (モード別) ----

function localKey(mode) {
  return `${LOCAL_KEY}.${mode}`;
}

export function getLocalRanks(mode = "line") {
  try {
    const raw = localStorage.getItem(localKey(mode));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addLocalRank(name, score, mode = "line") {
  const ranks = getLocalRanks(mode);
  const entry = { name: String(name).slice(0, 12), score, time: Date.now() };
  ranks.push(entry);
  ranks.sort((a, b) => b.score - a.score || a.time - b.time);
  const trimmed = ranks.slice(0, RANKING.limit);
  try {
    localStorage.setItem(localKey(mode), JSON.stringify(trimmed));
  } catch { /* storage full etc. */ }
  return trimmed.indexOf(entry) + 1 || trimmed.length;
}

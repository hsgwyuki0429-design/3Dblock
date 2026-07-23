// ランキング: Firebase Realtime Database REST (SDK不要) + 端末内フォールバック

import { RANKING, STORAGE_PREFIX } from "./config.js";

const LOCAL_KEY = STORAGE_PREFIX + "localRanks";

export function isOnlineEnabled() {
  return !!RANKING.endpoint;
}

function baseUrl() {
  return `${RANKING.endpoint.replace(/\/+$/, "")}/${RANKING.path}.json`;
}

/** 世界ランキングへスコアを送信する */
export async function submitWorldScore(name, score) {
  if (!isOnlineEnabled()) throw new Error("online ranking disabled");
  const res = await fetch(baseUrl(), {
    method: "POST",
    body: JSON.stringify({ n: String(name).slice(0, 12), s: score, t: Date.now() }),
  });
  if (!res.ok) throw new Error(`submit failed: ${res.status}`);
  return res.json();
}

/** 世界ランキング上位を取得する (スコア降順) */
export async function fetchWorldRanks() {
  if (!isOnlineEnabled()) return null;
  let data = null;
  try {
    // .indexOn が設定されていればサーバー側で絞り込める
    const q = `?orderBy="s"&limitToLast=${RANKING.limit}`;
    const res = await fetch(baseUrl() + q);
    if (res.ok) data = await res.json();
  } catch { /* fall through */ }
  if (data === null) {
    // インデックス未設定でも全件取得→クライアント側ソートで動かす
    const res = await fetch(baseUrl());
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    data = await res.json();
  }
  const rows = Object.entries(data || {}).map(([id, v]) => ({
    id,
    name: String(v?.n ?? "?").slice(0, 12),
    score: Number(v?.s) || 0,
    time: Number(v?.t) || 0,
  }));
  rows.sort((a, b) => b.score - a.score || a.time - b.time);
  return rows.slice(0, RANKING.limit);
}

// ---- 端末内ランキング ----

export function getLocalRanks() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addLocalRank(name, score) {
  const ranks = getLocalRanks();
  const entry = { name: String(name).slice(0, 12), score, time: Date.now() };
  ranks.push(entry);
  ranks.sort((a, b) => b.score - a.score || a.time - b.time);
  const trimmed = ranks.slice(0, RANKING.limit);
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(trimmed));
  } catch { /* storage full etc. */ }
  return trimmed.indexOf(entry) + 1 || trimmed.length;
}

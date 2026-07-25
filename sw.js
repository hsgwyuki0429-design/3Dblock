// 3Dblocks サービスワーカー: ホーム画面追加(インストール)対応 + シェルのオフラインキャッシュ
// キャッシュ名は APP_VERSION に合わせて更新する (リリースごとに +0.1)
const VERSION = "3dblocks-2.9";
const SHELL = [
  "./", "./index.html", "./manifest.json",
  "./css/style.css",
  "./js/main.js", "./js/game.js", "./js/board.js", "./js/shapes.js",
  "./js/config.js", "./js/audio.js", "./js/ranking.js", "./js/dealer.js",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-180.png", "./icons/favicon-32.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(SHELL.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // ランキング送信(POST)等は素通し
  const url = new URL(req.url);
  if (/firebaseio\.com|firebasedatabase\.app/.test(url.hostname)) return;  // ランキングAPIはキャッシュしない

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        // 同一オリジン or CDN(three/フォント)を実行時キャッシュ → 次回オフラインでも起動
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => hit);
    })
  );
});

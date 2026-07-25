// 3Dblocks サービスワーカー: ホーム画面追加(インストール)対応 + シェルのオフラインキャッシュ
// キャッシュ名は APP_VERSION に合わせて更新する (リリースごとに +0.1)
//
// 【重要】アプリのコード(html/css/js/json)は "ネットワーク優先" で配信する。
//   以前は全リソースを「キャッシュ優先」にしていたため、GitHub Pages 側に
//   新しいコードがデプロイ済みでも、インストール済みのブラウザは古いキャッシュを
//   返し続け、マージが一向に反映されなかった。ネットワーク優先にすると、
//   オンライン時は常に最新を取得し、オフライン時のみキャッシュへフォールバックする。
//   (アイコン等の不変アセットや外部CDNだけをキャッシュ優先のまま残す)
const VERSION = "3dblocks-2.4";
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

// 同一オリジンのアプリコード(HTML/CSS/JS/JSON)か? → ネットワーク優先の対象
function isAppCode(url) {
  return url.origin === self.location.origin &&
    (url.pathname === "/" || url.pathname.endsWith("/") ||
     /\.(html|css|js|mjs|json)$/i.test(url.pathname));
}

// ネットワーク優先: まず取りに行き、成功したらキャッシュも更新。失敗時のみキャッシュへ。
function networkFirst(req) {
  return fetch(req).then((res) => {
    if (res && res.ok) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
    }
    return res;
  }).catch(() =>
    caches.match(req).then((hit) => hit || caches.match("./index.html"))
  );
}

// キャッシュ優先: あればそれを返し、無ければ取得してキャッシュ(不変アセット/CDN向け)。
function cacheFirst(req) {
  return caches.match(req).then((hit) => {
    if (hit) return hit;
    return fetch(req).then((res) => {
      if (res && (res.ok || res.type === "opaque")) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => hit);
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                 // ランキング送信(POST)等は素通し
  const url = new URL(req.url);
  if (/firebaseio\.com|firebasedatabase\.app/.test(url.hostname)) return;  // ランキングAPIはキャッシュしない

  // ページ遷移・同一オリジンのアプリコードはネットワーク優先(常に最新を反映)
  if (req.mode === "navigate" || isAppCode(url)) {
    e.respondWith(networkFirst(req));
    return;
  }

  // それ以外(アイコン画像・three.js/フォント等の不変資産)はキャッシュ優先で高速&オフライン対応
  e.respondWith(cacheFirst(req));
});

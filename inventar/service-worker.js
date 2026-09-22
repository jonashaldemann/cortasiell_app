const CACHE_NAME = "cortasiell-inventar-v4";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "../shared/theme.css",
    "../shared/fonts/nudica-light-webfont.woff2",
    "../shared/fonts/nudica-light-webfont.woff",
    "../shared/fonts/nudica-medium-webfont.woff2",
    "../shared/fonts/nudica-medium-webfont.woff",
    "../shared/fonts/nudica-regular-webfont.woff2",
    "../shared/fonts/nudica-regular-webfont.woff"
];

// WICHTIG: Inventar ist die einzige App, die regelmässig vor Ort mit
// schlechtem/keinem Netz benutzt wird (Alphütte). Deshalb bewusst
// Cache-zuerst statt Netzwerk-zuerst wie bei den übrigen Apps – die
// Shell muss sofort und garantiert offline laden, ohne je auf einen
// Netzwerk-Timeout zu warten. Die eigentliche Offline-Robustheit
// (Fragen-Cache, Zustand, Sync-Warteschlange) steckt ohnehin in
// app.js/localStorage, nicht im Service Worker.
self.addEventListener("install", event => {

    event.waitUntil(

        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES_TO_CACHE))

    );

});

self.addEventListener("fetch", event => {

    const url = new URL(event.request.url);

    if (url.hostname === "script.google.com") {
        return;
    }

    event.respondWith(

        caches.match(event.request)
            .then(response => {

                return response || fetch(event.request);

            })

    );

});

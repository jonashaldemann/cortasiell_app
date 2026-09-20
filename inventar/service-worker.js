const CACHE_NAME = "cortasiell-inventar-v1";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
    "../shared/fonts/nudica-light-webfont.woff2",
    "../shared/fonts/nudica-light-webfont.woff",
    "../shared/fonts/nudica-medium-webfont.woff2",
    "../shared/fonts/nudica-medium-webfont.woff",
    "../shared/fonts/nudica-regular-webfont.woff2",
    "../shared/fonts/nudica-regular-webfont.woff",
    "../shared/icons/icon-192.png",
    "../shared/icons/icon-512.png"
];

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
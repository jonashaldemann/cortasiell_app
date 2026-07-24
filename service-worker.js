const CACHE_NAME = "cortasiell-v19";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./manifest.json",
    "./fonts/nudica-light-webfont.woff2",
    "./fonts/nudica-light-webfont.woff",
    "./fonts/nudica-medium-webfont.woff2",
    "./fonts/nudica-medium-webfont.woff",
    "./fonts/nudica-regular-webfont.woff2",
    "./fonts/nudica-regular-webfont.woff"
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
const CACHE_NAME = "cortasiell-einkaufsliste-v1";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./einkaufsliste.js",
    "./firebase-config.js",
    "./manifest.json",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "../shared/theme.css",
    "../shared/fonts/nudica-light-webfont.woff2",
    "../shared/fonts/nudica-light-webfont.woff",
    "../shared/fonts/nudica-medium-webfont.woff2",
    "../shared/fonts/nudica-medium-webfont.woff"
];

self.addEventListener("install", event => {

    event.waitUntil(

        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES_TO_CACHE))

    );

});

self.addEventListener("fetch", event => {

    const url = new URL(event.request.url);

    // Firestore-Anfragen (und alles sonst Fremd-Hostige) laufen ganz
    // normal ans Netz durch – nur die eigene App-Shell wird gecacht.
    if (url.hostname !== self.location.hostname) {
        return;
    }

    event.respondWith(

        caches.match(event.request)
            .then(response => {

                return response || fetch(event.request);

            })

    );

});

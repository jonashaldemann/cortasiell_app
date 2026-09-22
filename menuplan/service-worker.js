const CACHE_NAME = "cortasiell-menuplan-v2";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./menuplan.js",
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

    self.skipWaiting(); // neue Version sofort aktivieren, nicht erst wenn alle Tabs zu sind

    event.waitUntil(

        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES_TO_CACHE))

    );

});

self.addEventListener("activate", event => {

    event.waitUntil(

        caches.keys()
            .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
            .then(() => self.clients.claim()) // offene Tabs sofort übernehmen

    );

});

self.addEventListener("fetch", event => {

    const url = new URL(event.request.url);

    // Firestore-Anfragen (und alles sonst Fremd-Hostige) laufen ganz
    // normal ans Netz durch – nur die eigene App-Shell wird gecacht.
    if (url.hostname !== self.location.hostname) {
        return;
    }

    // Netzwerk zuerst, damit ein frischer Deploy sofort ankommt – nur bei
    // Offline/Netzwerkfehler auf den zuletzt bekannten Stand aus dem Cache
    // zurückgreifen. Löst das "Refresh zeigt trotzdem die alte Version"-
    // Problem der vorherigen Cache-zuerst-Strategie.
    event.respondWith(

        fetch(event.request)
            .then(antwort => {

                const kopie = antwort.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, kopie));
                return antwort;

            })
            .catch(() => caches.match(event.request))

    );

});

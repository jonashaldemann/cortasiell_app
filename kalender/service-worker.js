const CACHE_NAME = "cortasiell-kalender-v6";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./calendar.js",
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

    // Firebase/Firestore-Anfragen (und alles sonst Fremd-Hostige) laufen
    // ganz normal ans Netz durch – nur die eigene App-Shell wird gecacht,
    // damit die Kalenderdaten immer live und nie veraltet aus dem Cache
    // kommen.
    if (url.hostname !== self.location.hostname) {
        return;
    }

    // Netzwerk zuerst, damit ein frischer Deploy sofort ankommt – nur bei
    // Offline/Netzwerkfehler auf den zuletzt bekannten Stand aus dem Cache
    // zurückgreifen. cache:"reload" ist wichtig: ohne das darf der Browser
    // diese fetch()-Anfrage selbst aus seinem eigenen HTTP-Cache
    // beantworten (nicht dem hier verwalteten Cache Storage) - "Netzwerk
    // zuerst" wäre dann nur Theater, es kam nie wirklich neu vom Server,
    // und nur "alle Cookies/Website-Daten löschen" hat geholfen.
    event.respondWith(

        fetch(event.request, { cache: "reload" })
            .then(antwort => {

                const kopie = antwort.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, kopie));
                return antwort;

            })
            .catch(() => caches.match(event.request))

    );

});

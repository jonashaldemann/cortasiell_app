import { db } from "./firebase-config.js";
import {
    arrayRemove,
    arrayUnion,
    collection,
    deleteField,
    deleteDoc,
    doc,
    documentId,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    startAt,
    endAt,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// ============================================================
// Zeitleisten-Kalender – horizontaler (Browser) bzw. vertikaler
// (Handy) Zeitbalken, Fenster immer "heute .. heute + 1 Jahr".
//
// Datenmodell unverändert (siehe README/Plan):
// - tage/{YYYY-MM-DD}: { personen: string[], aktivitaet: string }
// - ereignisse/{id}: { titel, vonDatum, bisDatum, projektId,
//   verschiebeVon?, verschiebeBis?, erstelltAm } – projektId-Ereignisse
//   werden vom Projekte-Modul unter der ID "projekt-<projektId>"
//   gespiegelt und sind hier nur lesbar (siehe ereignisOeffnen()).
//
// Personen-Balken sind aus den Tages-Einträgen abgeleitet (keine eigene
// Collection): zusammenhängende Tage mit demselben Namen ergeben einen
// Balken; Ziehen/Zeichnen schreibt per arrayUnion/arrayRemove auf die
// jeweiligen Tage zurück.
// ============================================================

const MONATSNAMEN_KURZ = [
    "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
    "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"
];

const heute = new Date();
heute.setHours(0, 0, 0, 0);

const rangeStart = new Date(heute);
const rangeEnde = tagePlus(rangeStart, 365);
const totalTage = 366;

// Browser-Ansicht = horizontale Zeitleiste, Handy-Ansicht = vertikal
// (dieselbe Breakpoint-Konvention wie im Rest der App).
const breiteAnsichtMedia = window.matchMedia("(min-width: 900px)");
function istHorizontal() { return breiteAnsichtMedia.matches; }

// Pixel pro Tag – wird per Zoom verändert. LABEL_GROESSE/SPALTEN_BREITE/
// DATUM_SPALTE_BREITE müssen zu den entsprechenden Werten in style.css
// passen (dort als Kommentar vermerkt).
let zellGroesse = 12;
const ZELL_MIN = 4;
const ZELL_MAX = 56;
const ZELL_TAGESZAHL_MIN = 20; // ab dieser Zellgrösse lohnt sich eine Tageszahl-Leiste
const LABEL_GROESSE = 130;
const SPALTEN_BREITE = 84;
const DATUM_SPALTE_BREITE = 56;
const LANE_PITCH = 28; // px zwischen zwei gestapelten Balken (Höhe horizontal / Breite vertikal)
const NOTIZ_MARKER_BREITE = 20; // px, Diamant + Lücke vor dem Text
const NOTIZ_ZEICHEN_BREITE = 6; // px, grobe Breite pro Zeichen des Notiz-Labels

let ereignisse = [];
let tageDaten = {}; // "YYYY-MM-DD" -> { personen: string[], aktivitaet: string }

let letzteOrientierung = null;
let bearbeitetesEreignisId = null;
let ereignisDialogZustand = { vonId: null, bisId: null }; // Zeitraum des offenen Ereignis-Dialogs (aus Ziehen, nicht editierbar)
let personDialogZustand = null; // { alterName, alteTage: string[], vonId, bisId }
let bearbeitetesNotizDatum = null;
let ereignisVerschiebeZeichnenId = null;

let zlScrollEl, zlZoomSchieberEl;

function init() {

    zlScrollEl = document.getElementById("zlScroll");
    zlZoomSchieberEl = document.getElementById("zlZoomSchieber");
    zlZoomSchieberEl.min = ZELL_MIN;
    zlZoomSchieberEl.max = ZELL_MAX;

    zlScrollEl.addEventListener("pointerdown", aufZeigerAbwaerts);
    zlScrollEl.addEventListener("wheel", aufRad, { passive: false });
    zlZoomSchieberEl.addEventListener("input", () => {
        zellGroesse = Number(zlZoomSchieberEl.value);
        render();
    });

    breiteAnsichtMedia.addEventListener("change", render);

    abonniereEreignisse();
    abonniereTage();
    render();

}

// --- Datum-Helfer ---

function pad(n) {
    return String(n).padStart(2, "0");
}

function datumZuId(datum) {
    return `${datum.getFullYear()}-${pad(datum.getMonth() + 1)}-${pad(datum.getDate())}`;
}

function idZuDatum(id) {
    const [jahr, monat, tag] = id.split("-").map(Number);
    return new Date(jahr, monat - 1, tag);
}

function tagePlus(datum, n) {
    const neu = new Date(datum);
    neu.setDate(neu.getDate() + n);
    return neu;
}

function tageZwischen(a, b) {
    return Math.round((b - a) / 86400000);
}

function montagDerWoche(datum) {
    const versatz = (datum.getDay() + 6) % 7; // Mo=0 ... So=6
    const montag = new Date(datum);
    montag.setDate(datum.getDate() - versatz);
    return montag;
}

function tagIndexZuId(idx) {
    return datumZuId(tagePlus(rangeStart, idx));
}

function idZuTagIndex(id) {
    return tageZwischen(rangeStart, idZuDatum(id));
}

function clampIdx(i) {
    return Math.max(0, Math.min(totalTage - 1, i));
}

function tageIdsZwischen(vonId, bisId) {
    const ids = [];
    const von = idZuDatum(vonId);
    const bis = idZuDatum(bisId);
    for (const tag = new Date(von); tag <= bis; tag.setDate(tag.getDate() + 1)) {
        ids.push(datumZuId(tag));
    }
    return ids;
}

function formatDatumLang(id) {
    const MONATSNAMEN = [
        "Januar", "Februar", "März", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Dezember"
    ];
    const [jahr, monat, tag] = id.split("-").map(Number);
    return `${tag}. ${MONATSNAMEN[monat - 1]} ${jahr}`;
}

function formatDatumKurz(id) {
    const [jahr, monat, tag] = id.split("-").map(Number);
    return `${tag}. ${MONATSNAMEN_KURZ[monat - 1]}`;
}

// Für Anzeige-Texte in den Dialogen – die Datums-Eingabefelder wurden
// bewusst entfernt (siehe README/Feedback): Balken werden nur noch per
// Ziehen auf der Zeitleiste gesetzt, hier wird der aktuelle Zeitraum nur
// noch schreibgeschützt zur Kontrolle angezeigt.
function formatZeitraum(vonId, bisId) {
    return vonId === bisId ? formatDatumLang(vonId) : `${formatDatumKurz(vonId)} – ${formatDatumLang(bisId)}`;
}

function kuerzeText(text, maxLen) {
    return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
}

// Osterdatum nach dem gaußschen Osteralgorithmus (Meeus/Jones/Butcher) –
// daraus lassen sich alle beweglichen Feiertage (Karfreitag, Auffahrt,
// Pfingsten, ...) für jedes beliebige Jahr herleiten.
function osterdatum(jahr) {

    const a = jahr % 19;
    const b = Math.floor(jahr / 100);
    const c = jahr % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const monat = Math.floor((h + l - 7 * m + 114) / 31);
    const tag = ((h + l - 7 * m + 114) % 31) + 1;

    return new Date(jahr, monat - 1, tag);

}

const feiertageCache = {};

// Schweizer (Bundes-)Feiertage für ein Jahr, als "YYYY-MM-DD" -> Name.
function feiertageFuerJahr(jahr) {

    if (feiertageCache[jahr]) {
        return feiertageCache[jahr];
    }

    const ostern = osterdatum(jahr);

    const liste = [
        [new Date(jahr, 0, 1), "Neujahr"],
        [tagePlus(ostern, -2), "Karfreitag"],
        [ostern, "Ostersonntag"],
        [tagePlus(ostern, 1), "Ostermontag"],
        [tagePlus(ostern, 39), "Auffahrt"],
        [tagePlus(ostern, 49), "Pfingstsonntag"],
        [tagePlus(ostern, 50), "Pfingstmontag"],
        [new Date(jahr, 7, 1), "Nationalfeiertag"],
        [new Date(jahr, 11, 25), "Weihnachten"],
        [new Date(jahr, 11, 26), "Stephanstag"]
    ];

    const map = {};
    liste.forEach(([datum, name]) => { map[datumZuId(datum)] = name; });

    feiertageCache[jahr] = map;
    return map;

}

function feiertagName(datum) {
    return feiertageFuerJahr(datum.getFullYear())[datumZuId(datum)] || null;
}

// HTML-Escaping für alles, was Nutzer als Freitext eingeben.
function escapeHtml(text) {

    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

// --- Firestore ---

function abonniereEreignisse() {

    onSnapshot(collection(db, "ereignisse"), snapshot => {

        ereignisse = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        render();

    }, error => {

        console.error("Ereignisse konnten nicht geladen werden:", error);

    });

}

function abonniereTage() {

    const vonId = datumZuId(rangeStart);
    const bisId = datumZuId(rangeEnde);

    const q = query(
        collection(db, "tage"),
        orderBy(documentId()),
        startAt(vonId),
        endAt(bisId)
    );

    onSnapshot(q, snapshot => {

        tageDaten = {};
        snapshot.forEach(docSnap => { tageDaten[docSnap.id] = docSnap.data(); });
        render();

    }, error => {

        console.error("Kalender konnte nicht geladen werden:", error);

        document.getElementById("zlScroll").innerHTML =
            "<p>⚠️ Kalender konnte nicht geladen werden. Bitte Internetverbindung prüfen.</p>";

    });

}

// --- Datenaufbereitung (orientierungsunabhängig) ---

function personenNamenListe() {

    const namen = new Set();

    for (let i = 0; i < totalTage; i++) {
        (tageDaten[tagIndexZuId(i)]?.personen || []).forEach(n => namen.add(n));
    }

    return [...namen].sort((a, b) => a.localeCompare(b, "de"));

}

function personenLaeufe(name) {

    const laeufe = [];
    let start = null;

    for (let i = 0; i < totalTage; i++) {

        const dabei = (tageDaten[tagIndexZuId(i)]?.personen || []).includes(name);

        if (dabei && start === null) {
            start = i;
        }

        if (!dabei && start !== null) {
            laeufe.push({ startIdx: start, endIdx: i - 1 });
            start = null;
        }

    }

    if (start !== null) {
        laeufe.push({ startIdx: start, endIdx: totalTage - 1 });
    }

    return laeufe;

}

function segmentClip(vonId, bisId) {

    if (!vonId || !bisId) {
        return null;
    }

    const startIdx = clampIdx(idZuTagIndex(vonId));
    const endIdx = clampIdx(idZuTagIndex(bisId));

    if (idZuTagIndex(bisId) < 0 || idZuTagIndex(vonId) > totalTage - 1 || endIdx < startIdx) {
        return null;
    }

    return { startIdx, endIdx };

}

// Packt beliebige Zeit-Intervalle in möglichst wenige Lanes (Reihen quer
// zur Datumsachse) – Standard-Interval-Scheduling: ein Intervall bekommt
// die erste Lane, deren letztes Intervall schon vorbei ist, sonst eine
// neue. So stehen Balken nebeneinander (gleiche Lane, keine Überlappung)
// und stapeln sich nur dort, wo sie sich tatsächlich zeitlich überlappen –
// keine feste Zeile pro Person/Ereignis nötig.
function packLanes(intervalle) {

    const sortiert = [...intervalle].sort((a, b) =>
        a.startIdx - b.startIdx || (b.endIdx - b.startIdx) - (a.endIdx - a.startIdx)
    );

    const laneEnden = []; // laneEnden[i] = letzter belegter Tag-Index der Lane i
    const platziert = [];

    sortiert.forEach(iv => {

        let lane = laneEnden.findIndex(ende => ende < iv.startIdx);

        if (lane === -1) {
            lane = laneEnden.length;
        }

        laneEnden[lane] = iv.endIdx;
        platziert.push({ ...iv, lane });

    });

    return { platziert, anzahlLanes: Math.max(1, laneEnden.length) };

}

function personenBalkenListe() {

    const intervalle = personenNamenListe().flatMap(name =>
        personenLaeufe(name).map(l => ({ ...l, name }))
    );

    return packLanes(intervalle);

}

function ereignisBalkenListe() {

    const intervalle = ereignisse.flatMap(e => {

        const segmente = [];
        const haupt = segmentClip(e.vonDatum, e.bisDatum);

        if (haupt) {
            segmente.push({ ...haupt, istVerschoben: false, ereignis: e });
        }

        if (e.verschiebeVon && e.verschiebeBis) {
            const versch = segmentClip(e.verschiebeVon, e.verschiebeBis);
            if (versch) {
                segmente.push({ ...versch, istVerschoben: true, ereignis: e });
            }
        }

        return segmente;

    });

    return packLanes(intervalle);

}

function tagesnotizenListe() {

    const liste = [];

    for (let i = 0; i < totalTage; i++) {

        const id = tagIndexZuId(i);
        const text = tageDaten[id]?.aktivitaet;

        if (text) {
            liste.push({ idx: i, id, text });
        }

    }

    return liste;

}

// Grobe Schätzung, wie viele Tage breit das Label einer Notiz bei der
// aktuellen Zellgrösse ungefähr einnimmt – daraus wird ein "Intervall" für
// packLanes() abgeleitet, damit sich Notizen nur stapeln, wenn sich ihre
// Texte tatsächlich überlagern würden (und ein späterer Eintrag wieder in
// eine frei gewordene Lane rutscht, sobald der Text davor "fertig" ist).
function notizFussabdruckTage(text) {
    const px = NOTIZ_MARKER_BREITE + kuerzeText(text, 24).length * NOTIZ_ZEICHEN_BREITE;
    return Math.max(1, Math.ceil(px / zellGroesse));
}

function tagesnotizenBalkenListe() {

    const intervalle = tagesnotizenListe().map(e => ({
        ...e,
        startIdx: e.idx,
        endIdx: clampIdx(e.idx + notizFussabdruckTage(e.text) - 1)
    }));

    return packLanes(intervalle);

}

function feiertageImBereich() {

    const liste = [];

    for (let i = 0; i < totalTage; i++) {

        const name = feiertagName(tagePlus(rangeStart, i));

        if (name) {
            liste.push({ idx: i, name });
        }

    }

    return liste;

}

function wochenendenLaeufe() {

    const laeufe = [];
    let start = null;

    for (let i = 0; i < totalTage; i++) {

        const tag = tagePlus(rangeStart, i).getDay();
        const we = tag === 0 || tag === 6;

        if (we && start === null) {
            start = i;
        }

        if (!we && start !== null) {
            laeufe.push({ startIdx: start, endIdx: i - 1 });
            start = null;
        }

    }

    if (start !== null) {
        laeufe.push({ startIdx: start, endIdx: totalTage - 1 });
    }

    return laeufe;

}

function wochenMontage() {

    const liste = [];
    let d = montagDerWoche(rangeStart);

    if (d < rangeStart) {
        d = tagePlus(d, 7);
    }

    while (d <= rangeEnde) {
        liste.push(new Date(d));
        d = tagePlus(d, 7);
    }

    return liste;

}

function monatsStarts() {

    const liste = [];
    let d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);

    if (d < rangeStart) {
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    while (d <= rangeEnde) {
        liste.push(new Date(d));
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    return liste;

}

// --- Geometrie-Helfer (Achse hängt von der Orientierung ab) ---

function rechteckStil(startIdx, endIdx, lane = 0) {

    const start = startIdx * zellGroesse;
    const laenge = (endIdx - startIdx + 1) * zellGroesse;
    const quer = 6 + lane * LANE_PITCH; // Versatz quer zur Datumsachse (gestapelte Lanes)

    return istHorizontal()
        ? `left:${start}px; width:${laenge}px; top:${quer}px;`
        : `top:${start}px; height:${laenge}px; left:${quer}px;`;

}

function punktStil(idx, lane = 0) {

    const start = idx * zellGroesse;
    const quer = 6 + lane * LANE_PITCH;

    return istHorizontal()
        ? `left:${start}px; top:${quer}px;`
        : `top:${start}px; left:${quer}px;`;

}

// Dünne Trennlinie pro Tag (nicht nur pro Woche) – damit einzelne Tage auch
// bei grösseren Zellen klar auseinandergehalten werden können, unabhängig
// vom Zoom.
function tagesGitterHtml() {

    let html = "";

    for (let i = 1; i < totalTage; i++) {
        html += istHorizontal()
            ? `<div class="zl-tag-gitterlinie" style="left:${i * zellGroesse}px;"></div>`
            : `<div class="zl-tag-gitterlinie-v" style="top:${i * zellGroesse}px;"></div>`;
    }

    return html;

}

// --- Bar-/Marker-HTML ---

function personBalkenHtml(item) {

    const vonId = tagIndexZuId(item.startIdx);
    const bisId = tagIndexZuId(item.endIdx);

    return `
        <div class="zl-balken zl-balken-person" data-balken data-typ="person"
            data-name="${escapeHtml(item.name)}" data-von-id="${vonId}" data-bis-id="${bisId}" data-lane="${item.lane}"
            style="${rechteckStil(item.startIdx, item.endIdx, item.lane)}">
            <span class="zl-griff" data-griff="start"></span>
            <span class="zl-balken-titel">${escapeHtml(item.name)}</span>
            <span class="zl-griff" data-griff="ende"></span>
        </div>
    `;

}

function ereignisBalkenHtml(item) {

    const ereignis = item.ereignis;
    const projektKlasse = ereignis.projektId ? " zl-projekt-verknuepft" : "";
    const verschobenKlasse = item.istVerschoben ? " zl-verschoben" : "";
    const praefix = item.istVerschoben ? "↦ " : "";
    const vonId = tagIndexZuId(item.startIdx);
    const bisId = tagIndexZuId(item.endIdx);

    return `
        <div class="zl-balken zl-balken-ereignis${projektKlasse}${verschobenKlasse}" data-balken data-typ="ereignis"
            data-id="${ereignis.id}" data-segment="${item.istVerschoben ? "verschoben" : "haupt"}"
            data-von-id="${vonId}" data-bis-id="${bisId}" data-lane="${item.lane}"
            style="${rechteckStil(item.startIdx, item.endIdx, item.lane)}">
            <span class="zl-griff" data-griff="start"></span>
            <span class="zl-balken-titel">${praefix}${escapeHtml(ereignis.titel)}</span>
            <span class="zl-griff" data-griff="ende"></span>
        </div>
    `;

}

function notizMarkerHtml(item) {

    return `
        <div class="zl-notiz-marker" data-balken data-typ="notiz" data-id="${item.id}" data-lane="${item.lane}"
            style="${punktStil(item.idx, item.lane)}" title="${escapeHtml(item.text)}">
            <span class="zl-notiz-punkt"></span>
            <span class="zl-notiz-label">${escapeHtml(kuerzeText(item.text, 24))}</span>
        </div>
    `;

}

// --- Rendering: horizontale Zeitleiste (Browser) ---

function horizontalHtml() {

    const gesamtGroesse = totalTage * zellGroesse;
    const monate = monatsStarts();
    const wochen = wochenMontage();
    const zeigeTage = zellGroesse >= ZELL_TAGESZAHL_MIN;
    const feiertage = feiertageImBereich();
    const wochenenden = wochenendenLaeufe();

    const monateHtml = monate.map(d => {
        const idx = idZuTagIndex(datumZuId(d));
        return `<div class="zl-monat-strich" style="left:${idx * zellGroesse}px;"><span>${MONATSNAMEN_KURZ[d.getMonth()]} ${d.getFullYear()}</span></div>`;
    }).join("");

    const wochenHtml = wochen.map(d => {
        const idx = idZuTagIndex(datumZuId(d));
        return `<div class="zl-woche-strich" style="left:${idx * zellGroesse}px;"><span>${pad(d.getDate())}.${pad(d.getMonth() + 1)}.</span></div>`;
    }).join("");

    const tageHtml = zeigeTage
        ? Array.from({ length: totalTage }, (_, i) =>
            `<div class="zl-tag-zahl" style="left:${i * zellGroesse}px; width:${zellGroesse}px;">${tagePlus(rangeStart, i).getDate()}</div>`
        ).join("")
        : "";

    const feiertagHtml = feiertage.map(f =>
        `<div class="zl-feiertag-strich" style="left:${f.idx * zellGroesse}px;" title="${escapeHtml(f.name)}">
            <span class="zl-feiertag-text">${escapeHtml(f.name)}</span>
        </div>`
    ).join("");

    const wochenendHtml = wochenenden.map(l =>
        `<div class="zl-wochenende-streifen" style="left:${l.startIdx * zellGroesse}px; width:${(l.endIdx - l.startIdx + 1) * zellGroesse}px;"></div>`
    ).join("");

    const wochenGitterHtml = wochen.map(d => {
        const idx = idZuTagIndex(datumZuId(d));
        return `<div class="zl-woche-gitterlinie" style="left:${idx * zellGroesse}px;"></div>`;
    }).join("");

    const feiertagFlaecheHtml = feiertage.map(f =>
        `<div class="zl-feiertag-flaeche" style="left:${f.idx * zellGroesse}px; width:${zellGroesse}px;"></div>`
    ).join("");

    return `
        <div class="zl-inner" style="width:${LABEL_GROESSE + gesamtGroesse}px;">
            <div class="zl-kopf-reihe">
                <div class="zl-ecke"></div>
                <div class="zl-kopf-spuren" style="width:${gesamtGroesse}px;">
                    <div class="zl-monat-spur">${monateHtml}</div>
                    <div class="zl-woche-spur">${wochenHtml}</div>
                    ${zeigeTage ? `<div class="zl-tag-spur">${tageHtml}</div>` : ""}
                    <div class="zl-feiertag-spur">${feiertagHtml}</div>
                </div>
            </div>
            <div class="zl-koerper">
                <div class="zl-hintergrund" style="left:${LABEL_GROESSE}px; width:${gesamtGroesse}px;">
                    ${wochenendHtml}
                    ${tagesGitterHtml()}
                    ${wochenGitterHtml}
                    ${feiertagFlaecheHtml}
                    <div class="zl-heute-linie"></div>
                </div>
                ${personenAbschnittHtml(gesamtGroesse)}
                ${ereignisAbschnittHtml(gesamtGroesse)}
                ${tagesnotizenAbschnittHtml(gesamtGroesse)}
            </div>
        </div>
    `;

}

function personenAbschnittHtml(gesamtGroesse) {

    const { platziert, anzahlLanes } = personenBalkenListe();
    const balkenHtml = platziert.map(item => personBalkenHtml(item)).join("");
    const hoehe = anzahlLanes * LANE_PITCH + 6;

    return `
        <div class="zl-zeile" style="min-height:${hoehe}px;">
            <div class="zl-label-zelle">Personen</div>
            <div class="zl-spur" data-neu="person" style="width:${gesamtGroesse}px; height:${hoehe}px;">
                ${balkenHtml}
            </div>
        </div>
    `;

}

function ereignisAbschnittHtml(gesamtGroesse) {

    const { platziert, anzahlLanes } = ereignisBalkenListe();
    const balkenHtml = platziert.map(item => ereignisBalkenHtml(item)).join("");
    const hoehe = anzahlLanes * LANE_PITCH + 6;
    const armiertKlasse = ereignisVerschiebeZeichnenId ? " zl-zeile-zeichnen-aktiv" : "";

    return `
        <div class="zl-zeile${armiertKlasse}" style="min-height:${hoehe}px;">
            <div class="zl-label-zelle">Ereignisse</div>
            <div class="zl-spur" data-neu="ereignis" style="width:${gesamtGroesse}px; height:${hoehe}px;">
                ${balkenHtml}
            </div>
        </div>
    `;

}

function tagesnotizenAbschnittHtml(gesamtGroesse) {

    const { platziert, anzahlLanes } = tagesnotizenBalkenListe();
    const markerHtml = platziert.map(item => notizMarkerHtml(item)).join("");
    const hoehe = Math.max(40, anzahlLanes * LANE_PITCH + 6);

    return `
        <div class="zl-zeile" style="min-height:${hoehe}px;">
            <div class="zl-label-zelle">Notizen</div>
            <div class="zl-spur zl-spur-notizen" data-neu="notiz" style="width:${gesamtGroesse}px; height:${hoehe}px;">
                ${markerHtml}
            </div>
        </div>
    `;

}

// --- Rendering: vertikale Zeitleiste (Handy) ---

function vertikalHtml() {

    const gesamtGroesse = totalTage * zellGroesse;
    const monate = monatsStarts();
    const wochen = wochenMontage();
    const zeigeTage = zellGroesse >= ZELL_TAGESZAHL_MIN;
    const feiertage = feiertageImBereich();
    const wochenenden = wochenendenLaeufe();

    const monateHtml = monate.map(d => {
        const idx = idZuTagIndex(datumZuId(d));
        return `<div class="zl-monat-strich-v" style="top:${idx * zellGroesse}px;"><span>${MONATSNAMEN_KURZ[d.getMonth()]} ${d.getFullYear()}</span></div>`;
    }).join("");

    const wochenHtml = wochen.map(d => {
        const idx = idZuTagIndex(datumZuId(d));
        return `<div class="zl-woche-strich-v" style="top:${idx * zellGroesse}px;"><span>${pad(d.getDate())}.${pad(d.getMonth() + 1)}.</span></div>`;
    }).join("");

    const tageHtml = zeigeTage
        ? Array.from({ length: totalTage }, (_, i) =>
            `<div class="zl-tag-zahl-v" style="top:${i * zellGroesse}px; height:${zellGroesse}px;">${tagePlus(rangeStart, i).getDate()}</div>`
        ).join("")
        : "";

    const feiertagHtml = feiertage.map(f =>
        `<div class="zl-feiertag-strich-v" style="top:${f.idx * zellGroesse}px;" title="${escapeHtml(f.name)}">
            <span class="zl-feiertag-text-v">${escapeHtml(f.name)}</span>
        </div>`
    ).join("");

    const wochenendHtml = wochenenden.map(l =>
        `<div class="zl-wochenende-streifen-v" style="top:${l.startIdx * zellGroesse}px; height:${(l.endIdx - l.startIdx + 1) * zellGroesse}px;"></div>`
    ).join("");

    const wochenGitterHtml = wochen.map(d => {
        const idx = idZuTagIndex(datumZuId(d));
        return `<div class="zl-woche-gitterlinie-v" style="top:${idx * zellGroesse}px;"></div>`;
    }).join("");

    const feiertagFlaecheHtml = feiertage.map(f =>
        `<div class="zl-feiertag-flaeche-v" style="top:${f.idx * zellGroesse}px; height:${zellGroesse}px;"></div>`
    ).join("");

    const personenGepackt = personenBalkenListe();
    const personenBreite = personenGepackt.anzahlLanes * LANE_PITCH + 6;

    const personenSpalte = `
        <div class="zl-spalte" style="flex:0 0 ${personenBreite}px;">
            <div class="zl-spalte-label">Personen</div>
            <div class="zl-spur-v" data-neu="person" style="height:${gesamtGroesse}px;">
                ${personenGepackt.platziert.map(item => personBalkenHtml(item)).join("")}
            </div>
        </div>
    `;

    const ereignisGepackt = ereignisBalkenListe();
    const ereignisBreite = ereignisGepackt.anzahlLanes * LANE_PITCH + 6;
    const ereignisArmiertKlasse = ereignisVerschiebeZeichnenId ? " zl-spalte-zeichnen-aktiv" : "";

    const ereignisSpalte = `
        <div class="zl-spalte${ereignisArmiertKlasse}" style="flex:0 0 ${ereignisBreite}px;">
            <div class="zl-spalte-label">Ereignisse</div>
            <div class="zl-spur-v" data-neu="ereignis" style="height:${gesamtGroesse}px;">
                ${ereignisGepackt.platziert.map(item => ereignisBalkenHtml(item)).join("")}
            </div>
        </div>
    `;

    const notizGepackt = tagesnotizenBalkenListe();
    const notizBreite = Math.max(84, notizGepackt.anzahlLanes * LANE_PITCH + 6);

    const notizSpalte = `
        <div class="zl-spalte" style="flex:0 0 ${notizBreite}px;">
            <div class="zl-spalte-label">Notizen</div>
            <div class="zl-spur-v zl-spur-notizen-v" data-neu="notiz" style="height:${gesamtGroesse}px;">
                ${notizGepackt.platziert.map(item => notizMarkerHtml(item)).join("")}
            </div>
        </div>
    `;

    return `
        <div class="zl-inner-v" style="min-height:${LABEL_GROESSE + gesamtGroesse}px;">
            <div class="zl-datum-spalte">
                <div class="zl-ecke-v"></div>
                <div class="zl-datum-spur" style="height:${gesamtGroesse}px;">
                    ${monateHtml}${wochenHtml}${tageHtml}${feiertagHtml}
                </div>
            </div>
            <div class="zl-hintergrund-v" style="top:${LABEL_GROESSE}px; left:${DATUM_SPALTE_BREITE}px; right:0; height:${gesamtGroesse}px;">
                ${wochenendHtml}
                ${tagesGitterHtml()}
                ${wochenGitterHtml}
                ${feiertagFlaecheHtml}
                <div class="zl-heute-linie-v"></div>
            </div>
            <div class="zl-spalten-gruppe">
                ${personenSpalte}
                ${ereignisSpalte}
                ${notizSpalte}
            </div>
        </div>
    `;

}

// --- Render-Einstieg + Zoom-Standard ---

function standardZoomSetzen() {

    const verfuegbar = (istHorizontal() ? zlScrollEl.clientWidth : zlScrollEl.clientHeight) - LABEL_GROESSE;
    zellGroesse = Math.max(ZELL_MIN, Math.min(ZELL_MAX, Math.floor(verfuegbar / (7 * 4))));
    zlZoomSchieberEl.value = zellGroesse;

}

function render() {

    const jetzt = istHorizontal() ? "horizontal" : "vertikal";

    if (jetzt !== letzteOrientierung) {
        letzteOrientierung = jetzt;
        standardZoomSetzen();
    }

    zlScrollEl.innerHTML = jetzt === "horizontal" ? horizontalHtml() : vertikalHtml();

}

// --- Zoom (Strg/Cmd + Scrollrad) ---

function zeigerKoordinate(e) {
    return istHorizontal() ? e.clientX : e.clientY;
}

function aufRad(e) {

    if (!(e.ctrlKey || e.metaKey)) {
        return;
    }

    e.preventDefault();

    const rect = zlScrollEl.getBoundingClientRect();
    const basis = istHorizontal() ? rect.left : rect.top;
    const scrollVersatz = istHorizontal() ? zlScrollEl.scrollLeft : zlScrollEl.scrollTop;
    const koordinateImInhalt = zeigerKoordinate(e) - basis + scrollVersatz;
    const tagUnterZeiger = (koordinateImInhalt - LABEL_GROESSE) / zellGroesse;

    const faktor = Math.pow(1.0014, -e.deltaY);
    const alt = zellGroesse;
    zellGroesse = Math.max(ZELL_MIN, Math.min(ZELL_MAX, zellGroesse * faktor));

    if (zellGroesse === alt) {
        return;
    }

    render();
    zlZoomSchieberEl.value = Math.round(zellGroesse);

    const neueKoordinateImInhalt = LABEL_GROESSE + tagUnterZeiger * zellGroesse;
    const delta = neueKoordinateImInhalt - koordinateImInhalt;

    if (istHorizontal()) {
        zlScrollEl.scrollLeft += delta;
    } else {
        zlScrollEl.scrollTop += delta;
    }

}

function heuteAnzeigen() {

    if (istHorizontal()) {
        zlScrollEl.scrollLeft = 0;
    } else {
        zlScrollEl.scrollTop = 0;
    }

}

// --- Ziehen: neuer Balken auf einer "+"-Spur oder leerer Zeilenfläche ---

const ZIEH_SCHWELLE_PX = 4;

function spurRechteck(el) {
    return el.getBoundingClientRect();
}

function koordinateZuTagIndex(rect, clientKoordinate) {
    const basis = istHorizontal() ? rect.left : rect.top;
    // Math.floor, nicht Math.round: es geht um "in welcher Tages-Zelle
    // liegt dieser Punkt" - mit Runden würde die rechte Hälfte einer
    // Zelle schon auf den nächsten Tag "schnappen", wodurch ein Balken
    // z.B. für 9.-11. beim Loslassen in der rechten Hälfte des 11. als
    // 9.-12. gespeichert würde (siehe Feedback).
    return clampIdx(Math.floor((clientKoordinate - basis) / zellGroesse));
}

function spurZiehenStarten(e, spurEl) {

    const neuTyp = spurEl.dataset.neu; // "person" | "ereignis" | "notiz"

    e.preventDefault();

    const rect = spurRechteck(spurEl);
    const startKoordinate = zeigerKoordinate(e);
    const startIdx = koordinateZuTagIndex(rect, startKoordinate);
    const einzelpunkt = neuTyp === "notiz";

    let vorschauEl = null;
    let gezogen = false;

    function aufBewegen(ev) {

        if (einzelpunkt) {
            return;
        }

        const aktKoordinate = zeigerKoordinate(ev);

        if (!gezogen && Math.abs(aktKoordinate - startKoordinate) < ZIEH_SCHWELLE_PX) {
            return;
        }

        gezogen = true;

        const aktIdx = koordinateZuTagIndex(rect, aktKoordinate);
        const lo = Math.min(startIdx, aktIdx);
        const hi = Math.max(startIdx, aktIdx);

        if (!vorschauEl) {
            vorschauEl = document.createElement("div");
            vorschauEl.className = "zl-balken-vorschau";
            if (neuTyp === "ereignis" && ereignisVerschiebeZeichnenId) {
                vorschauEl.classList.add("zl-balken-vorschau-verschiebedatum");
                vorschauEl.textContent = "↦ Verschiebedatum";
            }
            spurEl.appendChild(vorschauEl);
        }

        vorschauEl.style.cssText = rechteckStil(lo, hi);

    }

    function aufLoslassen(ev) {

        window.removeEventListener("pointermove", aufBewegen);
        window.removeEventListener("pointerup", aufLoslassen);

        if (vorschauEl) {
            vorschauEl.remove();
        }

        const aktIdx = einzelpunkt ? startIdx : koordinateZuTagIndex(rect, zeigerKoordinate(ev));
        const lo = Math.min(startIdx, aktIdx);
        const hi = Math.max(startIdx, aktIdx);
        const vonId = tagIndexZuId(lo);
        const bisId = tagIndexZuId(hi);

        if (neuTyp === "person") {
            personDialogOeffnen({ vonId, bisId });
        } else if (neuTyp === "ereignis") {
            if (ereignisVerschiebeZeichnenId) {
                verschiebedatumUebernehmen(vonId, bisId);
            } else {
                neuesEreignis({ vonId, bisId });
            }
        } else if (neuTyp === "notiz") {
            tagesnotizDialogOeffnen(vonId);
        }

    }

    window.addEventListener("pointermove", aufBewegen);
    window.addEventListener("pointerup", aufLoslassen);

}

// --- Ziehen: bestehenden Balken verschieben/Enden anpassen ---

function balkenZiehenStarten(e, balkenEl) {

    // Projekt-verknüpfte Ereignisse sind auch hier verschieb-/anpassbar
    // (siehe Feedback) – nur der Titel bleibt der Projektseite vorbehalten.
    // balkenAendernSpeichern() synchronisiert eine Änderung zusätzlich
    // zurück ins Projekt-Dokument.
    e.preventDefault();

    const startKoordinate = zeigerKoordinate(e);
    const griffEl = e.target.closest("[data-griff]");
    const modus = griffEl ? griffEl.dataset.griff : "verschieben"; // "start" | "ende" | "verschieben"

    const startIdx0 = clampIdx(idZuTagIndex(balkenEl.dataset.vonId));
    const endIdx0 = clampIdx(idZuTagIndex(balkenEl.dataset.bisId));
    const lane = Number(balkenEl.dataset.lane) || 0;
    let vorschauStart = startIdx0;
    let vorschauEnd = endIdx0;

    function aufBewegen(ev) {

        const deltaTage = Math.round((zeigerKoordinate(ev) - startKoordinate) / zellGroesse);

        let neuStart = startIdx0;
        let neuEnd = endIdx0;

        if (modus === "verschieben") {
            const laenge = endIdx0 - startIdx0;
            neuStart = clampIdx(startIdx0 + deltaTage);
            neuEnd = neuStart + laenge;
            if (neuEnd > totalTage - 1) {
                neuEnd = totalTage - 1;
                neuStart = neuEnd - laenge;
            }
        } else if (modus === "start") {
            neuStart = Math.min(clampIdx(startIdx0 + deltaTage), endIdx0);
        } else if (modus === "ende") {
            neuEnd = Math.max(clampIdx(endIdx0 + deltaTage), startIdx0);
        }

        vorschauStart = neuStart;
        vorschauEnd = neuEnd;

        if (balkenEl.dataset.typ === "notiz") {
            balkenEl.style.cssText = punktStil(neuStart, lane);
        } else {
            balkenEl.style.cssText = rechteckStil(neuStart, neuEnd, lane);
        }

    }

    function aufLoslassen() {

        window.removeEventListener("pointermove", aufBewegen);
        window.removeEventListener("pointerup", aufLoslassen);

        // Klick vs. Ziehen wird am ENDERGEBNIS entschieden (hat sich der
        // Tag tatsächlich geändert?), nicht an der rohen Mausbewegung – ein
        // Tap ist so gut wie nie pixelgenau, ein paar Pixel Zittern dürfen
        // also nicht schon als "verschoben" zählen, solange am Ende
        // derselbe Tag rauskommt (siehe Feedback "Notizen kaum anklickbar").
        if (vorschauStart === startIdx0 && vorschauEnd === endIdx0) {
            balkenEl.style.cssText = balkenEl.dataset.typ === "notiz"
                ? punktStil(startIdx0, lane)
                : rechteckStil(startIdx0, endIdx0, lane);
            balkenAnklicken(balkenEl);
            return;
        }

        balkenAendernSpeichern(balkenEl, vorschauStart, vorschauEnd);

    }

    window.addEventListener("pointermove", aufBewegen);
    window.addEventListener("pointerup", aufLoslassen);

}

function balkenAnklicken(balkenEl) {

    const typ = balkenEl.dataset.typ;

    if (typ === "person") {
        personDialogOeffnen({
            alterName: balkenEl.dataset.name,
            alteTage: tageIdsZwischen(balkenEl.dataset.vonId, balkenEl.dataset.bisId),
            vonId: balkenEl.dataset.vonId,
            bisId: balkenEl.dataset.bisId
        });
    } else if (typ === "ereignis") {
        ereignisOeffnen(balkenEl.dataset.id);
    } else if (typ === "notiz") {
        tagesnotizDialogOeffnen(balkenEl.dataset.id);
    }

}

async function balkenAendernSpeichern(balkenEl, neuStart, neuEnd) {

    const typ = balkenEl.dataset.typ;
    const vonId = tagIndexZuId(neuStart);
    const bisId = tagIndexZuId(neuEnd);

    if (typ === "person") {

        const alteTage = tageIdsZwischen(balkenEl.dataset.vonId, balkenEl.dataset.bisId);
        await personBalkenSpeichern({ alterName: balkenEl.dataset.name, alteTage, namenText: balkenEl.dataset.name, vonId, bisId });

    } else if (typ === "ereignis") {

        const istHaupt = balkenEl.dataset.segment === "haupt";
        const daten = istHaupt
            ? { vonDatum: vonId, bisDatum: bisId }
            : { verschiebeVon: vonId, verschiebeBis: bisId };

        await setDoc(doc(db, "ereignisse", balkenEl.dataset.id), daten, { merge: true });

        // Bei Projekt-Ereignissen auch das Projekt-Dokument selbst
        // nachführen, sonst würde ein erneutes Speichern des Projekts den
        // hier verschobenen/verlängerten Balken wieder zurücksetzen.
        const projektId = ereignisse.find(e => e.id === balkenEl.dataset.id)?.projektId;

        if (projektId && istHaupt) {
            await setDoc(doc(db, "projekte", projektId), { startDatum: vonId, endDatum: bisId }, { merge: true });
        } else if (projektId) {
            await projektVerschiebedatumSynchronisieren(balkenEl.dataset.id, vonId, bisId);
        }

    } else if (typ === "notiz") {

        const alteId = balkenEl.dataset.id;

        if (vonId === alteId) {
            render();
            return;
        }

        const text = tageDaten[alteId]?.aktivitaet || "";
        const batch = writeBatch(db);
        batch.set(doc(db, "tage", alteId), { aktivitaet: "" }, { merge: true });
        batch.set(doc(db, "tage", vonId), { aktivitaet: text }, { merge: true });
        await batch.commit();

    }

}

function aufZeigerAbwaerts(e) {

    const balken = e.target.closest("[data-balken]");

    if (balken) {
        balkenZiehenStarten(e, balken);
        return;
    }

    const spur = e.target.closest("[data-neu]");

    if (spur) {
        spurZiehenStarten(e, spur);
    }

}

// --- Personen-Dialog ---
// Kein Datumsfeld mehr: der Zeitraum kommt ausschliesslich vom gezogenen
// Balken (siehe Feedback) und wird hier nur schreibgeschützt angezeigt.

function personDialogOeffnen({ alterName = null, alteTage = [], vonId, bisId }) {

    personDialogZustand = { alterName, alteTage, vonId, bisId };
    const istBearbeitung = alteTage.length > 0;

    document.getElementById("personTitelUeberschrift").textContent = istBearbeitung
        ? "Eintrag bearbeiten"
        : alterName ? `Weiterer Zeitraum für ${alterName}` : "Person(en) eintragen";

    document.getElementById("personNameFeld").value = alterName || "";
    document.getElementById("personZeitraumAnzeige").textContent = formatZeitraum(vonId, bisId);

    document.getElementById("personAktionen").innerHTML = `
        <button onclick="window.personBalkenSpeichernAusFormular()">Speichern</button>
        ${istBearbeitung ? `<button type="button" class="loeschen-button" onclick="window.personBalkenLoeschen()">Löschen</button>` : ""}
        <button type="button" class="abbrechen-button" onclick="window.schliessePersonOverlay()">Abbrechen</button>
    `;

    document.getElementById("personOverlay").classList.remove("hidden");
    document.getElementById("personNameFeld").focus();

}

function neuePersonButton() {
    personDialogOeffnen({ vonId: datumZuId(heute), bisId: datumZuId(tagePlus(heute, 6)) });
}

function schliessePersonOverlay() {
    document.getElementById("personOverlay").classList.add("hidden");
    personDialogZustand = null;
}

async function personBalkenSpeichern({ alterName, alteTage, namenText, vonId, bisId }) {

    const neueNamen = [...new Set(namenText.split(",").map(s => s.trim()).filter(Boolean))];

    if (!neueNamen.length) {
        return;
    }

    const neueTage = tageIdsZwischen(vonId, bisId);
    const batch = writeBatch(db);

    if (alterName) {
        alteTage.forEach(id => batch.set(doc(db, "tage", id), { personen: arrayRemove(alterName) }, { merge: true }));
    }

    neueTage.forEach(id => {
        neueNamen.forEach(name => batch.set(doc(db, "tage", id), { personen: arrayUnion(name) }, { merge: true }));
    });

    await batch.commit();

}

async function personBalkenSpeichernAusFormular() {

    const namenText = document.getElementById("personNameFeld").value.trim();

    if (!namenText) {
        alert("Bitte mindestens einen Namen eingeben.");
        return;
    }

    const { alterName, alteTage, vonId, bisId } = personDialogZustand;
    await personBalkenSpeichern({ alterName, alteTage, namenText, vonId, bisId });
    schliessePersonOverlay();

}

async function personBalkenLoeschen() {

    if (!personDialogZustand?.alterName) {
        return;
    }

    if (!confirm(`"${personDialogZustand.alterName}" wirklich aus diesem Zeitraum entfernen?`)) {
        return;
    }

    const batch = writeBatch(db);

    personDialogZustand.alteTage.forEach(id => {
        batch.set(doc(db, "tage", id), { personen: arrayRemove(personDialogZustand.alterName) }, { merge: true });
    });

    await batch.commit();
    schliessePersonOverlay();

}

// --- Ereignis-Dialog ---
// Kein Datumsfeld mehr: Zeitraum und Verschiebedatum kommen ausschliesslich
// vom gezogenen/eingezeichneten Balken (siehe Feedback) und werden hier nur
// schreibgeschützt angezeigt.

function ereignisFormularZuruecksetzen() {
    document.getElementById("ereignisTitelFeld").disabled = false;
    document.getElementById("ereignisProjektHinweis").innerHTML = "";
}

function ereignisZeitraumAnzeigen() {
    document.getElementById("ereignisZeitraumAnzeige").textContent =
        formatZeitraum(ereignisDialogZustand.vonId, ereignisDialogZustand.bisId);
}

// Verschiebedatum-Bereich im Dialog: zeigt entweder den bereits gesetzten
// Zeitraum (mit Entfernen-Button) oder den Zeichnen-Button an – bei
// Projekt-Ereignissen nur lesend (dort kommt das Verschiebedatum aus dem
// Projekt selbst).
function renderVerschiebeAnzeige(ereignis) {

    const el = document.getElementById("ereignisVerschiebeAnzeige");

    if (!ereignis.verschiebeVon || !ereignis.verschiebeBis) {
        el.innerHTML = `<button type="button" class="abbrechen-button" onclick="window.verschiebedatumZeichnenStarten()">Verschiebedatum zeichnen…</button>`;
        return;
    }

    el.innerHTML = `
        <p class="hinweis-text">Verschoben auf: ${formatZeitraum(ereignis.verschiebeVon, ereignis.verschiebeBis)}</p>
        <button type="button" class="abbrechen-button" onclick="window.verschiebedatumEntfernen()">Entfernen</button>
    `;

}

function neuesEreignis(prefill) {

    bearbeitetesEreignisId = null;
    ereignisDialogZustand = {
        vonId: prefill?.vonId || datumZuId(heute),
        bisId: prefill?.bisId || prefill?.vonId || datumZuId(heute)
    };

    document.getElementById("ereignisTitelUeberschrift").textContent = "Neues Ereignis";
    ereignisFormularZuruecksetzen();

    document.getElementById("ereignisTitelFeld").value = "";
    ereignisZeitraumAnzeigen();
    renderVerschiebeAnzeige({ projektId: null, verschiebeVon: null, verschiebeBis: null });

    document.getElementById("ereignisAktionen").innerHTML = `
        <button onclick="window.ereignisSpeichern()">Speichern</button>
        <button type="button" class="abbrechen-button" onclick="window.schliesseEreignisOverlay()">Abbrechen</button>
    `;

    document.getElementById("ereignisOverlay").classList.remove("hidden");
    document.getElementById("ereignisTitelFeld").focus();

}

function ereignisOeffnen(id) {

    const ereignis = ereignisse.find(e => e.id === id);

    if (!ereignis) {
        return;
    }

    bearbeitetesEreignisId = id;
    ereignisDialogZustand = { vonId: ereignis.vonDatum, bisId: ereignis.bisDatum };
    ereignisFormularZuruecksetzen();

    document.getElementById("ereignisTitelFeld").value = ereignis.titel || "";
    ereignisZeitraumAnzeigen();
    renderVerschiebeAnzeige(ereignis);

    if (ereignis.projektId) {

        document.getElementById("ereignisTitelUeberschrift").textContent = "Projekt-Ereignis";
        document.getElementById("ereignisTitelFeld").disabled = true;

        document.getElementById("ereignisProjektHinweis").innerHTML = `
            <p class="hinweis-text">
                Verknüpft mit einem Projekt – nur der Titel lässt sich nur
                dort ändern. Den Balken kannst du hier direkt verschieben
                oder an den Enden ziehen, das Projekt wird automatisch
                nachgeführt.
            </p>
        `;

        document.getElementById("ereignisAktionen").innerHTML = `
            <a href="../projekte/" class="abbrechen-button ereignis-projekt-link">Zum Projekt</a>
            <button type="button" class="abbrechen-button" onclick="window.schliesseEreignisOverlay()">Schliessen</button>
        `;

    } else {

        document.getElementById("ereignisTitelUeberschrift").textContent = "Ereignis bearbeiten";

        document.getElementById("ereignisAktionen").innerHTML = `
            <button onclick="window.ereignisSpeichern()">Speichern</button>
            <button type="button" class="loeschen-button" onclick="window.ereignisLoeschen()">Ganzes Ereignis löschen</button>
            <button type="button" class="abbrechen-button" onclick="window.schliesseEreignisOverlay()">Abbrechen</button>
        `;

    }

    document.getElementById("ereignisOverlay").classList.remove("hidden");

}

function schliesseEreignisOverlay() {
    document.getElementById("ereignisOverlay").classList.add("hidden");
}

async function ereignisGrunddatenSpeichernOhneSchliessen() {

    const titel = document.getElementById("ereignisTitelFeld").value.trim();

    if (!titel) {
        alert("Bitte einen Titel angeben.");
        return null;
    }

    const { vonId, bisId } = ereignisDialogZustand;
    const id = bearbeitetesEreignisId || doc(collection(db, "ereignisse")).id;

    // verschiebeVon/-Bis werden hier bewusst nicht angefasst (merge:true) –
    // die werden ausschliesslich über das Zeichnen bzw. "Entfernen" gesetzt.
    const daten = {
        titel,
        vonDatum: vonId,
        bisDatum: bisId,
        projektId: null
    };

    if (!bearbeitetesEreignisId) {
        daten.erstelltAm = serverTimestamp();
    }

    await setDoc(doc(db, "ereignisse", id), daten, { merge: true });
    bearbeitetesEreignisId = id;
    return id;

}

async function ereignisSpeichern() {
    const id = await ereignisGrunddatenSpeichernOhneSchliessen();
    if (id) {
        schliesseEreignisOverlay();
    }
}

async function ereignisLoeschen() {

    if (!bearbeitetesEreignisId) {
        return;
    }

    if (!confirm("Ganzes Ereignis wirklich löschen (inkl. Verschiebedatum, falls gesetzt)?")) {
        return;
    }

    await deleteDoc(doc(db, "ereignisse", bearbeitetesEreignisId));
    schliesseEreignisOverlay();

}

// --- Verschiebedatum zeichnen ---

function zeichenHinweisAnzeigen(text) {
    document.getElementById("zlZeichenHinweisText").textContent = text;
    document.getElementById("zlZeichenHinweis").classList.remove("hidden");
}

function zeichenHinweisVerbergen() {
    document.getElementById("zlZeichenHinweis").classList.add("hidden");
}

async function verschiebedatumZeichnenStarten() {

    // Projekt-Ereignisse existieren immer schon (deterministische ID) und
    // dürfen NICHT über ereignisGrunddatenSpeichernOhneSchliessen()
    // laufen - die setzt projektId:null und würde die Projekt-Verknüpfung
    // kappen. Für sie reicht die vorhandene ID.
    const bestehendesEreignis = ereignisse.find(e => e.id === bearbeitetesEreignisId);
    let id = bestehendesEreignis?.projektId ? bestehendesEreignis.id : null;
    const titel = bestehendesEreignis?.titel || document.getElementById("ereignisTitelFeld").value.trim();

    if (!id) {
        id = await ereignisGrunddatenSpeichernOhneSchliessen();
        if (!id) {
            return;
        }
    }

    schliesseEreignisOverlay();
    ereignisVerschiebeZeichnenId = id;
    zeichenHinweisAnzeigen(`Verschiebedatum für "${titel}": Balken in der Ereigniszeile einzeichnen …`);
    render();

}

function verschiebedatumZeichnenAbbrechen() {
    ereignisVerschiebeZeichnenId = null;
    zeichenHinweisVerbergen();
    render();
}

// Bei Projekt-Ereignissen zusätzlich das Projekt-Dokument selbst
// nachführen (siehe balkenAendernSpeichern) – sonst würde ein erneutes
// Speichern des Projekts diese Änderung wieder zurücksetzen.
async function projektVerschiebedatumSynchronisieren(ereignisId, verschiebeStart, verschiebeEnde) {

    const projektId = ereignisse.find(e => e.id === ereignisId)?.projektId;

    if (projektId) {
        await setDoc(doc(db, "projekte", projektId), { verschiebeStart, verschiebeEnde }, { merge: true });
    }

}

async function verschiebedatumEntfernen() {

    if (!bearbeitetesEreignisId) {
        return;
    }

    if (!confirm("Verschiebedatum wirklich entfernen?")) {
        return;
    }

    await setDoc(doc(db, "ereignisse", bearbeitetesEreignisId), {
        verschiebeVon: deleteField(),
        verschiebeBis: deleteField()
    }, { merge: true });

    await projektVerschiebedatumSynchronisieren(bearbeitetesEreignisId, deleteField(), deleteField());

    schliesseEreignisOverlay();

}

async function verschiebedatumUebernehmen(vonId, bisId) {

    const id = ereignisVerschiebeZeichnenId;
    ereignisVerschiebeZeichnenId = null;
    zeichenHinweisVerbergen();

    if (!id) {
        return;
    }

    await setDoc(doc(db, "ereignisse", id), { verschiebeVon: vonId, verschiebeBis: bisId }, { merge: true });
    await projektVerschiebedatumSynchronisieren(id, vonId, bisId);
    render();

}

// --- Tagesnotiz-Dialog ---

function tagesnotizDialogOeffnen(id) {

    bearbeitetesNotizDatum = id;
    const text = tageDaten[id]?.aktivitaet || "";

    document.getElementById("notizTitelUeberschrift").textContent = text ? "Tagesnotiz bearbeiten" : "Neue Tagesnotiz";
    document.getElementById("notizDatumAnzeige").textContent = formatDatumLang(id);
    document.getElementById("notizTextFeld").value = text;

    document.getElementById("notizAktionen").innerHTML = `
        <button onclick="window.notizSpeichern()">Speichern</button>
        ${text ? `<button type="button" class="loeschen-button" onclick="window.notizLoeschen()">Löschen</button>` : ""}
        <button type="button" class="abbrechen-button" onclick="window.schliesseNotizOverlay()">Abbrechen</button>
    `;

    document.getElementById("notizOverlay").classList.remove("hidden");
    document.getElementById("notizTextFeld").focus();

}

function schliesseNotizOverlay() {
    document.getElementById("notizOverlay").classList.add("hidden");
    bearbeitetesNotizDatum = null;
}

async function notizSpeichern() {
    const text = document.getElementById("notizTextFeld").value.trim();
    await setDoc(doc(db, "tage", bearbeitetesNotizDatum), { aktivitaet: text }, { merge: true });
    schliesseNotizOverlay();
}

async function notizLoeschen() {
    await setDoc(doc(db, "tage", bearbeitetesNotizDatum), { aktivitaet: "" }, { merge: true });
    schliesseNotizOverlay();
}

// --- Hilfe-Overlay ---

function hilfeOeffnen() {
    document.getElementById("hilfeOverlay").classList.remove("hidden");
}

function hilfeSchliessen() {
    document.getElementById("hilfeOverlay").classList.add("hidden");
}

window.hilfeOeffnen = hilfeOeffnen;
window.hilfeSchliessen = hilfeSchliessen;
window.heuteAnzeigen = heuteAnzeigen;
window.neuePersonButton = neuePersonButton;
window.schliessePersonOverlay = schliessePersonOverlay;
window.personBalkenSpeichernAusFormular = personBalkenSpeichernAusFormular;
window.personBalkenLoeschen = personBalkenLoeschen;
window.neuesEreignis = neuesEreignis;
window.ereignisOeffnen = ereignisOeffnen;
window.schliesseEreignisOverlay = schliesseEreignisOverlay;
window.ereignisSpeichern = ereignisSpeichern;
window.ereignisLoeschen = ereignisLoeschen;
window.verschiebedatumZeichnenStarten = verschiebedatumZeichnenStarten;
window.verschiebedatumZeichnenAbbrechen = verschiebedatumZeichnenAbbrechen;
window.verschiebedatumEntfernen = verschiebedatumEntfernen;
window.schliesseNotizOverlay = schliesseNotizOverlay;
window.notizSpeichern = notizSpeichern;
window.notizLoeschen = notizLoeschen;

init();

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js").then(() => {
        console.log("Kalender Service Worker registriert");
    });
}

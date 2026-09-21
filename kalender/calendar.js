import { db } from "./firebase-config.js";
import {
    arrayRemove,
    arrayUnion,
    collection,
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

const MONATSNAMEN = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember"
];

const MONATSNAMEN_KURZ = [
    "Jan", "Feb", "Mär", "Apr", "Mai", "Jun",
    "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"
];

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const heute = new Date();

// Browser-Ansicht (breiterer Viewport) zeigt mehr Namen pro Tag in der
// Monatsansicht, bevor auf "+N" zusammengefasst wird – die passende
// Zellbreite/-höhe dafür liefert die @media-Regel in style.css.
const breitAnsichtMedia = window.matchMedia("(min-width: 900px)");

function chipLimitProZelle() {
    // Die Browser-Ansicht ist jetzt kompakter (Kalender + Auswahl-Leiste
    // nebeneinander statt eine breite Spalte allein), daher ein kleinerer
    // Wert als früher.
    return breitAnsichtMedia.matches ? 6 : 3;
}

let ansicht = "monat"; // "monat" | "woche"
let cursorDatum = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
let tageDaten = {}; // "YYYY-MM-DD" -> { personen: string[], aktivitaet: string }
let unsubscribeZeitraum = null;
let ausgewaehlteTage = new Set();
let letzterKlickId = null; // Anker für Shift-Klick-Bereiche
let letzteAktion = "hinzugefuegt"; // "hinzugefuegt" | "entfernt" – wird bei Shift-Klick auf den ganzen Bereich angewendet

let ereignisse = []; // [{ id, titel, vonDatum, bisDatum, projektId }] – komplette Collection, siehe Plan
let bearbeitetesEreignisId = null; // null = neues Ereignis wird angelegt

function init() {

    abonniereZeitraum();
    abonniereEreignisse();
    renderAlles();

}

function abonniereEreignisse() {

    onSnapshot(collection(db, "ereignisse"), snapshot => {

        ereignisse = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderKalender();

    }, error => {

        console.error("Ereignisse konnten nicht geladen werden:", error);

    });

}

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

function anzahlTageImMonat(jahr, monat) {
    return new Date(jahr, monat + 1, 0).getDate();
}

function montagDerWoche(datum) {
    const versatz = (datum.getDay() + 6) % 7; // Mo=0 ... So=6
    const montag = new Date(datum);
    montag.setDate(datum.getDate() - versatz);
    return montag;
}

// Osterdatum nach dem gaußschen Osteralgorithmus (Meeus/Jones/Butcher) –
// daraus lassen sich alle beweglichen Feiertage (Karfreitag, Auffahrt,
// Pfingsten, ...) für jedes beliebige Jahr herleiten, ohne Daten pflegen
// zu müssen.
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

function tagePlus(datum, n) {
    const neu = new Date(datum);
    neu.setDate(neu.getDate() + n);
    return neu;
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

function ereignisseFuerTag(id) {
    return ereignisse.filter(e => e.vonDatum <= id && e.bisDatum >= id);
}

// HTML-Escaping für alles, was Nutzer als Freitext eingeben (Namen,
// Aktivitäten) – die Werte kommen ungeprüft von anderen Besuchern.
// Escaped auch Anführungszeichen, damit die Werte sicher innerhalb von
// HTML-Attributen (z.B. data-name="...") verwendet werden können.
function escapeHtml(text) {

    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

// Grenzen des aktuell sichtbaren Zeitraums (Monat oder Woche) rund um
// cursorDatum.
function zeitraumGrenzen() {

    if (ansicht === "woche") {

        const von = montagDerWoche(cursorDatum);
        const bis = new Date(von);
        bis.setDate(von.getDate() + 6);

        return { von, bis };

    }

    const jahr = cursorDatum.getFullYear();
    const monat = cursorDatum.getMonth();

    return {
        von: new Date(jahr, monat, 1),
        bis: new Date(jahr, monat, anzahlTageImMonat(jahr, monat))
    };

}

function abonniereZeitraum() {

    if (unsubscribeZeitraum) {
        unsubscribeZeitraum();
    }

    const { von, bis } = zeitraumGrenzen();
    const vonId = datumZuId(von);
    const bisId = datumZuId(bis);

    const q = query(
        collection(db, "tage"),
        orderBy(documentId()),
        startAt(vonId),
        endAt(bisId)
    );

    unsubscribeZeitraum = onSnapshot(q, snapshot => {

        // Nur den sichtbaren Zeitraum neu befüllen – Tage ohne Dokument
        // (also ohne Eintrag) bleiben einfach weg.
        for (const tag = new Date(von); tag <= bis; tag.setDate(tag.getDate() + 1)) {
            delete tageDaten[datumZuId(tag)];
        }

        snapshot.forEach(docSnap => {
            tageDaten[docSnap.id] = docSnap.data();
        });

        renderKalender();
        renderAuswahlLeiste();

    }, error => {

        console.error("Kalender konnte nicht geladen werden:", error);

        document.getElementById("kalenderGrid").innerHTML =
            "<p>⚠️ Kalender konnte nicht geladen werden. Bitte Internetverbindung prüfen.</p>";

    });

}

function renderAlles() {

    renderAnsichtUmschalter();
    renderKalender();
    renderAuswahlLeiste();

}

function ansichtWechseln(neu) {

    if (neu === ansicht) {
        return;
    }

    ansicht = neu;
    ausgewaehlteTage.clear();
    letzterKlickId = null;

    abonniereZeitraum();
    renderAlles();

}

function zeitraumWechseln(delta) {

    if (ansicht === "woche") {
        cursorDatum.setDate(cursorDatum.getDate() + delta * 7);
    } else {
        cursorDatum.setMonth(cursorDatum.getMonth() + delta);
    }

    ausgewaehlteTage.clear();
    letzterKlickId = null;

    abonniereZeitraum();
    renderAlles();

}

function heuteAnzeigen() {

    cursorDatum = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
    ausgewaehlteTage.clear();
    letzterKlickId = null;

    abonniereZeitraum();
    renderAlles();

}

function renderAnsichtUmschalter() {

    document.getElementById("ansichtUmschalter").innerHTML = `
        <div class="ansicht-zeile">
            <div class="ansicht-umschalter">
                <button
                    class="umschalt-button ${ansicht === "monat" ? "aktiv" : ""}"
                    onclick="window.ansichtWechseln('monat')"
                >Monat</button>
                <button
                    class="umschalt-button ${ansicht === "woche" ? "aktiv" : ""}"
                    onclick="window.ansichtWechseln('woche')"
                >Woche</button>
            </div>
            <button class="heute-button" onclick="window.heuteAnzeigen()">Heute</button>
            <button class="ereignis-button" onclick="window.neuesEreignis()">+ Ereignis</button>
        </div>
    `;

}

function renderKalender() {

    if (ansicht === "woche") {
        renderWochenansicht();
    } else {
        renderMonatsansicht();
    }

}

// Ereignisse, die sich mit dieser Woche (Mo–So) überschneiden, jeweils auf
// die Woche geclippt (Spalte 0=Mo ... 6=So) und einer Lane zugewiesen –
// Standard-Interval-Scheduling, damit sich überlappende Ereignisse nicht
// gegenseitig überdecken.
function ereignisLanesFuerWoche(wochenMontag, wochenSonntag) {

    const vonId = datumZuId(wochenMontag);
    const bisId = datumZuId(wochenSonntag);

    const segmente = ereignisse
        .filter(e => e.vonDatum <= bisId && e.bisDatum >= vonId)
        .map(e => {

            const startCol = Math.max(0, Math.round((idZuDatum(e.vonDatum) - wochenMontag) / 86400000));
            const endCol = Math.min(6, Math.round((idZuDatum(e.bisDatum) - wochenMontag) / 86400000));

            return { ereignis: e, startCol, endCol };

        })
        .sort((a, b) => a.startCol - b.startCol || (b.endCol - b.startCol) - (a.endCol - a.startCol));

    const laneEnden = []; // laneEnden[i] = letzte belegte Spalte der Lane i
    const platzierte = [];

    segmente.forEach(seg => {

        let lane = laneEnden.findIndex(letzteSpalte => letzteSpalte < seg.startCol);

        if (lane === -1) {
            lane = laneEnden.length;
        }

        laneEnden[lane] = seg.endCol;
        platzierte.push({ ...seg, lane });

    });

    return platzierte;

}

function renderMonatsansicht() {

    const jahr = cursorDatum.getFullYear();
    const monat = cursorDatum.getMonth();

    document.getElementById("monatsNavigation").innerHTML = `
        <button onclick="window.zeitraumWechseln(-1)" class="nav-button">‹</button>
        <span class="zeitraum-titel">${MONATSNAMEN[monat]} ${jahr}</span>
        <button onclick="window.zeitraumWechseln(1)" class="nav-button">›</button>
    `;

    const ersterWochentag = (new Date(jahr, monat, 1).getDay() + 6) % 7; // Mo=0
    const anzahlTage = anzahlTageImMonat(jahr, monat);
    const heuteId = datumZuId(heute);

    const anzahlWochen = Math.ceil((ersterWochentag + anzahlTage) / 7);
    const ersterMontag = montagDerWoche(new Date(jahr, monat, 1));

    const limit = chipLimitProZelle();

    let wochenHtml = "";

    for (let w = 0; w < anzahlWochen; w++) {

        const wochenMontag = tagePlus(ersterMontag, w * 7);
        const wochenSonntag = tagePlus(wochenMontag, 6);

        let tageHtml = "";

        for (let spalte = 0; spalte < 7; spalte++) {

            const tagDatumObj = tagePlus(wochenMontag, spalte);

            if (tagDatumObj.getMonth() !== monat) {
                tageHtml += `<div class="tag-zelle leer"></div>`;
                continue;
            }

            const id = datumZuId(tagDatumObj);
            const eintrag = tageDaten[id];
            const personen = eintrag?.personen || [];
            const aktivitaet = eintrag?.aktivitaet || "";
            const feiertag = feiertagName(tagDatumObj);

            const chips = personen
                .slice(0, limit)
                .map(name => `<span class="person-chip">${escapeHtml(name)}</span>`)
                .join("");

            const mehrChip = personen.length > limit
                ? `<span class="person-chip mehr">+${personen.length - limit}</span>`
                : "";

            const aktivitaetSnippet = aktivitaet
                ? `<div class="tag-aktivitaet">${escapeHtml(aktivitaet)}</div>`
                : "";

            const feiertagLabel = feiertag
                ? `<div class="feiertag-label">${escapeHtml(feiertag)}</div>`
                : "";

            const heuteKlasse = id === heuteId ? " heute" : "";
            const ausgewaehltKlasse = ausgewaehlteTage.has(id) ? " ausgewaehlt" : "";
            const feiertagKlasse = feiertag ? " feiertag" : "";

            tageHtml += `
                <div class="tag-zelle${heuteKlasse}${feiertagKlasse}${ausgewaehltKlasse}" onclick="window.toggleTag('${id}', event)">
                    <div class="tag-nummer">${tagDatumObj.getDate()}</div>
                    ${feiertagLabel}
                    <div class="person-chips">${chips}${mehrChip}</div>
                    ${aktivitaetSnippet}
                </div>
            `;

        }

        const balkenHtml = ereignisLanesFuerWoche(wochenMontag, wochenSonntag).map(seg => {

            const projektKlasse = seg.ereignis.projektId ? " projekt-verknuepft" : "";

            return `
                <div class="ereignis-balken${projektKlasse}"
                    style="grid-column:${seg.startCol + 1} / ${seg.endCol + 2}; grid-row:${seg.lane + 2};"
                    onclick="event.stopPropagation(); window.ereignisOeffnen('${seg.ereignis.id}')"
                >${escapeHtml(seg.ereignis.titel)}</div>
            `;

        }).join("");

        wochenHtml += `<div class="monat-woche">${tageHtml}${balkenHtml}</div>`;

    }

    document.getElementById("kalenderGrid").innerHTML = `
        <div class="wochentage-reihe">
            ${WOCHENTAGE.map(w => `<div class="wochentag">${w}</div>`).join("")}
        </div>
        <div class="monat-wochen-liste">
            ${wochenHtml}
        </div>
    `;

}

function renderWochenansicht() {

    const montag = montagDerWoche(cursorDatum);
    const sonntag = new Date(montag);
    sonntag.setDate(montag.getDate() + 6);

    const titel = montag.getMonth() === sonntag.getMonth()
        ? `${montag.getDate()}.–${sonntag.getDate()}. ${MONATSNAMEN[montag.getMonth()]} ${montag.getFullYear()}`
        : `${montag.getDate()}. ${MONATSNAMEN_KURZ[montag.getMonth()]} – ${sonntag.getDate()}. ${MONATSNAMEN_KURZ[sonntag.getMonth()]} ${sonntag.getFullYear()}`;

    document.getElementById("monatsNavigation").innerHTML = `
        <button onclick="window.zeitraumWechseln(-1)" class="nav-button">‹</button>
        <span class="zeitraum-titel">${titel}</span>
        <button onclick="window.zeitraumWechseln(1)" class="nav-button">›</button>
    `;

    const heuteId = datumZuId(heute);

    let zeilen = "";

    for (let i = 0; i < 7; i++) {

        const tagDatum = new Date(montag);
        tagDatum.setDate(montag.getDate() + i);

        const id = datumZuId(tagDatum);
        const eintrag = tageDaten[id];
        const personen = eintrag?.personen || [];
        const aktivitaet = eintrag?.aktivitaet || "";
        const feiertag = feiertagName(tagDatum);
        const tagEreignisse = ereignisseFuerTag(id);

        const chips = personen.length
            ? personen.map(name => `<span class="person-chip">${escapeHtml(name)}</span>`).join("")
            : `<span class="wochen-leer-hinweis">Niemand eingetragen</span>`;

        const ereignisChips = tagEreignisse.length
            ? `<div class="ereignis-chips">${tagEreignisse.map(e => `
                    <span class="ereignis-chip${e.projektId ? " projekt-verknuepft" : ""}" onclick="event.stopPropagation(); window.ereignisOeffnen('${e.id}')">
                        ${escapeHtml(e.titel)}
                    </span>
                `).join("")}</div>`
            : "";

        const heuteKlasse = id === heuteId ? " heute" : "";
        const ausgewaehltKlasse = ausgewaehlteTage.has(id) ? " ausgewaehlt" : "";
        const feiertagKlasse = feiertag ? " feiertag" : "";

        zeilen += `
            <div class="wochen-zeile${heuteKlasse}${feiertagKlasse}${ausgewaehltKlasse}" onclick="window.toggleTag('${id}', event)">
                <div class="wochen-datum">
                    <span class="wochen-wochentag">${WOCHENTAGE[i]}</span>
                    <span class="wochen-tagnummer">${tagDatum.getDate()}.${pad(tagDatum.getMonth() + 1)}.</span>
                </div>
                <div class="wochen-inhalt">
                    ${feiertag ? `<div class="feiertag-label">${escapeHtml(feiertag)}</div>` : ""}
                    <div class="person-chips">${chips}</div>
                    ${ereignisChips}
                    ${aktivitaet ? `<div class="tag-aktivitaet">${escapeHtml(aktivitaet)}</div>` : ""}
                </div>
            </div>
        `;

    }

    document.getElementById("kalenderGrid").innerHTML = `
        <div class="wochen-liste">
            ${zeilen}
        </div>
    `;

}

function toggleTag(id, event) {

    if (event?.shiftKey && letzterKlickId) {

        // Shift-Klick: ganzen Bereich zwischen dem letzten Klick und
        // diesem Tag mit derselben Aktion (hinzufügen/entfernen) belegen,
        // die der letzte einzelne Klick ausgelöst hat.
        const [von, bis] = [idZuDatum(letzterKlickId), idZuDatum(id)]
            .sort((a, b) => a - b);

        for (const tag = new Date(von); tag <= bis; tag.setDate(tag.getDate() + 1)) {

            const tagId = datumZuId(tag);

            if (letzteAktion === "entfernt") {
                ausgewaehlteTage.delete(tagId);
            } else {
                ausgewaehlteTage.add(tagId);
            }

        }

    } else if (ausgewaehlteTage.has(id)) {

        ausgewaehlteTage.delete(id);
        letzteAktion = "entfernt";
        letzterKlickId = id;

    } else {

        ausgewaehlteTage.add(id);
        letzteAktion = "hinzugefuegt";
        letzterKlickId = id;

    }

    renderKalender();
    renderAuswahlLeiste();

}

function auswahlAufheben() {

    ausgewaehlteTage.clear();
    letzterKlickId = null;
    renderKalender();
    renderAuswahlLeiste();

}

function formatDatumKurz(id) {

    const [jahr, monat, tag] = id.split("-").map(Number);
    return `${tag}. ${MONATSNAMEN_KURZ[monat - 1]}`;

}

function formatDatumLang(id) {

    const [jahr, monat, tag] = id.split("-").map(Number);
    return `${tag}. ${MONATSNAMEN[monat - 1]} ${jahr}`;

}

// Liefert die gemeinsame Personen-Liste, wenn ALLE ausgewählten Tage
// exakt dieselbe Belegung haben (unabhängig von der Reihenfolge) – sonst
// null. Nur dann ist "eine" Liste mit Entfernen-Buttons überhaupt
// sinnvoll darstellbar.
function gemeinsamePersonen() {

    const ids = [...ausgewaehlteTage];

    const listen = ids.map(id => (tageDaten[id]?.personen || []).slice().sort());
    const erste = JSON.stringify(listen[0] || []);

    const alleGleich = listen.every(liste => JSON.stringify(liste) === erste);

    return alleGleich ? (listen[0] || []) : null;

}

// Liefert die gemeinsame Aktivität, wenn alle ausgewählten Tage denselben
// Text haben – sonst "" (das Textfeld wird dann einfach leer angezeigt,
// bis explizit gespeichert wird; nichts wird automatisch überschrieben).
function gemeinsameAktivitaet() {

    const ids = [...ausgewaehlteTage];
    const werte = ids.map(id => tageDaten[id]?.aktivitaet || "");
    const erste = werte[0] ?? "";

    return werte.every(w => w === erste) ? erste : "";

}

function renderAuswahlLeiste() {

    const box = document.getElementById("auswahlLeiste");

    if (ausgewaehlteTage.size === 0) {
        box.innerHTML = "";
        return;
    }

    const ids = [...ausgewaehlteTage].sort();
    const einzelTag = ids.length === 1;

    const titel = einzelTag
        ? formatDatumLang(ids[0])
        : `${ids.length} Tage ausgewählt`;

    const datumChips = !einzelTag
        ? `<div class="person-chips ausgewaehlte-tage-chips">
               ${ids.map(id => `<span class="person-chip datum-chip">${formatDatumKurz(id)}</span>`).join("")}
           </div>`
        : "";

    const personen = gemeinsamePersonen();

    let personenBereich;

    if (personen === null) {

        personenBereich = `<p class="hinweis-text">
            Die ausgewählten Tage haben unterschiedliche Personen – wähle
            nur Tage mit gleicher Belegung aus, um sie hier zu sehen und
            zu entfernen.
        </p>`;

    } else if (personen.length === 0) {

        personenBereich = `<p class="hinweis-text">Noch niemand eingetragen.</p>`;

    } else {

        personenBereich = `
            <ul class="personen-liste">
                ${personen.map(name => `
                    <li>
                        ${escapeHtml(name)}
                        <button
                            class="entfernen-button"
                            data-name="${escapeHtml(name)}"
                            onclick="window.entfernePersonAusAuswahl(this.dataset.name)"
                        >✕</button>
                    </li>
                `).join("")}
            </ul>
        `;

    }

    const aktivitaet = gemeinsameAktivitaet();

    box.innerHTML = `
        <div class="auswahl-panel">

            <h2>${titel}</h2>
            ${datumChips}

            ${personenBereich}

            <div class="name-hinzufuegen-reihe">
                <input
                    type="text"
                    id="nameFeld"
                    placeholder="Name"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();window.nameHinzufuegen();}"
                >
                <button onclick="window.nameHinzufuegen()" class="hinzufuegen-button">
                    Hinzufügen
                </button>
            </div>

            <label class="aktivitaet-label">
                Aktivität an ${einzelTag ? "diesem Tag" : "diesen Tagen"}:
                <textarea id="aktivitaetFeld" rows="3">${escapeHtml(aktivitaet)}</textarea>
            </label>

            <button onclick="window.aktivitaetSpeichern()">
                Aktivität speichern
            </button>

            <button onclick="window.auswahlAufheben()" class="abbrechen-button">
                Auswahl aufheben
            </button>

        </div>
    `;

}

async function nameHinzufuegen() {

    const feld = document.getElementById("nameFeld");
    const name = feld.value.trim();

    if (!name) {
        alert("Bitte einen Namen eingeben.");
        return;
    }

    const batch = writeBatch(db);

    ausgewaehlteTage.forEach(id => {
        batch.set(doc(db, "tage", id), { personen: arrayUnion(name) }, { merge: true });
    });

    await batch.commit();

    // Auswahl bleibt bestehen, damit gleich die nächste Person ergänzt
    // werden kann – nur das Eingabefeld wird für die nächste Eingabe
    // geleert.
    feld.value = "";
    feld.focus();

}

async function entfernePersonAusAuswahl(name) {

    const batch = writeBatch(db);

    ausgewaehlteTage.forEach(id => {
        batch.set(doc(db, "tage", id), { personen: arrayRemove(name) }, { merge: true });
    });

    await batch.commit();

}

async function aktivitaetSpeichern() {

    const text = document.getElementById("aktivitaetFeld").value.trim();
    const batch = writeBatch(db);

    ausgewaehlteTage.forEach(id => {
        batch.set(doc(db, "tage", id), { aktivitaet: text }, { merge: true });
    });

    await batch.commit();

}

// --- Ereignis-Editor ---

function ereignisFormularZuruecksetzen() {

    document.getElementById("ereignisTitelFeld").disabled = false;
    document.getElementById("ereignisVonFeld").disabled = false;
    document.getElementById("ereignisBisFeld").disabled = false;
    document.getElementById("ereignisProjektHinweis").innerHTML = "";

}

function neuesEreignis() {

    bearbeitetesEreignisId = null;

    const heuteId = datumZuId(heute);

    document.getElementById("ereignisTitelUeberschrift").textContent = "Neues Ereignis";
    ereignisFormularZuruecksetzen();

    document.getElementById("ereignisTitelFeld").value = "";
    document.getElementById("ereignisVonFeld").value = heuteId;
    document.getElementById("ereignisBisFeld").value = heuteId;

    document.getElementById("ereignisAktionen").innerHTML = `
        <button onclick="window.ereignisSpeichern()">Speichern</button>
        <button type="button" class="abbrechen-button" onclick="window.schliesseEreignisOverlay()">Abbrechen</button>
    `;

    document.getElementById("ereignisOverlay").classList.remove("hidden");

}

function ereignisOeffnen(id) {

    const ereignis = ereignisse.find(e => e.id === id);
    if (!ereignis) {
        return;
    }

    bearbeitetesEreignisId = id;
    ereignisFormularZuruecksetzen();

    document.getElementById("ereignisTitelFeld").value = ereignis.titel || "";
    document.getElementById("ereignisVonFeld").value = ereignis.vonDatum;
    document.getElementById("ereignisBisFeld").value = ereignis.bisDatum;

    if (ereignis.projektId) {

        document.getElementById("ereignisTitelUeberschrift").textContent = "Projekt-Ereignis";
        document.getElementById("ereignisTitelFeld").disabled = true;
        document.getElementById("ereignisVonFeld").disabled = true;
        document.getElementById("ereignisBisFeld").disabled = true;

        document.getElementById("ereignisProjektHinweis").innerHTML = `
            <p class="hinweis-text">
                Verknüpft mit einem Projekt – Titel und Zeitraum lassen sich
                nur dort ändern.
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
            <button type="button" class="loeschen-button" onclick="window.ereignisLoeschen()">Löschen</button>
            <button type="button" class="abbrechen-button" onclick="window.schliesseEreignisOverlay()">Abbrechen</button>
        `;

    }

    document.getElementById("ereignisOverlay").classList.remove("hidden");

}

function schliesseEreignisOverlay() {
    document.getElementById("ereignisOverlay").classList.add("hidden");
}

async function ereignisSpeichern() {

    const titel = document.getElementById("ereignisTitelFeld").value.trim();
    const von = document.getElementById("ereignisVonFeld").value;
    let bis = document.getElementById("ereignisBisFeld").value;

    if (!titel || !von) {
        alert("Bitte Titel und Startdatum angeben.");
        return;
    }

    if (!bis || bis < von) {
        bis = von;
    }

    const id = bearbeitetesEreignisId || doc(collection(db, "ereignisse")).id;

    const daten = { titel, vonDatum: von, bisDatum: bis, projektId: null };

    if (!bearbeitetesEreignisId) {
        daten.erstelltAm = serverTimestamp();
    }

    await setDoc(doc(db, "ereignisse", id), daten, { merge: true });

    schliesseEreignisOverlay();

}

async function ereignisLoeschen() {

    if (!bearbeitetesEreignisId) {
        return;
    }

    if (!confirm("Ereignis wirklich löschen?")) {
        return;
    }

    await deleteDoc(doc(db, "ereignisse", bearbeitetesEreignisId));

    schliesseEreignisOverlay();

}

// Von den inline onclick-Handlern im gerenderten HTML aus erreichbar
// (bei ES-Modulen sind Top-Level-Funktionen sonst nicht global sichtbar).
function hilfeOeffnen() {
    document.getElementById("hilfeOverlay").classList.remove("hidden");
}

function hilfeSchliessen() {
    document.getElementById("hilfeOverlay").classList.add("hidden");
}

window.hilfeOeffnen = hilfeOeffnen;
window.hilfeSchliessen = hilfeSchliessen;
window.ansichtWechseln = ansichtWechseln;
window.zeitraumWechseln = zeitraumWechseln;
window.heuteAnzeigen = heuteAnzeigen;
window.toggleTag = toggleTag;
window.auswahlAufheben = auswahlAufheben;
window.nameHinzufuegen = nameHinzufuegen;
window.entfernePersonAusAuswahl = entfernePersonAusAuswahl;
window.aktivitaetSpeichern = aktivitaetSpeichern;
window.neuesEreignis = neuesEreignis;
window.ereignisOeffnen = ereignisOeffnen;
window.schliesseEreignisOverlay = schliesseEreignisOverlay;
window.ereignisSpeichern = ereignisSpeichern;
window.ereignisLoeschen = ereignisLoeschen;

init();

// Beim Wechsel zwischen schmalem und breitem Fenster (z.B. Browserfenster
// vergrössern) die Chip-Anzahl pro Tag neu berechnen.
breitAnsichtMedia.addEventListener("change", () => {
    renderKalender();
});

if ("serviceWorker" in navigator) {

    navigator.serviceWorker
        .register("./service-worker.js")
        .then(() => {

            console.log("Kalender Service Worker registriert");

        });

}

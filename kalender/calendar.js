import { db } from "./firebase-config.js";
import {
    arrayRemove,
    arrayUnion,
    collection,
    doc,
    documentId,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    startAt,
    endAt,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const MEIN_NAME_KEY = "cortasiell_kalender_name";

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

let ansicht = "monat"; // "monat" | "woche"
let cursorDatum = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
let tageDaten = {}; // "YYYY-MM-DD" -> { personen: string[], aktivitaet: string }
let unsubscribeZeitraum = null;
let ausgewaehlteTage = new Set();
let meinName = localStorage.getItem(MEIN_NAME_KEY) || "";

init();

function init() {

    renderNameLeiste();
    abonniereZeitraum();
    renderAlles();

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
    renderVonBisLeiste();
    renderKalender();
    renderAuswahlLeiste();

}

function ansichtWechseln(neu) {

    if (neu === ansicht) {
        return;
    }

    ansicht = neu;
    ausgewaehlteTage.clear();

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

    abonniereZeitraum();
    renderAlles();

}

function renderNameLeiste() {

    document.getElementById("nameLeiste").innerHTML = `
        <label class="name-label">
            Dein Name:
            <input
                type="text"
                id="meinNameFeld"
                value="${escapeHtml(meinName)}"
                placeholder="z.B. Jonas"
                onchange="window.speichereMeinName()"
            >
        </label>
    `;

}

function speichereMeinName() {

    meinName = document.getElementById("meinNameFeld").value.trim();
    localStorage.setItem(MEIN_NAME_KEY, meinName);

}

function renderAnsichtUmschalter() {

    document.getElementById("ansichtUmschalter").innerHTML = `
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
    `;

}

function renderVonBisLeiste() {

    document.getElementById("vonBisLeiste").innerHTML = `
        <div class="von-bis-leiste">
            <input type="date" id="vonDatum">
            <span class="von-bis-trenner">–</span>
            <input type="date" id="bisDatum">
            <button onclick="window.bereichAuswaehlen()" class="von-bis-button">
                Bereich auswählen
            </button>
        </div>
    `;

}

function bereichAuswaehlen() {

    const vonWert = document.getElementById("vonDatum").value;
    const bisWert = document.getElementById("bisDatum").value;

    if (!vonWert || !bisWert) {
        alert("Bitte Von- und Bis-Datum wählen.");
        return;
    }

    const von = idZuDatum(vonWert);
    const bis = idZuDatum(bisWert);

    if (von > bis) {
        alert("Das Von-Datum muss vor dem Bis-Datum liegen.");
        return;
    }

    for (const tag = new Date(von); tag <= bis; tag.setDate(tag.getDate() + 1)) {
        ausgewaehlteTage.add(datumZuId(tag));
    }

    renderKalender();
    renderAuswahlLeiste();

}

function renderKalender() {

    if (ansicht === "woche") {
        renderWochenansicht();
    } else {
        renderMonatsansicht();
    }

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

    let zellen = "";

    for (let i = 0; i < ersterWochentag; i++) {
        zellen += `<div class="tag-zelle leer"></div>`;
    }

    for (let tag = 1; tag <= anzahlTage; tag++) {

        const id = datumZuId(new Date(jahr, monat, tag));
        const eintrag = tageDaten[id];
        const personen = eintrag?.personen || [];
        const aktivitaet = eintrag?.aktivitaet || "";

        const chips = personen
            .slice(0, 3)
            .map(name => `<span class="person-chip">${escapeHtml(name)}</span>`)
            .join("");

        const mehrChip = personen.length > 3
            ? `<span class="person-chip mehr">+${personen.length - 3}</span>`
            : "";

        const aktivitaetSnippet = aktivitaet
            ? `<div class="tag-aktivitaet">${escapeHtml(aktivitaet)}</div>`
            : "";

        const heuteKlasse = id === heuteId ? " heute" : "";
        const ausgewaehltKlasse = ausgewaehlteTage.has(id) ? " ausgewaehlt" : "";

        zellen += `
            <div class="tag-zelle${heuteKlasse}${ausgewaehltKlasse}" onclick="window.toggleTag('${id}')">
                <div class="tag-nummer">${tag}</div>
                <div class="person-chips">${chips}${mehrChip}</div>
                ${aktivitaetSnippet}
            </div>
        `;

    }

    document.getElementById("kalenderGrid").innerHTML = `
        <div class="wochentage-reihe">
            ${WOCHENTAGE.map(w => `<div class="wochentag">${w}</div>`).join("")}
        </div>
        <div class="tage-raster">
            ${zellen}
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

        const chips = personen.length
            ? personen.map(name => `<span class="person-chip">${escapeHtml(name)}</span>`).join("")
            : `<span class="wochen-leer-hinweis">Niemand eingetragen</span>`;

        const heuteKlasse = id === heuteId ? " heute" : "";
        const ausgewaehltKlasse = ausgewaehlteTage.has(id) ? " ausgewaehlt" : "";

        zeilen += `
            <div class="wochen-zeile${heuteKlasse}${ausgewaehltKlasse}" onclick="window.toggleTag('${id}')">
                <div class="wochen-datum">
                    <span class="wochen-wochentag">${WOCHENTAGE[i]}</span>
                    <span class="wochen-tagnummer">${tagDatum.getDate()}.${pad(tagDatum.getMonth() + 1)}.</span>
                </div>
                <div class="wochen-inhalt">
                    <div class="person-chips">${chips}</div>
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

function toggleTag(id) {

    if (ausgewaehlteTage.has(id)) {
        ausgewaehlteTage.delete(id);
    } else {
        ausgewaehlteTage.add(id);
    }

    renderKalender();
    renderAuswahlLeiste();

}

function auswahlAufheben() {

    ausgewaehlteTage.clear();
    renderKalender();
    renderAuswahlLeiste();

}

function formatDatumKurz(id) {

    const [jahr, monat, tag] = id.split("-").map(Number);
    return `${tag}. ${MONATSNAMEN_KURZ[monat - 1]}`;

}

function renderAuswahlLeiste() {

    const box = document.getElementById("auswahlLeiste");

    if (ausgewaehlteTage.size === 0) {
        box.innerHTML = "";
        return;
    }

    if (ausgewaehlteTage.size === 1) {
        renderEinzelTagDetail(box, [...ausgewaehlteTage][0]);
        return;
    }

    renderMehrfachAuswahl(box);

}

function renderEinzelTagDetail(box, id) {

    const eintrag = tageDaten[id] || { personen: [], aktivitaet: "" };
    const personen = eintrag.personen || [];
    const binDabei = meinName && personen.includes(meinName);

    const [jahr, monat, tag] = id.split("-").map(Number);
    const datumText = `${tag}. ${MONATSNAMEN[monat - 1]} ${jahr}`;

    const personenListe = personen.length
        ? personen.map(name => `
            <li>
                ${escapeHtml(name)}
                <button
                    class="entfernen-button"
                    data-name="${escapeHtml(name)}"
                    onclick="window.entfernePerson('${id}', this.dataset.name)"
                >✕</button>
            </li>
        `).join("")
        : "<li class=\"leer-hinweis\">Noch niemand eingetragen.</li>";

    box.innerHTML = `
        <div class="auswahl-panel">

            <h2>${datumText}</h2>

            <ul class="personen-liste">
                ${personenListe}
            </ul>

            <button onclick="window.ichBinDabei('${id}')" ${binDabei ? "disabled" : ""}>
                ${binDabei ? "Du bist eingetragen ✓" : "Ich bin dabei"}
            </button>

            <label class="aktivitaet-label">
                Aktivität an diesem Tag:
                <textarea id="aktivitaetFeld" rows="3">${escapeHtml(eintrag.aktivitaet)}</textarea>
            </label>

            <button onclick="window.speichereAktivitaet('${id}')">
                Aktivität speichern
            </button>

            <button onclick="window.auswahlAufheben()" class="abbrechen-button">
                Auswahl aufheben
            </button>

        </div>
    `;

}

function renderMehrfachAuswahl(box) {

    const idsSortiert = [...ausgewaehlteTage].sort();

    const chips = idsSortiert
        .map(id => `<span class="person-chip datum-chip">${formatDatumKurz(id)}</span>`)
        .join("");

    box.innerHTML = `
        <div class="auswahl-panel">

            <h2>${ausgewaehlteTage.size} Tage ausgewählt</h2>

            <div class="person-chips ausgewaehlte-tage-chips">${chips}</div>

            <label class="aktivitaet-label">
                Name für alle ausgewählten Tage:
                <input type="text" id="bulkNameFeld" value="${escapeHtml(meinName)}" placeholder="Name">
            </label>

            <button onclick="window.bulkHinzufuegen()">
                Hinzufügen
            </button>

            <button onclick="window.auswahlAufheben()" class="abbrechen-button">
                Auswahl aufheben
            </button>

        </div>
    `;

}

async function bulkHinzufuegen() {

    const name = document.getElementById("bulkNameFeld").value.trim();

    if (!name) {
        alert("Bitte einen Namen eingeben.");
        return;
    }

    const batch = writeBatch(db);

    ausgewaehlteTage.forEach(id => {
        batch.set(doc(db, "tage", id), { personen: arrayUnion(name) }, { merge: true });
    });

    await batch.commit();

    ausgewaehlteTage.clear();
    renderKalender();
    renderAuswahlLeiste();

}

async function ichBinDabei(id) {

    if (!meinName) {
        alert("Bitte zuerst oben deinen Namen eintragen.");
        return;
    }

    await setDoc(
        doc(db, "tage", id),
        { personen: arrayUnion(meinName) },
        { merge: true }
    );

}

async function entfernePerson(id, name) {

    await setDoc(
        doc(db, "tage", id),
        { personen: arrayRemove(name) },
        { merge: true }
    );

}

async function speichereAktivitaet(id) {

    const text = document.getElementById("aktivitaetFeld").value.trim();

    await setDoc(
        doc(db, "tage", id),
        { aktivitaet: text },
        { merge: true }
    );

}

// Von den inline onclick-Handlern im gerenderten HTML aus erreichbar
// (bei ES-Modulen sind Top-Level-Funktionen sonst nicht global sichtbar).
window.ansichtWechseln = ansichtWechseln;
window.zeitraumWechseln = zeitraumWechseln;
window.speichereMeinName = speichereMeinName;
window.bereichAuswaehlen = bereichAuswaehlen;
window.toggleTag = toggleTag;
window.auswahlAufheben = auswahlAufheben;
window.bulkHinzufuegen = bulkHinzufuegen;
window.ichBinDabei = ichBinDabei;
window.entfernePerson = entfernePerson;
window.speichereAktivitaet = speichereAktivitaet;

if ("serviceWorker" in navigator) {

    navigator.serviceWorker
        .register("./service-worker.js")
        .then(() => {

            console.log("Kalender Service Worker registriert");

        });

}

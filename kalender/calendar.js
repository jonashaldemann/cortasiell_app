import { db } from "./firebase-config.js";
import {
    collection,
    doc,
    documentId,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    startAt,
    endAt
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const MEIN_NAME_KEY = "cortasiell_kalender_name";

const MONATSNAMEN = [
    "Januar", "Februar", "März", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Dezember"
];

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

const heute = new Date();

let aktuellesJahr = heute.getFullYear();
let aktuellerMonat = heute.getMonth(); // 0-11
let tageDaten = {}; // "YYYY-MM-DD" -> { personen: string[], aktivitaet: string }
let unsubscribeMonat = null;
let ausgewaehlterTag = null;
let meinName = localStorage.getItem(MEIN_NAME_KEY) || "";

init();

function init() {

    renderNameLeiste();
    abonniereMonat(aktuellesJahr, aktuellerMonat);
    renderKalender();

}

function pad(n) {
    return String(n).padStart(2, "0");
}

function datumZuId(jahr, monat, tag) {
    return `${jahr}-${pad(monat + 1)}-${pad(tag)}`;
}

function anzahlTageImMonat(jahr, monat) {
    return new Date(jahr, monat + 1, 0).getDate();
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

function abonniereMonat(jahr, monat) {

    if (unsubscribeMonat) {
        unsubscribeMonat();
    }

    const vonId = datumZuId(jahr, monat, 1);
    const bisId = datumZuId(jahr, monat, anzahlTageImMonat(jahr, monat));

    const q = query(
        collection(db, "tage"),
        orderBy(documentId()),
        startAt(vonId),
        endAt(bisId)
    );

    unsubscribeMonat = onSnapshot(q, snapshot => {

        // Nur den sichtbaren Monat neu befüllen – Tage ohne Dokument
        // (also ohne Eintrag) bleiben einfach weg.
        for (let tag = 1; tag <= anzahlTageImMonat(jahr, monat); tag++) {
            delete tageDaten[datumZuId(jahr, monat, tag)];
        }

        snapshot.forEach(docSnap => {
            tageDaten[docSnap.id] = docSnap.data();
        });

        renderKalender();

        if (ausgewaehlterTag) {
            renderTagPanel();
        }

    }, error => {

        console.error("Kalender konnte nicht geladen werden:", error);

        document.getElementById("kalenderGrid").innerHTML =
            "<p>⚠️ Kalender konnte nicht geladen werden. Bitte Internetverbindung prüfen.</p>";

    });

}

function monatWechseln(delta) {

    aktuellerMonat += delta;

    if (aktuellerMonat < 0) {
        aktuellerMonat = 11;
        aktuellesJahr--;
    } else if (aktuellerMonat > 11) {
        aktuellerMonat = 0;
        aktuellesJahr++;
    }

    ausgewaehlterTag = null;

    abonniereMonat(aktuellesJahr, aktuellerMonat);
    renderKalender();
    renderTagPanel();

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

function renderKalender() {

    document.getElementById("monatsNavigation").innerHTML = `
        <button onclick="window.monatWechseln(-1)" class="nav-button">‹</button>
        <span class="monats-titel">${MONATSNAMEN[aktuellerMonat]} ${aktuellesJahr}</span>
        <button onclick="window.monatWechseln(1)" class="nav-button">›</button>
    `;

    const ersterWochentag = (new Date(aktuellesJahr, aktuellerMonat, 1).getDay() + 6) % 7; // Mo=0
    const anzahlTage = anzahlTageImMonat(aktuellesJahr, aktuellerMonat);
    const heuteId = datumZuId(heute.getFullYear(), heute.getMonth(), heute.getDate());

    let zellen = "";

    for (let i = 0; i < ersterWochentag; i++) {
        zellen += `<div class="tag-zelle leer"></div>`;
    }

    for (let tag = 1; tag <= anzahlTage; tag++) {

        const id = datumZuId(aktuellesJahr, aktuellerMonat, tag);
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
        const ausgewaehltKlasse = id === ausgewaehlterTag ? " ausgewaehlt" : "";

        zellen += `
            <div class="tag-zelle${heuteKlasse}${ausgewaehltKlasse}" onclick="window.oeffneTag('${id}')">
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

function oeffneTag(id) {

    ausgewaehlterTag = id;
    renderKalender();
    renderTagPanel();

}

function schliesseTag() {

    ausgewaehlterTag = null;
    renderKalender();
    renderTagPanel();

}

function renderTagPanel() {

    const panel = document.getElementById("tagPanel");

    if (!ausgewaehlterTag) {
        panel.innerHTML = "";
        return;
    }

    const eintrag = tageDaten[ausgewaehlterTag] || { personen: [], aktivitaet: "" };
    const personen = eintrag.personen || [];
    const binDabei = meinName && personen.includes(meinName);

    const [jahr, monat, tag] = ausgewaehlterTag.split("-").map(Number);
    const datumText = `${tag}. ${MONATSNAMEN[monat - 1]} ${jahr}`;

    const personenListe = personen.length
        ? personen.map(name => `
            <li>
                ${escapeHtml(name)}
                <button
                    class="entfernen-button"
                    data-name="${escapeHtml(name)}"
                    onclick="window.entfernePerson('${ausgewaehlterTag}', this.dataset.name)"
                >✕</button>
            </li>
        `).join("")
        : "<li class=\"leer-hinweis\">Noch niemand eingetragen.</li>";

    panel.innerHTML = `
        <div class="tag-panel-inhalt">

            <h2>${datumText}</h2>

            <ul class="personen-liste">
                ${personenListe}
            </ul>

            <button onclick="window.ichBinDabei('${ausgewaehlterTag}')" ${binDabei ? "disabled" : ""}>
                ${binDabei ? "Du bist eingetragen ✓" : "Ich bin dabei"}
            </button>

            <label class="aktivitaet-label">
                Aktivität an diesem Tag:
                <textarea id="aktivitaetFeld" rows="3">${escapeHtml(eintrag.aktivitaet)}</textarea>
            </label>

            <button onclick="window.speichereAktivitaet('${ausgewaehlterTag}')">
                Aktivität speichern
            </button>

            <button onclick="window.schliesseTag()" class="abbrechen-button">
                Schliessen
            </button>

        </div>
    `;

}

async function ichBinDabei(id) {

    if (!meinName) {

        alert("Bitte zuerst oben deinen Namen eintragen.");
        return;

    }

    const bestehend = tageDaten[id]?.personen || [];

    if (bestehend.includes(meinName)) {
        return;
    }

    await setDoc(
        doc(db, "tage", id),
        { personen: [...bestehend, meinName] },
        { merge: true }
    );

}

async function entfernePerson(id, name) {

    const bestehend = tageDaten[id]?.personen || [];

    await setDoc(
        doc(db, "tage", id),
        { personen: bestehend.filter(n => n !== name) },
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
window.monatWechseln = monatWechseln;
window.speichereMeinName = speichereMeinName;
window.oeffneTag = oeffneTag;
window.schliesseTag = schliesseTag;
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

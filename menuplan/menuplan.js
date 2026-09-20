import { db } from "./firebase-config.js";
import {
    collection,
    doc,
    documentId,
    endAt,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    startAt
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const WOCHENTAGE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const STICKY_NAME_KEY = "cortasiell_menuplan_zustaendigkeit";

const heute = new Date();

let tageDaten = {}; // aus dem Kalender: "YYYY-MM-DD" -> { personen, aktivitaet }
let menuplanDaten = {}; // "YYYY-MM-DD" -> { kuechenchef, zmorge, zmittag, znacht }

// Verhindert, dass ein Realtime-Update mitten im Tippen (oder beim
// Wechsel zwischen zwei Textfeldern) das ganze Raster neu aufbaut und
// dabei noch ungespeicherten Text zerstört. Solange irgendein Feld
// fokussiert ist, wird render() zurückgestellt und nach kurzer
// Verzögerung nachgeholt (die Verzögerung überbrückt den Moment
// zwischen "altes Feld verliert Fokus" und "neues Feld erhält Fokus"
// beim Wechsel per Tab/Klick).
let irgendEinFeldFokussiert = false;
let nachgeholtesRenderTimeout = null;

function escapeHtml(text) {

    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

function pad(n) {
    return String(n).padStart(2, "0");
}

function datumZuId(datum) {
    return `${datum.getFullYear()}-${pad(datum.getMonth() + 1)}-${pad(datum.getDate())}`;
}

function formatDatumKurz(id) {
    const [, monat, tag] = id.split("-").map(Number);
    const datum = new Date(id);
    return `${WOCHENTAGE[(datum.getUTCDay() + 6) % 7]} ${pad(tag)}.${pad(monat)}.`;
}

function init() {

    const von = new Date(heute.getFullYear(), heute.getMonth(), heute.getDate());
    const bis = new Date(von);
    bis.setDate(von.getDate() + 27); // "nächste vier Wochen"

    const vonId = datumZuId(von);
    const bisId = datumZuId(bis);

    onSnapshot(
        query(collection(db, "tage"), orderBy(documentId()), startAt(vonId), endAt(bisId)),
        snapshot => {

            tageDaten = {};
            snapshot.forEach(d => { tageDaten[d.id] = d.data(); });
            render();

        },
        error => {
            console.error("Kalenderdaten konnten nicht geladen werden:", error);
            document.getElementById("tageListe").innerHTML =
                `<p class="hinweis-text">⚠️ Kalenderdaten konnten nicht geladen werden.</p>`;
        }
    );

    onSnapshot(
        query(collection(db, "menuplan"), orderBy(documentId()), startAt(vonId), endAt(bisId)),
        snapshot => {

            menuplanDaten = {};
            snapshot.forEach(d => { menuplanDaten[d.id] = d.data(); });
            render();

        }
    );

    const nameFeld = document.getElementById("schnellNameFeld");
    nameFeld.value = localStorage.getItem(STICKY_NAME_KEY) || "";

}

function feldFokus(fokussiert) {

    irgendEinFeldFokussiert = fokussiert;
    clearTimeout(nachgeholtesRenderTimeout);

    if (!fokussiert) {

        nachgeholtesRenderTimeout = setTimeout(() => {
            if (!irgendEinFeldFokussiert) {
                render();
            }
        }, 250);

    }

}

function render() {

    if (irgendEinFeldFokussiert) {
        return; // wird nachgeholt, sobald kein Feld mehr fokussiert ist
    }

    const box = document.getElementById("tageListe");

    const tageIds = Object.keys(tageDaten)
        .filter(id => (tageDaten[id]?.personen || []).length > 0)
        .sort();

    if (tageIds.length === 0) {
        box.innerHTML = `<p class="hinweis-text">Keine Tage mit eingetragenen Personen in den nächsten vier Wochen.</p>`;
        return;
    }

    box.innerHTML = tageIds.map(id => renderSpalte(id)).join("");

}

function renderSpalte(tagId) {

    const personen = tageDaten[tagId]?.personen || [];
    const eintrag = menuplanDaten[tagId] || {};
    const chef = eintrag.kuechenchef || "";

    const chips = personen.map(name => `
        <button
            class="anwesend-chip ${name === chef ? "chef" : ""}"
            data-name="${escapeHtml(name)}"
            onclick="window.kuechenchefSetzen('${tagId}', this.dataset.name)"
        >${chef === name ? "👨‍🍳 " : ""}${escapeHtml(name)}</button>
    `).join("");

    return `
        <div class="tag-spalte">
            <div class="tag-datum">${formatDatumKurz(tagId)}</div>
            <div class="anwesende-chips">${chips}</div>

            <label class="mahlzeit-label">
                Zmorge
                <textarea rows="2"
                    onfocus="window.feldFokus(true)"
                    onblur="window.feldFokus(false); window.menuFeldSpeichern('${tagId}', 'zmorge', this.value)"
                >${escapeHtml(eintrag.zmorge)}</textarea>
            </label>
            <label class="mahlzeit-label">
                Zmittag
                <textarea rows="2"
                    onfocus="window.feldFokus(true)"
                    onblur="window.feldFokus(false); window.menuFeldSpeichern('${tagId}', 'zmittag', this.value)"
                >${escapeHtml(eintrag.zmittag)}</textarea>
            </label>
            <label class="mahlzeit-label">
                Znacht
                <textarea rows="2"
                    onfocus="window.feldFokus(true)"
                    onblur="window.feldFokus(false); window.menuFeldSpeichern('${tagId}', 'znacht', this.value)"
                >${escapeHtml(eintrag.znacht)}</textarea>
            </label>
        </div>
    `;

}

async function kuechenchefSetzen(tagId, name) {

    const bisheriger = menuplanDaten[tagId]?.kuechenchef || "";
    const neuerChef = bisheriger === name ? "" : name;

    await setDoc(doc(db, "menuplan", tagId), { kuechenchef: neuerChef }, { merge: true });

}

async function menuFeldSpeichern(tagId, feld, wert) {
    await setDoc(doc(db, "menuplan", tagId), { [feld]: wert }, { merge: true });
}

function schnellNameGeaendert() {
    const name = document.getElementById("schnellNameFeld").value.trim();
    localStorage.setItem(STICKY_NAME_KEY, name);
}

async function schnellHinzufuegen() {

    const itemFeld = document.getElementById("schnellItemFeld");
    const nameFeld = document.getElementById("schnellNameFeld");

    const text = itemFeld.value.trim();
    if (!text) {
        return;
    }

    const name = nameFeld.value.trim();
    localStorage.setItem(STICKY_NAME_KEY, name);

    const neueId = doc(collection(db, "einkaufsliste")).id;

    // reihenfolge als Zeitstempel statt fortlaufender Zahl, damit hier
    // nicht extra die ganze Einkaufsliste geladen werden muss, nur um die
    // aktuell höchste Zahl zu kennen – ans Ende gehört der neue Eintrag
    // so oder so.
    await setDoc(doc(db, "einkaufsliste", neueId), {
        text,
        erledigt: false,
        reihenfolge: Date.now(),
        ...(name ? { angepinnterName: name } : {})
    });

    itemFeld.value = "";
    itemFeld.focus();

}

window.feldFokus = feldFokus;
function hilfeOeffnen() {
    document.getElementById("hilfeOverlay").classList.remove("hidden");
}

function hilfeSchliessen() {
    document.getElementById("hilfeOverlay").classList.add("hidden");
}

window.hilfeOeffnen = hilfeOeffnen;
window.hilfeSchliessen = hilfeSchliessen;
window.kuechenchefSetzen = kuechenchefSetzen;
window.menuFeldSpeichern = menuFeldSpeichern;
window.schnellNameGeaendert = schnellNameGeaendert;
window.schnellHinzufuegen = schnellHinzufuegen;

init();

if ("serviceWorker" in navigator) {

    navigator.serviceWorker
        .register("./service-worker.js")
        .then(() => {

            console.log("Menüplan Service Worker registriert");

        });

}

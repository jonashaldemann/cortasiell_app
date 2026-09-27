import { db } from "./firebase-config.js";
import {
    collection,
    deleteField,
    doc,
    onSnapshot,
    orderBy,
    query,
    setDoc,
    deleteDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { verschiebbarMachen } from "../shared/drag-reorder.js";

let alleEintraege = []; // [{ id, text, erledigt, reihenfolge, angepinnterName }]
let bearbeiteterNamePinId = null;
let bearbeitetesTextId = null;
let aktiverFilterName = null;

// Gleiche Handy/Browser-Grenze wie in kalender.js/projekte.js. Auf dem
// Handy ist der angepinnte Name in der Liste (nicht im Filter) gekürzt,
// damit Text/Tag/Aktionen eher auf einer Zeile bleiben.
const handyBreiteMedia = window.matchMedia("(max-width: 899px)");

function kuerzeTagFuerListe(name) {

    if (!handyBreiteMedia.matches || name.length <= 4) {
        return name;
    }

    return name.slice(0, 1) + "…" + name.slice(-1);

}

function escapeHtml(text) {

    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

let einkaufslisteDrag;

function init() {

    einkaufslisteDrag = verschiebbarMachen({
        container: document.getElementById("aktiveListe"),
        itemSelector: ".einkaufs-zeile",
        griffSelector: ".zeile-griff",
        onDrop: einkaufslisteReihenfolgeGespeichert
    });

    onSnapshot(query(collection(db, "einkaufsliste"), orderBy("reihenfolge")), snapshot => {

        alleEintraege = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        // Ein Snapshot-Update, das genau während einer Ziehgeste eintrifft,
        // würde die Liste per innerHTML ersetzen und damit den Knoten unter
        // dem Zeiger zerstören - deshalb während des Verschiebens zurück-
        // stellen; sobald es endet, kommt ohnehin ein weiteres Update.
        if (!einkaufslisteDrag.istAktiv()) {
            render();
        }

    }, error => {

        console.error("Einkaufsliste konnte nicht geladen werden:", error);
        document.getElementById("aktiveListe").innerHTML =
            `<p class="hinweis-text">⚠️ Einkaufsliste konnte nicht geladen werden.</p>`;

    });

    handyBreiteMedia.addEventListener("change", render);

}

function render() {

    renderFilterLeiste();

    const sichtbar = aktiverFilterName
        ? alleEintraege.filter(e => e.angepinnterName === aktiverFilterName)
        : alleEintraege;

    const aktive = sichtbar.filter(e => !e.erledigt);
    const erledigte = sichtbar.filter(e => e.erledigt);

    renderAktiveListe(aktive);
    renderErledigtBereich(erledigte);

}

function renderFilterLeiste() {

    const box = document.getElementById("filterLeiste");
    if (!box) {
        return;
    }

    const namen = [...new Set(alleEintraege.map(e => e.angepinnterName).filter(Boolean))].sort();

    if (namen.length === 0) {
        box.innerHTML = "";
        return;
    }

    box.innerHTML = `
        <button class="filter-chip ${!aktiverFilterName ? "aktiv" : ""}" onclick="window.filterSetzen(null)">Alle</button>
        ${namen.map(n => `
            <button class="filter-chip ${aktiverFilterName === n ? "aktiv" : ""}" onclick="window.filterSetzen('${escapeHtml(n)}')">
                📌 ${escapeHtml(n)}
            </button>
        `).join("")}
    `;

}

function filterSetzen(name) {
    aktiverFilterName = name;
    render();
}

function renderZeileText(eintrag) {

    if (bearbeitetesTextId === eintrag.id) {

        return `
            <div class="zeile-bearbeiten-block">
                <input
                    type="text"
                    class="text-bearbeiten-feld"
                    value="${escapeHtml(eintrag.text)}"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();window.elementTextSpeichern('${eintrag.id}');}"
                >
                <input
                    type="url"
                    class="link-bearbeiten-feld"
                    placeholder="Link (optional)"
                    value="${escapeHtml(eintrag.link || "")}"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();window.elementTextSpeichern('${eintrag.id}');}"
                >
            </div>
            <button class="row-action" onclick="window.elementTextSpeichern('${eintrag.id}')" title="Speichern">✓</button>
        `;

    }

    const linkIcon = eintrag.link
        ? `<a class="zeile-link" href="${escapeHtml(eintrag.link)}" target="_blank" rel="noopener" title="Link öffnen" onclick="event.stopPropagation()">🔗</a>`
        : "";

    return `<span class="zeile-text" onclick="window.elementBearbeitenOeffnen('${eintrag.id}')">${escapeHtml(eintrag.text)}</span>${linkIcon}`;

}

function renderPinBereich(eintrag) {

    if (bearbeiteterNamePinId === eintrag.id) {

        return `
            <input
                type="text"
                class="pin-feld"
                value="${escapeHtml(eintrag.angepinnterName || "")}"
                placeholder="Name"
                onkeydown="if(event.key==='Enter'){event.preventDefault();window.namePinSpeichern('${eintrag.id}');}"
            >
            <button class="row-action" onclick="window.namePinSpeichern('${eintrag.id}')" title="Speichern">✓</button>
        `;

    }

    if (eintrag.angepinnterName) {

        return `
            <span class="pin-chip" onclick="window.namePinOeffnen('${eintrag.id}')" title="${escapeHtml(eintrag.angepinnterName)}">
                📌 ${escapeHtml(kuerzeTagFuerListe(eintrag.angepinnterName))}
            </span>
        `;

    }

    return `<button class="pin-button" onclick="window.namePinOeffnen('${eintrag.id}')" title="Namen anpinnen">📌</button>`;

}

function renderAktiveListe(aktive) {

    const box = document.getElementById("aktiveListe");

    if (aktive.length === 0) {
        box.innerHTML = `<p class="hinweis-text">Noch nichts auf der Liste.</p>`;
        return;
    }

    // Bewusst KEIN Löschen-Button hier: ein offener Eintrag lässt sich nur
    // abhaken, nicht direkt entfernen - sonst könnte er mit einem
    // einzigen Fehlklick verschwinden (siehe Feedback). Löschen geht erst
    // nach dem Abhaken, per "Alle löschen" unten (mit Bestätigung).
    box.innerHTML = aktive.map(e => `
        <div class="einkaufs-zeile" data-id="${e.id}">
            <div class="zeile-griff" title="Zum Verschieben ziehen">⠿</div>
            <input type="checkbox" onchange="window.erledigtGeaendert('${e.id}', this.checked)">
            ${renderZeileText(e)}
            <div class="zeile-pin">${renderPinBereich(e)}</div>
        </div>
    `).join("");

}

function renderErledigtBereich(erledigte) {

    const box = document.getElementById("erledigtBereich");

    if (erledigte.length === 0) {
        box.innerHTML = "";
        return;
    }

    box.innerHTML = `
        <div class="erledigt-kopf">
            <h2>Erledigt</h2>
            <button class="loeschen-alle-button" onclick="window.erledigteLoeschen()">Alle löschen</button>
        </div>
        <div class="einkaufs-liste">
            ${erledigte.map(e => `
                <div class="einkaufs-zeile erledigt">
                    <div class="zeile-griff-platzhalter"></div>
                    <input type="checkbox" checked onchange="window.erledigtGeaendert('${e.id}', this.checked)">
                    ${renderZeileText(e)}
                    <div class="zeile-pin">${e.angepinnterName ? `<span class="pin-chip" title="${escapeHtml(e.angepinnterName)}">📌 ${escapeHtml(kuerzeTagFuerListe(e.angepinnterName))}</span>` : ""}</div>
                    <button class="row-action" onclick="window.elementLoeschen('${e.id}')" title="Entfernen">✕</button>
                </div>
            `).join("")}
        </div>
    `;

}

async function elementHinzufuegen() {

    const feld = document.getElementById("neuesElementFeld");
    const text = feld.value.trim();

    if (!text) {
        return;
    }

    const maxReihenfolge = alleEintraege.reduce((max, e) => Math.max(max, e.reihenfolge ?? 0), -1);
    const neueId = doc(collection(db, "einkaufsliste")).id;

    const daten = {
        text,
        erledigt: false,
        reihenfolge: maxReihenfolge + 1
    };

    // Ist gerade nach einem Namen gefiltert, gleich mit anpinnen - sonst
    // würde das neue Element in der gefilterten Ansicht sofort wieder
    // verschwinden (siehe Feedback).
    if (aktiverFilterName) {
        daten.angepinnterName = aktiverFilterName;
    }

    await setDoc(doc(db, "einkaufsliste", neueId), daten);

    feld.value = "";
    feld.focus();

}

async function erledigtGeaendert(id, erledigt) {
    await setDoc(doc(db, "einkaufsliste", id), { erledigt }, { merge: true });
}

async function elementLoeschen(id) {
    await deleteDoc(doc(db, "einkaufsliste", id));
}

async function erledigteLoeschen() {

    const erledigte = alleEintraege.filter(e => e.erledigt);

    if (erledigte.length === 0) {
        return;
    }

    if (!confirm(`${erledigte.length} erledigte Einträge löschen?`)) {
        return;
    }

    const batch = writeBatch(db);
    erledigte.forEach(e => batch.delete(doc(db, "einkaufsliste", e.id)));
    await batch.commit();

}

function elementBearbeitenOeffnen(id) {
    bearbeitetesTextId = id;
    render();
    document.querySelector(".text-bearbeiten-feld")?.focus();
}

async function elementTextSpeichern(id) {

    const textFeld = document.querySelector(".text-bearbeiten-feld");
    const linkFeld = document.querySelector(".link-bearbeiten-feld");

    const text = textFeld ? textFeld.value.trim() : "";
    const link = linkFeld ? linkFeld.value.trim() : "";

    if (text) {
        await setDoc(doc(db, "einkaufsliste", id), { text, link: link || deleteField() }, { merge: true });
    }

    bearbeitetesTextId = null;
    render();

}

function namePinOeffnen(id) {
    bearbeiteterNamePinId = id;
    render();
    document.querySelector(".pin-feld")?.focus();
}

async function namePinSpeichern(id) {

    const feld = document.querySelector(".pin-feld");
    const name = feld ? feld.value.trim() : "";

    await setDoc(
        doc(db, "einkaufsliste", id),
        { angepinnterName: name || deleteField() },
        { merge: true }
    );

    bearbeiteterNamePinId = null;
    render();

}

// Verschieben per Griff - siehe shared/drag-reorder.js (Pointer Events statt
// nativer HTML5-Drag&Drop-API, damit es auch auf dem Handy funktioniert).
async function einkaufslisteReihenfolgeGespeichert(neueReihenfolge) {

    const batch = writeBatch(db);
    neueReihenfolge.forEach((id, i) => {
        batch.set(doc(db, "einkaufsliste", id), { reihenfolge: i }, { merge: true });
    });
    await batch.commit();

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
window.elementHinzufuegen = elementHinzufuegen;
window.erledigtGeaendert = erledigtGeaendert;
window.elementLoeschen = elementLoeschen;
window.erledigteLoeschen = erledigteLoeschen;
window.elementBearbeitenOeffnen = elementBearbeitenOeffnen;
window.elementTextSpeichern = elementTextSpeichern;
window.filterSetzen = filterSetzen;
window.namePinOeffnen = namePinOeffnen;
window.namePinSpeichern = namePinSpeichern;

init();

if ("serviceWorker" in navigator) {

    navigator.serviceWorker
        .register("./service-worker.js")
        .then(() => {

            console.log("Einkaufsliste Service Worker registriert");

        });

}

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

let alleEintraege = []; // [{ id, text, erledigt, reihenfolge, angepinnterName }]
let bearbeiteterNamePinId = null;

let ziehQuellIndex = null;
let ziehZielIndex = null;

function escapeHtml(text) {

    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

function init() {

    onSnapshot(query(collection(db, "einkaufsliste"), orderBy("reihenfolge")), snapshot => {

        alleEintraege = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        render();

    }, error => {

        console.error("Einkaufsliste konnte nicht geladen werden:", error);
        document.getElementById("aktiveListe").innerHTML =
            `<p class="hinweis-text">⚠️ Einkaufsliste konnte nicht geladen werden.</p>`;

    });

}

function render() {

    const aktive = alleEintraege.filter(e => !e.erledigt);
    const erledigte = alleEintraege.filter(e => e.erledigt);

    renderAktiveListe(aktive);
    renderErledigtBereich(erledigte);

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
            <span class="pin-chip" onclick="window.namePinOeffnen('${eintrag.id}')">
                📌 ${escapeHtml(eintrag.angepinnterName)}
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

    box.innerHTML = aktive.map((e, index) => `
        <div class="einkaufs-zeile"
            draggable="true"
            ondragstart="window.dragStart(event, ${index})"
            ondragover="window.dragOver(event, ${index})"
            ondrop="window.dragDrop(event)"
            ondragend="window.dragEnd(event)"
        >
            <div class="zeile-griff" title="Zum Verschieben ziehen">⠿</div>
            <input type="checkbox" onchange="window.erledigtGeaendert('${e.id}', this.checked)">
            <span class="zeile-text">${escapeHtml(e.text)}</span>
            <div class="zeile-pin">${renderPinBereich(e)}</div>
            <button class="row-action" onclick="window.elementLoeschen('${e.id}')" title="Entfernen">✕</button>
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
                    <span class="zeile-text">${escapeHtml(e.text)}</span>
                    <div class="zeile-pin">${e.angepinnterName ? `<span class="pin-chip">📌 ${escapeHtml(e.angepinnterName)}</span>` : ""}</div>
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

    await setDoc(doc(db, "einkaufsliste", neueId), {
        text,
        erledigt: false,
        reihenfolge: maxReihenfolge + 1
    });

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

// --- Drag & Drop (nur innerhalb der aktiven Liste) ---

function aktiveZeilenElemente() {
    return [...document.querySelectorAll("#aktiveListe .einkaufs-zeile")];
}

function lueckeZuruecksetzen() {
    aktiveZeilenElemente().forEach(el => {
        el.style.marginTop = "";
        el.style.marginBottom = "";
    });
}

function dragStart(event, index) {
    ziehQuellIndex = index;
    ziehZielIndex = index;
    event.dataTransfer.effectAllowed = "move";
    event.currentTarget.classList.add("dragging");
}

function dragOver(event, hoverIndex) {

    event.preventDefault();

    if (ziehQuellIndex === null) {
        return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const nachUnten = (event.clientY - rect.top) > rect.height / 2;
    const zielIndex = nachUnten ? hoverIndex + 1 : hoverIndex;

    if (zielIndex === ziehZielIndex) {
        return;
    }

    ziehZielIndex = zielIndex;

    const zeilen = aktiveZeilenElemente();
    zeilen.forEach((el, i) => {
        el.style.marginTop = (i === zielIndex) ? "20px" : "";
        el.style.marginBottom = (zielIndex === zeilen.length && i === zeilen.length - 1) ? "20px" : "";
    });

}

function dragOverListe(event) {

    if (event.target !== event.currentTarget || ziehQuellIndex === null) {
        return;
    }

    event.preventDefault();

    const zeilen = aktiveZeilenElemente();
    if (ziehZielIndex === zeilen.length) {
        return;
    }

    ziehZielIndex = zeilen.length;

    zeilen.forEach((el, i) => {
        el.style.marginTop = "";
        el.style.marginBottom = (i === zeilen.length - 1) ? "20px" : "";
    });

}

async function dragDrop(event) {

    event.preventDefault();
    event.stopPropagation();

    if (ziehQuellIndex === null || ziehZielIndex === null) {
        return;
    }

    let ziel = ziehZielIndex;
    if (ziehQuellIndex < ziel) {
        ziel -= 1;
    }

    if (ziel !== ziehQuellIndex) {

        const aktive = alleEintraege.filter(e => !e.erledigt);
        const verschoben = aktive.splice(ziehQuellIndex, 1)[0];
        aktive.splice(ziel, 0, verschoben);

        const batch = writeBatch(db);
        aktive.forEach((e, i) => {
            batch.set(doc(db, "einkaufsliste", e.id), { reihenfolge: i }, { merge: true });
        });
        await batch.commit();

    }

    ziehQuellIndex = null;
    ziehZielIndex = null;
    lueckeZuruecksetzen();
    render();

}

function dragEnd(event) {
    event.currentTarget.classList.remove("dragging");
    ziehQuellIndex = null;
    ziehZielIndex = null;
    lueckeZuruecksetzen();
}

// Von den inline onclick-Handlern im gerenderten HTML aus erreichbar
// (bei ES-Modulen sind Top-Level-Funktionen sonst nicht global sichtbar).
window.elementHinzufuegen = elementHinzufuegen;
window.erledigtGeaendert = erledigtGeaendert;
window.elementLoeschen = elementLoeschen;
window.erledigteLoeschen = erledigteLoeschen;
window.namePinOeffnen = namePinOeffnen;
window.namePinSpeichern = namePinSpeichern;
window.dragStart = dragStart;
window.dragOver = dragOver;
window.dragOverListe = dragOverListe;
window.dragDrop = dragDrop;
window.dragEnd = dragEnd;

init();

if ("serviceWorker" in navigator) {

    navigator.serviceWorker
        .register("./service-worker.js")
        .then(() => {

            console.log("Einkaufsliste Service Worker registriert");

        });

}

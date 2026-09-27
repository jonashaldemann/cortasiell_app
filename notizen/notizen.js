import { db } from "./firebase-config.js";
import {
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const NAME_STICKY_KEY = "cortasiell_notizen_name";

let notizen = []; // [{ id, text, name, erstelltAm, reihenfolge }]
let bearbeitetesId = null;

// Ziehen zum Verschieben - gleiches Muster wie bei den Projekt- bzw.
// Kosten-Karten in projekte.js.
let ziehElement = null;
let dropErfolgreich = false;

// Ältere Notizen haben noch kein "reihenfolge"-Feld (kam erst mit dem
// Verschieben-Feature dazu). Fehlt es, fällt sortieren unten auf die
// bisherige erstelltAm-Reihenfolge zurück; einmalig wird es dann für
// alle aktiven Notizen nachgetragen, danach ist jede Notiz normal per
// Griff verschiebbar.
let reihenfolgeBackfillLaeuft = false;

function escapeHtml(text) {

    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

function init() {

    onSnapshot(query(collection(db, "notizen"), orderBy("erstelltAm", "desc")), snapshot => {

        notizen = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        render();

    }, error => {

        console.error("Notizen konnten nicht geladen werden:", error);
        document.getElementById("notizenListe").innerHTML =
            `<p class="hinweis-text">⚠️ Notizen konnten nicht geladen werden.</p>`;

    });

    document.getElementById("neueNotizName").value = localStorage.getItem(NAME_STICKY_KEY) || "";

}

function vergleicheReihenfolge(a, b) {
    const ra = typeof a.reihenfolge === "number" ? a.reihenfolge : 0;
    const rb = typeof b.reihenfolge === "number" ? b.reihenfolge : 0;
    return ra - rb;
}

function render() {

    const box = document.getElementById("notizenListe");
    const papierkorbBox = document.getElementById("notizenPapierkorb");

    const aktive = notizen.filter(n => !n.geloescht).sort(vergleicheReihenfolge);
    const papierkorb = notizen.filter(n => n.geloescht);

    box.innerHTML = aktive.length === 0
        ? `<p class="hinweis-text">Noch keine Notizen vorhanden.</p>`
        : aktive.map(n => renderNotiz(n)).join("");

    papierkorbBox.innerHTML = papierkorb.length === 0
        ? ""
        : `
            <h2 class="papierkorb-kopf">Papierkorb</h2>
            <div class="notizen-liste">
                ${papierkorb.map(n => renderNotiz(n)).join("")}
            </div>
        `;

    backfillReihenfolgeFallsNoetig(aktive);

}

async function backfillReihenfolgeFallsNoetig(aktive) {

    if (reihenfolgeBackfillLaeuft || aktive.every(n => typeof n.reihenfolge === "number")) {
        return;
    }

    reihenfolgeBackfillLaeuft = true;

    const batch = writeBatch(db);
    aktive.forEach((n, i) => {
        batch.set(doc(db, "notizen", n.id), { reihenfolge: i }, { merge: true });
    });
    await batch.commit();

    reihenfolgeBackfillLaeuft = false;

}

function renderNotiz(n) {

    const istPapierkorb = !!n.geloescht;
    const wirdBearbeitet = !istPapierkorb && bearbeitetesId === n.id;

    const inhalt = wirdBearbeitet
        ? `
            <textarea class="notiz-bearbeiten-feld" rows="4">${escapeHtml(n.text)}</textarea>
            <button class="notiz-speichern-button" onclick="window.notizTextSpeichern('${n.id}')">Speichern</button>
        `
        : `<p class="notiz-text" ${istPapierkorb ? "" : `onclick="window.notizBearbeitenOeffnen('${n.id}')"`}>${escapeHtml(n.text)}</p>`;

    // Während dem Bearbeiten kein ✕ - sonst löscht ein Fehlklick mitten im
    // Formulieren gleich die ganze Notiz.
    const aktionen = istPapierkorb
        ? `
            <button class="row-action" onclick="window.notizWiederherstellen('${n.id}')" title="Wiederherstellen">↺</button>
            <button class="row-action" onclick="window.notizEndgueltigLoeschen('${n.id}')" title="Endgültig löschen">🗑</button>
        `
        : (wirdBearbeitet ? "" : `<button class="row-action" onclick="window.notizLoeschen('${n.id}')" title="Löschen">✕</button>`);

    const griff = istPapierkorb
        ? `<div class="notiz-griff unsichtbar"></div>`
        : `<div class="notiz-griff" title="Zum Verschieben ziehen">⠿</div>`;

    const ziehAttribute = istPapierkorb
        ? ""
        : `
            draggable="true"
            data-id="${n.id}"
            ondragstart="window.dragStart(event)"
            ondragover="window.dragOver(event)"
            ondrop="window.dragDrop(event)"
            ondragend="window.dragEnd(event)"
        `;

    return `
        <div class="notiz-kachel${istPapierkorb ? " papierkorb" : ""}" ${ziehAttribute}>
            <div class="notiz-kachel-kopf">
                ${griff}
                <div class="notiz-kachel-aktionen">${aktionen}</div>
            </div>
            ${inhalt}
            ${n.name ? `<div class="notiz-autor">– ${escapeHtml(n.name)}</div>` : ""}
        </div>
    `;

}

function alleNotizElemente() {
    return [...document.querySelectorAll("#notizenListe .notiz-kachel[draggable='true']")];
}

function dragStart(event) {
    ziehElement = event.currentTarget;
    dropErfolgreich = false;
    event.dataTransfer.effectAllowed = "move";
    event.currentTarget.classList.add("dragging");
}

function dragOver(event) {

    event.preventDefault();

    if (!ziehElement) {
        return;
    }

    const zielEl = event.currentTarget;
    if (zielEl === ziehElement) {
        return;
    }

    const rect = zielEl.getBoundingClientRect();
    const nachUnten = (event.clientY - rect.top) > rect.height / 2;

    if (nachUnten) {
        zielEl.after(ziehElement);
    } else {
        zielEl.before(ziehElement);
    }

}

// Fängt das Droppen in der leeren Fläche unterhalb der letzten Kachel ab
// (dort gibt es keine Kachel, deren dragover-Handler feuern könnte).
function dragOverListe(event) {

    if (event.target !== event.currentTarget || !ziehElement) {
        return;
    }

    event.preventDefault();
    event.currentTarget.appendChild(ziehElement);

}

async function dragDrop(event) {

    event.preventDefault();
    event.stopPropagation();

    if (!ziehElement) {
        return;
    }

    dropErfolgreich = true;

    const neueReihenfolge = alleNotizElemente().map(el => el.dataset.id);

    const batch = writeBatch(db);
    neueReihenfolge.forEach((id, i) => {
        batch.set(doc(db, "notizen", id), { reihenfolge: i }, { merge: true });
    });
    await batch.commit();

    notizen.sort((a, b) => neueReihenfolge.indexOf(a.id) - neueReihenfolge.indexOf(b.id));

}

function dragEnd(event) {

    event.currentTarget.classList.remove("dragging");

    if (!dropErfolgreich && ziehElement) {
        render(); // Drag abgebrochen -> ursprüngliche Reihenfolge wiederherstellen
    }

    ziehElement = null;

}

function notizNameGeaendert() {
    const name = document.getElementById("neueNotizName").value.trim();
    localStorage.setItem(NAME_STICKY_KEY, name);
}

async function notizHinzufuegen() {

    const textFeld = document.getElementById("neueNotizText");
    const nameFeld = document.getElementById("neueNotizName");

    const text = textFeld.value.trim();
    if (!text) {
        return;
    }

    const name = nameFeld.value.trim();
    localStorage.setItem(NAME_STICKY_KEY, name);

    const neueId = doc(collection(db, "notizen")).id;

    // Neue Notiz kommt zuoberst an - gleiche Position wie bisher durch
    // erstelltAm-desc, nur jetzt über reihenfolge gesteuert.
    const kleinsteReihenfolge = notizen
        .filter(n => !n.geloescht && typeof n.reihenfolge === "number")
        .reduce((min, n) => Math.min(min, n.reihenfolge), 0);

    await setDoc(doc(db, "notizen", neueId), {
        text,
        name,
        erstelltAm: serverTimestamp(),
        reihenfolge: kleinsteReihenfolge - 1
    });

    textFeld.value = "";
    textFeld.focus();

}

function notizBearbeitenOeffnen(id) {
    bearbeitetesId = id;
    render();
    document.querySelector(".notiz-bearbeiten-feld")?.focus();
}

async function notizTextSpeichern(id) {

    const feld = document.querySelector(".notiz-bearbeiten-feld");
    const text = feld ? feld.value.trim() : "";

    if (text) {
        await setDoc(doc(db, "notizen", id), { text }, { merge: true });
    }

    bearbeitetesId = null;
    render();

}

async function notizLoeschen(id) {

    if (!confirm("Notiz wirklich löschen?")) {
        return;
    }

    await setDoc(doc(db, "notizen", id), { geloescht: true }, { merge: true });

}

async function notizWiederherstellen(id) {
    await setDoc(doc(db, "notizen", id), { geloescht: false }, { merge: true });
}

async function notizEndgueltigLoeschen(id) {

    if (!confirm("Notiz endgültig löschen? Das kann nicht rückgängig gemacht werden.")) {
        return;
    }

    await deleteDoc(doc(db, "notizen", id));

}

function hilfeOeffnen() {
    document.getElementById("hilfeOverlay").classList.remove("hidden");
}

function hilfeSchliessen() {
    document.getElementById("hilfeOverlay").classList.add("hidden");
}

window.notizNameGeaendert = notizNameGeaendert;
window.notizHinzufuegen = notizHinzufuegen;
window.notizBearbeitenOeffnen = notizBearbeitenOeffnen;
window.notizTextSpeichern = notizTextSpeichern;
window.notizLoeschen = notizLoeschen;
window.notizWiederherstellen = notizWiederherstellen;
window.notizEndgueltigLoeschen = notizEndgueltigLoeschen;
window.dragStart = dragStart;
window.dragOver = dragOver;
window.dragOverListe = dragOverListe;
window.dragDrop = dragDrop;
window.dragEnd = dragEnd;
window.hilfeOeffnen = hilfeOeffnen;
window.hilfeSchliessen = hilfeSchliessen;

init();

if ("serviceWorker" in navigator) {

    navigator.serviceWorker
        .register("./service-worker.js")
        .then(() => {

            console.log("Notizen Service Worker registriert");

        });

}

import { db } from "./firebase-config.js";
import {
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const NAME_STICKY_KEY = "cortasiell_notizen_name";

let notizen = []; // [{ id, text, name, erstelltAm }]
let bearbeitetesId = null;

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

function render() {

    const box = document.getElementById("notizenListe");
    const papierkorbBox = document.getElementById("notizenPapierkorb");

    const aktive = notizen.filter(n => !n.geloescht);
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

}

function renderNotiz(n) {

    const istPapierkorb = !!n.geloescht;

    const inhalt = (!istPapierkorb && bearbeitetesId === n.id)
        ? `
            <textarea class="notiz-bearbeiten-feld" rows="4">${escapeHtml(n.text)}</textarea>
            <button class="notiz-speichern-button" onclick="window.notizTextSpeichern('${n.id}')">Speichern</button>
        `
        : `<p class="notiz-text" ${istPapierkorb ? "" : `onclick="window.notizBearbeitenOeffnen('${n.id}')"`}>${escapeHtml(n.text)}</p>`;

    const aktionen = istPapierkorb
        ? `
            <button class="row-action" onclick="window.notizWiederherstellen('${n.id}')" title="Wiederherstellen">↺</button>
            <button class="row-action" onclick="window.notizEndgueltigLoeschen('${n.id}')" title="Endgültig löschen">🗑</button>
        `
        : `<button class="row-action" onclick="window.notizLoeschen('${n.id}')" title="Löschen">✕</button>`;

    return `
        <div class="notiz-kachel${istPapierkorb ? " papierkorb" : ""}">
            <div class="notiz-kachel-aktionen">${aktionen}</div>
            ${inhalt}
            ${n.name ? `<div class="notiz-autor">– ${escapeHtml(n.name)}</div>` : ""}
        </div>
    `;

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

    await setDoc(doc(db, "notizen", neueId), {
        text,
        name,
        erstelltAm: serverTimestamp()
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

import { db } from "./firebase-config.js";
import {
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

let adressen = []; // [{ id, bezeichnung, name, vorname, ort, tel, mail, webseite }], alphabetisch nach name
let bearbeiteteAdresseId = null; // null = neue Adresse wird angelegt

function escapeHtml(text) {

    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

function init() {

    onSnapshot(collection(db, "adressen"), snapshot => {

        adressen = snapshot.docs
            .map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"));

        renderListe();

    }, error => {

        console.error("Adressen konnten nicht geladen werden:", error);
        document.getElementById("adressenListe").innerHTML =
            `<p class="hinweis-text">⚠️ Adressen konnten nicht geladen werden.</p>`;

    });

}

function renderListe() {

    const box = document.getElementById("adressenListe");

    if (adressen.length === 0) {
        box.innerHTML = `<p class="hinweis-text">Noch keine Adressen vorhanden.</p>`;
        return;
    }

    box.innerHTML = adressen.map(a => `
        <div class="adresse-zeile" onclick="window.adresseBearbeiten('${a.id}')">
            <span class="adresse-bezeichnung">${escapeHtml(a.bezeichnung)}</span>
            <span class="adresse-name">${escapeHtml(a.name)}</span>
            <span class="adresse-vorname">${escapeHtml(a.vorname)}</span>
            <span class="adresse-ort">${escapeHtml(a.ort)}</span>
            ${a.tel ? `<a class="adresse-tel" href="tel:${escapeHtml(a.tel)}" onclick="event.stopPropagation()">${escapeHtml(a.tel)}</a>` : "<span></span>"}
            ${a.mail ? `<a class="adresse-mail" href="mailto:${escapeHtml(a.mail)}" onclick="event.stopPropagation()">${escapeHtml(a.mail)}</a>` : "<span></span>"}
            <span class="adresse-web">${a.webseite ? `<a href="${escapeHtml(a.webseite)}" target="_blank" rel="noopener" title="Webseite öffnen" onclick="event.stopPropagation()">🔗</a>` : ""}</span>
            <button class="row-action" onclick="event.stopPropagation(); window.adresseLoeschen('${a.id}')" title="Löschen">🗑</button>
        </div>
    `).join("");

}

function neueAdresse() {

    bearbeiteteAdresseId = null;

    document.getElementById("editorTitel").textContent = "Neue Adresse";
    document.getElementById("inputBezeichnung").value = "";
    document.getElementById("inputName").value = "";
    document.getElementById("inputVorname").value = "";
    document.getElementById("inputOrt").value = "";
    document.getElementById("inputTel").value = "";
    document.getElementById("inputMail").value = "";
    document.getElementById("inputWebseite").value = "";

    document.getElementById("editorOverlay").classList.remove("hidden");

}

function adresseBearbeiten(id) {

    const adresse = adressen.find(a => a.id === id);
    if (!adresse) {
        return;
    }

    bearbeiteteAdresseId = id;

    document.getElementById("editorTitel").textContent = "Adresse bearbeiten";
    document.getElementById("inputBezeichnung").value = adresse.bezeichnung || "";
    document.getElementById("inputName").value = adresse.name || "";
    document.getElementById("inputVorname").value = adresse.vorname || "";
    document.getElementById("inputOrt").value = adresse.ort || "";
    document.getElementById("inputTel").value = adresse.tel || "";
    document.getElementById("inputMail").value = adresse.mail || "";
    document.getElementById("inputWebseite").value = adresse.webseite || "";

    document.getElementById("editorOverlay").classList.remove("hidden");

}

function schliesseEditor() {
    document.getElementById("editorOverlay").classList.add("hidden");
}

async function adresseSpeichern() {

    const name = document.getElementById("inputName").value.trim();

    if (!name) {
        alert("Bitte einen Namen oder eine Firma eingeben.");
        return;
    }

    const adresseId = bearbeiteteAdresseId || doc(collection(db, "adressen")).id;

    const daten = {
        bezeichnung: document.getElementById("inputBezeichnung").value.trim(),
        name,
        vorname: document.getElementById("inputVorname").value.trim(),
        ort: document.getElementById("inputOrt").value.trim(),
        tel: document.getElementById("inputTel").value.trim(),
        mail: document.getElementById("inputMail").value.trim(),
        webseite: document.getElementById("inputWebseite").value.trim()
    };

    if (!bearbeiteteAdresseId) {
        daten.erstelltAm = serverTimestamp();
    }

    await setDoc(doc(db, "adressen", adresseId), daten, { merge: true });

    schliesseEditor();

}

async function adresseLoeschen(id) {

    const adresse = adressen.find(a => a.id === id);

    if (!confirm(`Adresse "${adresse?.name || ""}" wirklich löschen?`)) {
        return;
    }

    await deleteDoc(doc(db, "adressen", id));

}

function hilfeOeffnen() {
    document.getElementById("hilfeOverlay").classList.remove("hidden");
}

function hilfeSchliessen() {
    document.getElementById("hilfeOverlay").classList.add("hidden");
}

window.hilfeOeffnen = hilfeOeffnen;
window.hilfeSchliessen = hilfeSchliessen;
window.neueAdresse = neueAdresse;
window.adresseBearbeiten = adresseBearbeiten;
window.schliesseEditor = schliesseEditor;
window.adresseSpeichern = adresseSpeichern;
window.adresseLoeschen = adresseLoeschen;

init();

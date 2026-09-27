import { db } from "./firebase-config.js";
import {
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    serverTimestamp,
    setDoc
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Ohne Schema (z.B. "www.meier.ch") wird ein href sonst relativ zur
// aktuellen Seite aufgelöst statt als externe URL geöffnet - deshalb bei
// Bedarf https:// voranstellen, sowohl beim Speichern (neue/bearbeitete
// Einträge) als auch beim Anzeigen (ältere, so gespeicherte Einträge).
function normalisiereUrl(url) {

    const wert = String(url || "").trim();

    if (!wert) {
        return "";
    }

    return /^https?:\/\//i.test(wert) ? wert : "https://" + wert;

}

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
    const papierkorbBox = document.getElementById("adressenPapierkorb");

    const aktive = adressen.filter(a => !a.geloescht);
    const papierkorb = adressen.filter(a => a.geloescht);

    box.innerHTML = aktive.length === 0
        ? `<p class="hinweis-text">Noch keine Adressen vorhanden.</p>`
        : aktive.map(a => renderZeile(a)).join("");

    papierkorbBox.innerHTML = papierkorb.length === 0
        ? ""
        : `
            <h2 class="papierkorb-kopf">Papierkorb</h2>
            <div class="adressen-liste">
                ${papierkorb.map(a => renderPapierkorbZeile(a)).join("")}
            </div>
        `;

}

function renderZeile(a) {

    return `
        <div class="adresse-zeile" onclick="window.adresseBearbeiten('${a.id}')">
            <span class="adresse-bezeichnung">${escapeHtml(a.bezeichnung)}</span>
            <span class="adresse-name">${escapeHtml(a.name)}</span>
            <span class="adresse-vorname">${escapeHtml(a.vorname)}</span>
            <span class="adresse-ort">${escapeHtml(a.ort)}</span>
            ${a.tel ? `<span class="adresse-tel">${escapeHtml(a.tel)}</span>` : "<span></span>"}
            ${a.mail ? `<a class="adresse-mail" href="mailto:${escapeHtml(a.mail)}" onclick="event.stopPropagation()">${escapeHtml(a.mail)}</a>` : "<span></span>"}
            <span class="adresse-web">${a.webseite ? `<a href="${escapeHtml(normalisiereUrl(a.webseite))}" target="_blank" rel="noopener" title="Webseite öffnen" onclick="event.stopPropagation()">🔗</a>` : ""}</span>
            <button class="row-action" onclick="event.stopPropagation(); window.adresseLoeschen('${a.id}')" title="Löschen">🗑</button>
        </div>
    `;

}

function renderPapierkorbZeile(a) {

    return `
        <div class="adresse-zeile papierkorb">
            <div class="papierkorb-titel">
                <span class="adresse-name">${escapeHtml([a.name, a.vorname].filter(Boolean).join(" "))}</span>
                ${a.bezeichnung ? `<span class="adresse-bezeichnung">${escapeHtml(a.bezeichnung)}</span>` : ""}
            </div>
            <div class="papierkorb-aktionen">
                <button class="row-action" onclick="window.adresseWiederherstellen('${a.id}')" title="Wiederherstellen">↺</button>
                <button class="row-action" onclick="window.adresseEndgueltigLoeschen('${a.id}')" title="Endgültig löschen">🗑</button>
            </div>
        </div>
    `;

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
        webseite: normalisiereUrl(document.getElementById("inputWebseite").value.trim())
    };

    if (!bearbeiteteAdresseId) {
        daten.erstelltAm = serverTimestamp();
        daten.geloescht = false;
    }

    await setDoc(doc(db, "adressen", adresseId), daten, { merge: true });

    schliesseEditor();

}

async function adresseLoeschen(id) {

    const adresse = adressen.find(a => a.id === id);

    if (!confirm(`Adresse "${adresse?.name || ""}" wirklich löschen?`)) {
        return;
    }

    await setDoc(doc(db, "adressen", id), { geloescht: true }, { merge: true });

}

async function adresseWiederherstellen(id) {
    await setDoc(doc(db, "adressen", id), { geloescht: false }, { merge: true });
}

async function adresseEndgueltigLoeschen(id) {

    const adresse = adressen.find(a => a.id === id);

    if (!confirm(`Adresse "${adresse?.name || ""}" endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) {
        return;
    }

    await deleteDoc(doc(db, "adressen", id));

}

function csvFeld(text) {

    const wert = String(text ?? "");

    if (/[";\n]/.test(wert)) {
        return `"${wert.replace(/"/g, '""')}"`;
    }

    return wert;

}

// Semikolon statt Komma als Trennzeichen, damit Excel (in DE/CH-Gebietsschema)
// die Datei beim Doppelklick direkt richtig in Spalten aufteilt. Das
// vorangestellte BOM sorgt dafür, dass Excel Umlaute als UTF-8 statt als
// Latin-1 interpretiert.
function adressenExportieren() {

    const kopf = ["Bezeichnung", "Name", "Vorname", "Ort", "Telefon", "E-Mail", "Webseite"];

    const zeilen = adressen.filter(a => !a.geloescht).map(a => [
        a.bezeichnung, a.name, a.vorname, a.ort, a.tel, a.mail, a.webseite
    ].map(csvFeld).join(";"));

    const csv = [kopf.join(";"), ...zeilen].join("\r\n");

    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "adressen-cortasiell.csv";
    link.click();

    URL.revokeObjectURL(url);

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
window.adresseWiederherstellen = adresseWiederherstellen;
window.adresseEndgueltigLoeschen = adresseEndgueltigLoeschen;
window.adressenExportieren = adressenExportieren;

init();

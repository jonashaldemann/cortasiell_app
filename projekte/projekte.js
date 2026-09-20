import { db } from "./firebase-config.js";
import {
    collection,
    deleteDoc,
    deleteField,
    doc,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    setDoc,
    writeBatch
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

// Eigenständiges Apps-Script-Deployment (unabhängig vom Inventar-Sync),
// nimmt Datei-Uploads entgegen und legt sie in Google Drive ab – siehe
// projekte/apps_script.js für den Server-Code.
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwpCECtC282-VaSjWgXqpPjqvn8l36jXzl6TPLjU8oFa45t5WiV5DNTSlEBOZ9sw-XG/exec";

const MAX_DATEIGROESSE = 8 * 1024 * 1024; // 8 MB, Reserve für Base64-Aufblähung + Apps-Script-Limits

const STANDARD_STATUS = ["Entwurf", "zu Besprechen", "Beschlossen"];

let projekte = []; // [{ id, titel, ..., reihenfolge }], sortiert
let statusOptionen = STANDARD_STATUS.slice();

let bearbeitetesProjektId = null; // null = neues Projekt wird angelegt
let checklisteEntwurf = [];
let ausgewaehlteDatei = null;
let dateiEntfernen = false;

let statusConfigEntwurf = [];

let ziehQuellIndex = null;

function escapeHtml(text) {

    return String(text ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

}

function formatChf(zahl) {
    return "CHF " + Number(zahl || 0).toLocaleString("de-CH");
}

function datenAlsBase64(datei) {

    return new Promise((resolve, reject) => {

        const reader = new FileReader();

        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;

        reader.readAsDataURL(datei);

    });

}

async function dateiHochladen(projektId, datei) {

    const base64 = await datenAlsBase64(datei);

    const antwort = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({
            projektId,
            dateiName: datei.name,
            mimeType: datei.type || "application/octet-stream",
            datenBase64: base64
        })
    });

    if (!antwort.ok) {
        throw new Error("Upload fehlgeschlagen (" + antwort.status + ")");
    }

    return antwort.json(); // { url, dateiId, dateiName }

}

function dateiLoeschen(dateiId) {

    // Best effort – ein Fehlschlag hier soll das eigentliche Speichern
    // nicht blockieren.
    fetch(APPS_SCRIPT_URL, {
        method: "POST",
        body: JSON.stringify({ aktion: "loeschen", dateiId })
    }).catch(() => {});

}

function init() {

    onSnapshot(query(collection(db, "projekte"), orderBy("reihenfolge")), snapshot => {

        projekte = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
        renderListe();

    }, error => {

        console.error("Projekte konnten nicht geladen werden:", error);
        document.getElementById("projekteListe").innerHTML =
            `<p class="hinweis-text">⚠️ Projekte konnten nicht geladen werden.</p>`;

    });

    onSnapshot(doc(db, "konfiguration", "projektStatus"), snapshot => {

        statusOptionen = snapshot.exists() && Array.isArray(snapshot.data().optionen) && snapshot.data().optionen.length
            ? snapshot.data().optionen
            : STANDARD_STATUS.slice();

        renderListe();

        if (!document.getElementById("editorOverlay").classList.contains("hidden")) {
            renderStatusSelect(document.getElementById("inputStatus"), aktuellerBearbeiteterStatus());
        }

    });

}

function aktuellerBearbeiteterStatus() {
    const projekt = projekte.find(p => p.id === bearbeitetesProjektId);
    return projekt?.status || statusOptionen[0];
}

function renderStatusSelect(selectEl, ausgewaehlt) {

    selectEl.innerHTML = statusOptionen
        .map(s => `<option value="${escapeHtml(s)}" ${s === ausgewaehlt ? "selected" : ""}>${escapeHtml(s)}</option>`)
        .join("");

}

// Stabile, aus dem Statusnamen abgeleitete Akzentfarbe – Status-Werte
// sind frei editierbar (keine feste Liste), daher keine feste Zuordnung
// Name -> Farbe, sondern ein einfacher Hash über einen kleinen Satz
// blasser Palettentöne. Gleicher Status sieht so immer gleich aus.
const STATUS_FARBTOENE = ["--oliv-blass", "--rot-blass", "--navy-blass", "--anthrazit-blass"];

function farbeFuerStatus(status) {

    let hash = 0;
    for (const zeichen of String(status)) {
        hash = (hash * 31 + zeichen.charCodeAt(0)) >>> 0;
    }

    return `var(${STATUS_FARBTOENE[hash % STATUS_FARBTOENE.length]})`;

}

function renderListe() {

    const box = document.getElementById("projekteListe");

    if (projekte.length === 0) {
        box.innerHTML = `<p class="hinweis-text">Noch keine Projekte vorhanden.</p>`;
        return;
    }

    box.innerHTML = projekte.map((p, index) => `
        <div class="projekt-karte"
            style="background:${farbeFuerStatus(p.status)}"
            draggable="true"
            ondragstart="window.dragStart(event, ${index})"
            ondragover="event.preventDefault()"
            ondrop="window.dragDrop(event, ${index})"
            ondragend="window.dragEnd(event)"
            onclick="window.projektBearbeiten('${p.id}')"
        >
            <div class="karte-griff" title="Zum Verschieben ziehen">⠿</div>

            <div class="karte-inhalt">
                <div class="karte-kopf">
                    <h3>${escapeHtml(p.titel)}</h3>
                    <button class="row-action" onclick="event.stopPropagation(); window.projektLoeschen('${p.id}')" title="Löschen">🗑</button>
                </div>

                ${p.beschreibung ? `<p class="karte-beschreibung">${escapeHtml(p.beschreibung)}</p>` : ""}

                <div class="karte-meta">
                    ${p.anzahlPersonen ? `<span>${p.anzahlPersonen} Personen</span>` : ""}
                    ${p.dauerTage ? `<span>${p.dauerTage} Tage</span>` : ""}
                    ${p.kosten ? `<span>${formatChf(p.kosten)}</span>` : ""}
                    ${p.dateiUrl ? `<a href="${escapeHtml(p.dateiUrl)}" target="_blank" rel="noopener" title="${escapeHtml(p.dateiName || "Datei")}" onclick="event.stopPropagation()">📎</a>` : ""}
                </div>

                <select class="karte-status" onclick="event.stopPropagation()" onchange="window.statusInZeileGeaendert('${p.id}', this.value)">
                    ${statusOptionen.map(s => `<option value="${escapeHtml(s)}" ${s === p.status ? "selected" : ""}>${escapeHtml(s)}</option>`).join("")}
                </select>
            </div>
        </div>
    `).join("");

}

function dragStart(event, index) {
    ziehQuellIndex = index;
    event.dataTransfer.effectAllowed = "move";
    event.currentTarget.classList.add("dragging");
}

function dragEnd(event) {
    event.currentTarget.classList.remove("dragging");
}

async function dragDrop(event, zielIndex) {

    event.preventDefault();

    if (ziehQuellIndex === null || ziehQuellIndex === zielIndex) {
        return;
    }

    const verschoben = projekte.splice(ziehQuellIndex, 1)[0];
    projekte.splice(zielIndex, 0, verschoben);
    ziehQuellIndex = null;

    renderListe();

    const batch = writeBatch(db);
    projekte.forEach((p, i) => {
        batch.set(doc(db, "projekte", p.id), { reihenfolge: i }, { merge: true });
    });
    await batch.commit();

}

async function statusInZeileGeaendert(id, neuerStatus) {
    await setDoc(doc(db, "projekte", id), { status: neuerStatus }, { merge: true });
}

// --- Editor ---

function neuesProjekt() {

    bearbeitetesProjektId = null;
    checklisteEntwurf = [];
    ausgewaehlteDatei = null;
    dateiEntfernen = false;

    document.getElementById("editorTitel").textContent = "Neues Projekt";
    document.getElementById("inputTitel").value = "";
    document.getElementById("inputBeschreibung").value = "";
    document.getElementById("inputAnzahlPersonen").value = "";
    document.getElementById("inputDauerTage").value = "";
    document.getElementById("inputKosten").value = "";
    document.getElementById("inputDatei").value = "";

    renderStatusSelect(document.getElementById("inputStatus"), statusOptionen[0]);
    renderChecklisteEditor();
    renderDateiAnzeige(null);

    document.getElementById("editorOverlay").classList.remove("hidden");

}

function projektBearbeiten(id) {

    const projekt = projekte.find(p => p.id === id);
    if (!projekt) {
        return;
    }

    bearbeitetesProjektId = id;
    checklisteEntwurf = (projekt.checkliste || []).map(p => ({ ...p }));
    ausgewaehlteDatei = null;
    dateiEntfernen = false;

    document.getElementById("editorTitel").textContent = "Projekt bearbeiten";
    document.getElementById("inputTitel").value = projekt.titel || "";
    document.getElementById("inputBeschreibung").value = projekt.beschreibung || "";
    document.getElementById("inputAnzahlPersonen").value = projekt.anzahlPersonen ?? "";
    document.getElementById("inputDauerTage").value = projekt.dauerTage ?? "";
    document.getElementById("inputKosten").value = projekt.kosten ?? "";
    document.getElementById("inputDatei").value = "";

    renderStatusSelect(document.getElementById("inputStatus"), projekt.status);
    renderChecklisteEditor();
    renderDateiAnzeige(projekt);

    document.getElementById("editorOverlay").classList.remove("hidden");

}

function schliesseEditor() {
    document.getElementById("editorOverlay").classList.add("hidden");
}

function renderChecklisteEditor() {

    document.getElementById("checklisteListe").innerHTML = checklisteEntwurf.map((punkt, i) => `
        <div class="checkliste-zeile">
            <input type="checkbox" ${punkt.erledigt ? "checked" : ""} onchange="window.checklistePunktGeaendert(${i}, 'erledigt', this.checked)">
            <input type="text" value="${escapeHtml(punkt.text)}" placeholder="Abklärung" oninput="window.checklistePunktGeaendert(${i}, 'text', this.value)">
            <button type="button" class="entfernen-button" onclick="window.checklistePunktEntfernen(${i})">✕</button>
        </div>
    `).join("");

}

function checklistePunktHinzufuegen() {
    checklisteEntwurf.push({ text: "", erledigt: false });
    renderChecklisteEditor();
    const felder = document.querySelectorAll("#checklisteListe input[type=text]");
    felder[felder.length - 1]?.focus();
}

function checklistePunktGeaendert(index, feld, wert) {
    checklisteEntwurf[index][feld] = wert;
}

function checklistePunktEntfernen(index) {
    checklisteEntwurf.splice(index, 1);
    renderChecklisteEditor();
}

function renderDateiAnzeige(projekt) {

    const box = document.getElementById("dateiAnzeige");

    if (projekt?.dateiUrl && !dateiEntfernen) {
        box.innerHTML = `
            <a href="${escapeHtml(projekt.dateiUrl)}" target="_blank" rel="noopener">📎 ${escapeHtml(projekt.dateiName || "Datei")}</a>
            <button type="button" class="entfernen-button" onclick="window.dateiEntfernenKlick()">✕</button>
        `;
    } else {
        box.innerHTML = "";
    }

}

function dateiEntfernenKlick() {
    dateiEntfernen = true;
    renderDateiAnzeige(null);
}

async function projektSpeichern() {

    const titel = document.getElementById("inputTitel").value.trim();

    if (!titel) {
        alert("Bitte einen Titel eingeben.");
        return;
    }

    const projektId = bearbeitetesProjektId || doc(collection(db, "projekte")).id;
    const bestehendesProjekt = projekte.find(p => p.id === bearbeitetesProjektId);

    ausgewaehlteDatei = document.getElementById("inputDatei").files[0] || null;

    if (ausgewaehlteDatei && ausgewaehlteDatei.size > MAX_DATEIGROESSE) {
        alert("Datei ist zu gross (max. 8 MB).");
        return;
    }

    const daten = {
        titel,
        beschreibung: document.getElementById("inputBeschreibung").value.trim(),
        anzahlPersonen: Number(document.getElementById("inputAnzahlPersonen").value) || 0,
        dauerTage: Number(document.getElementById("inputDauerTage").value) || 0,
        kosten: Number(document.getElementById("inputKosten").value) || 0,
        status: document.getElementById("inputStatus").value,
        checkliste: checklisteEntwurf.filter(p => p.text.trim() !== "")
    };

    if (!bearbeitetesProjektId) {
        daten.reihenfolge = projekte.length;
        daten.erstelltAm = serverTimestamp();
    }

    if (ausgewaehlteDatei) {

        const altesDateiId = bestehendesProjekt?.dateiId;

        const ergebnis = await dateiHochladen(projektId, ausgewaehlteDatei);
        daten.dateiUrl = ergebnis.url;
        daten.dateiId = ergebnis.dateiId;
        daten.dateiName = ergebnis.dateiName;

        if (altesDateiId) {
            dateiLoeschen(altesDateiId);
        }

    } else if (dateiEntfernen && bestehendesProjekt?.dateiId) {

        dateiLoeschen(bestehendesProjekt.dateiId);
        daten.dateiUrl = deleteField();
        daten.dateiId = deleteField();
        daten.dateiName = deleteField();

    }

    await setDoc(doc(db, "projekte", projektId), daten, { merge: true });

    schliesseEditor();

}

async function projektLoeschen(id) {

    const projekt = projekte.find(p => p.id === id);

    if (!confirm(`Projekt "${projekt?.titel || ""}" wirklich löschen?`)) {
        return;
    }

    if (projekt?.dateiId) {
        dateiLoeschen(projekt.dateiId);
    }

    await deleteDoc(doc(db, "projekte", id));

}

// --- Status-Konfiguration ---

function oeffneStatusConfig() {

    statusConfigEntwurf = statusOptionen.slice();
    renderStatusConfigListe();
    document.getElementById("statusConfigOverlay").classList.remove("hidden");

}

function schliesseStatusConfig() {
    document.getElementById("statusConfigOverlay").classList.add("hidden");
}

function renderStatusConfigListe() {

    document.getElementById("statusConfigListe").innerHTML = statusConfigEntwurf.map((wert, i) => `
        <div class="checkliste-zeile">
            <input type="text" value="${escapeHtml(wert)}" oninput="window.statusOptionGeaendert(${i}, this.value)">
            <button type="button" class="entfernen-button" onclick="window.statusOptionEntfernen(${i})">✕</button>
        </div>
    `).join("");

}

function statusOptionHinzufuegen() {
    statusConfigEntwurf.push("");
    renderStatusConfigListe();
    const felder = document.querySelectorAll("#statusConfigListe input[type=text]");
    felder[felder.length - 1]?.focus();
}

function statusOptionGeaendert(index, wert) {
    statusConfigEntwurf[index] = wert;
}

function statusOptionEntfernen(index) {
    statusConfigEntwurf.splice(index, 1);
    renderStatusConfigListe();
}

async function statusConfigSpeichern() {

    const optionen = statusConfigEntwurf.map(s => s.trim()).filter(Boolean);

    if (optionen.length === 0) {
        alert("Bitte mindestens einen Status behalten.");
        return;
    }

    await setDoc(doc(db, "konfiguration", "projektStatus"), { optionen });

    schliesseStatusConfig();

}

// Von den inline onclick-Handlern im gerenderten HTML aus erreichbar
// (bei ES-Modulen sind Top-Level-Funktionen sonst nicht global sichtbar).
window.dragStart = dragStart;
window.dragDrop = dragDrop;
window.dragEnd = dragEnd;
window.statusInZeileGeaendert = statusInZeileGeaendert;
window.neuesProjekt = neuesProjekt;
window.projektBearbeiten = projektBearbeiten;
window.schliesseEditor = schliesseEditor;
window.checklistePunktHinzufuegen = checklistePunktHinzufuegen;
window.checklistePunktGeaendert = checklistePunktGeaendert;
window.checklistePunktEntfernen = checklistePunktEntfernen;
window.dateiEntfernenKlick = dateiEntfernenKlick;
window.projektSpeichern = projektSpeichern;
window.projektLoeschen = projektLoeschen;
window.oeffneStatusConfig = oeffneStatusConfig;
window.schliesseStatusConfig = schliesseStatusConfig;
window.statusOptionHinzufuegen = statusOptionHinzufuegen;
window.statusOptionGeaendert = statusOptionGeaendert;
window.statusOptionEntfernen = statusOptionEntfernen;
window.statusConfigSpeichern = statusConfigSpeichern;

init();

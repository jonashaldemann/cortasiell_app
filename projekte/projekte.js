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

// Farbvorschläge für Status – dieselben Töne, die auch sonst für kräftige
// Akzente/Balken verwendet werden (siehe shared/theme.css).
const FARB_VORSCHLAEGE = ["--oliv-dunkel", "--rot-dunkel", "--navy-dunkel", "--anthrazit-dunkel", "--gold-dunkel"];

const STANDARD_STATUS = [
    { name: "Entwurf", farbe: "--oliv-dunkel" },
    { name: "zu Besprechen", farbe: "--rot-dunkel" },
    { name: "Beschlossen", farbe: "--navy-dunkel" }
];

let projekte = []; // [{ id, titel, ..., reihenfolge }], sortiert
let statusOptionen = STANDARD_STATUS.slice(); // [{ name, farbe }]

let bearbeitetesProjektId = null; // null = neues Projekt wird angelegt
let checklisteEntwurf = [];
let kostenEntwurf = []; // [{ _uid, position, anzahl, chfProAnzahl, chfTotal }], Arbeitskopie im Editor
let ausgewaehlteDatei = null;
let dateiEntfernen = false;

let statusConfigEntwurf = []; // [{ name, farbe }], Arbeitskopie im Overlay

let ziehElement = null; // die gerade gezogene .projekt-karte
let dropErfolgreich = false;

let statusZiehElement = null;
let statusDropErfolgreich = false;

let kostenUidZaehler = 0;
let kostenZiehElement = null;
let kostenDropErfolgreich = false;

// Ältere Daten hatten `optionen` als reines String-Array – hier auf das
// neue { name, farbe }-Format anheben, damit bestehende Status (z.B. ein
// schon angelegter "Langfristig") nicht verloren gehen.
function statusOptionenNormalisieren(rohOptionen) {

    return rohOptionen.map((eintrag, i) => {

        if (typeof eintrag === "string") {
            return { name: eintrag, farbe: FARB_VORSCHLAEGE[i % FARB_VORSCHLAEGE.length] };
        }

        return eintrag;

    });

}

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
            ? statusOptionenNormalisieren(snapshot.data().optionen)
            : STANDARD_STATUS.slice();

        renderListe();

        if (!document.getElementById("editorOverlay").classList.contains("hidden")) {
            renderStatusSelect(document.getElementById("inputStatus"), aktuellerBearbeiteterStatus());
        }

    });

}

function aktuellerBearbeiteterStatus() {
    const projekt = projekte.find(p => p.id === bearbeitetesProjektId);
    return projekt?.status || statusOptionen[0]?.name;
}

function renderStatusSelect(selectEl, ausgewaehlt) {

    selectEl.innerHTML = statusOptionen
        .map(s => `<option value="${escapeHtml(s.name)}" ${s.name === ausgewaehlt ? "selected" : ""}>${escapeHtml(s.name)}</option>`)
        .join("");

}

// Farbe kommt aus der (manuell in den Einstellungen zugewiesenen)
// Status-Konfiguration; falls ein Projekt einen Status trägt, der dort
// nicht mehr existiert (z.B. gelöscht), neutraler Fallback.
function farbeFuerStatus(status) {

    const eintrag = statusOptionen.find(s => s.name === status);
    return `var(${eintrag ? eintrag.farbe : "--anthrazit-dunkel"})`;

}

function renderListe() {

    const box = document.getElementById("projekteListe");
    const papierkorbBox = document.getElementById("projektePapierkorb");

    const aktive = projekte.filter(p => !p.geloescht);
    const papierkorb = projekte.filter(p => p.geloescht);

    box.innerHTML = aktive.length === 0
        ? `<p class="hinweis-text">Noch keine Projekte vorhanden.</p>`
        : aktive.map(p => renderProjektKarte(p)).join("");

    papierkorbBox.innerHTML = papierkorb.length === 0
        ? ""
        : `
            <h2 class="papierkorb-kopf">Papierkorb</h2>
            <div class="projekte-liste">
                ${papierkorb.map(p => renderProjektKarte(p, true)).join("")}
            </div>
        `;

}

function renderProjektKarte(p, istPapierkorb) {

    if (istPapierkorb) {

        return `
            <div class="projekt-karte papierkorb" style="background:${farbeFuerStatus(p.status)}">
                <h3 class="karte-titel">${escapeHtml(p.titel)}</h3>
                <p class="karte-beschreibung">${escapeHtml(p.beschreibung)}</p>
                <div class="karte-papierkorb-aktionen">
                    <button class="row-action" onclick="window.projektWiederherstellen('${p.id}')" title="Wiederherstellen">↺</button>
                    <button class="row-action" onclick="window.projektEndgueltigLoeschen('${p.id}')" title="Endgültig löschen">🗑</button>
                </div>
            </div>
        `;

    }

    return `
        <div class="projekt-karte"
            style="background:${farbeFuerStatus(p.status)}"
            draggable="true"
            data-id="${p.id}"
            ondragstart="window.dragStart(event)"
            ondragover="window.dragOver(event)"
            ondrop="window.dragDrop(event)"
            ondragend="window.dragEnd(event)"
            onclick="window.projektBearbeiten('${p.id}')"
        >
            <div class="karte-griff" title="Zum Verschieben ziehen">⠿</div>
            <h3 class="karte-titel">${escapeHtml(p.titel)}</h3>
            <p class="karte-beschreibung">${escapeHtml(p.beschreibung)}</p>
            <div class="karte-verantwortlich">${escapeHtml(p.verantwortlich)}</div>
            <div class="karte-personen">${p.anzahlPersonen ? p.anzahlPersonen : ""}</div>
            <div class="karte-tage">${p.dauerTage ? p.dauerTage + " Tage" : ""}</div>
            <div class="karte-kosten">${p.kosten ? formatChf(p.kosten) : ""}</div>
            <div class="karte-datei">
                ${p.dateiUrl ? `<a href="${escapeHtml(p.dateiUrl)}" target="_blank" rel="noopener" title="${escapeHtml(p.dateiName || "Datei")}" onclick="event.stopPropagation()">📎</a>` : ""}
            </div>
            <select class="karte-status" onclick="event.stopPropagation()" onchange="window.statusInZeileGeaendert('${p.id}', this.value)">
                ${statusOptionen.map(s => `<option value="${escapeHtml(s.name)}" ${s.name === p.status ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}
            </select>
            <button class="row-action" onclick="event.stopPropagation(); window.projektLoeschen('${p.id}')" title="Löschen">🗑</button>
        </div>
    `;

}

function alleKartenElemente() {
    return [...document.querySelectorAll("#projekteListe .projekt-karte")];
}

// Verschiebt beim Ziehen die tatsächliche Karte live an die Zielposition
// (statt Nachbarn per Rand auseinanderzudrücken). Das ist die robustere
// Standard-Technik: sie kommt ohne wiederholtes Neu-Berechnen von
// Rand-Abständen aus, die sich bei jedem dragover selbst wieder
// verschieben würden (genau das führte vorher zum Wackeln, weil sich
// dadurch laufend änderte, über welcher Karte die Maus gerade "wirklich"
// stand).
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

// Fängt das Droppen in der leeren Fläche unterhalb der letzten Karte ab
// (dort gibt es keine Karte, deren dragover-Handler feuern könnte).
function dragOverListe(event) {

    if (event.target !== event.currentTarget || !ziehElement) {
        return;
    }

    event.preventDefault();
    event.currentTarget.appendChild(ziehElement);

}

async function dragDrop(event) {

    event.preventDefault();
    event.stopPropagation(); // sonst feuert das drop-Event zusätzlich am äusseren Container erneut

    if (!ziehElement) {
        return;
    }

    dropErfolgreich = true;

    const neueReihenfolge = alleKartenElemente().map(el => el.dataset.id);

    const batch = writeBatch(db);
    neueReihenfolge.forEach((id, i) => {
        batch.set(doc(db, "projekte", id), { reihenfolge: i }, { merge: true });
    });
    await batch.commit();

    // Lokalen Cache bis zum nächsten Snapshot schon konsistent halten.
    projekte.sort((a, b) => neueReihenfolge.indexOf(a.id) - neueReihenfolge.indexOf(b.id));

}

function dragEnd(event) {

    event.currentTarget.classList.remove("dragging");

    if (!dropErfolgreich && ziehElement) {
        renderListe(); // Drag abgebrochen -> ursprüngliche Reihenfolge wiederherstellen
    }

    ziehElement = null;

}

async function statusInZeileGeaendert(id, neuerStatus) {
    await setDoc(doc(db, "projekte", id), { status: neuerStatus }, { merge: true });
}

// --- Editor ---

function neuesProjekt() {

    bearbeitetesProjektId = null;
    checklisteEntwurf = [];
    kostenEntwurf = [];
    ausgewaehlteDatei = null;
    dateiEntfernen = false;

    document.getElementById("editorTitel").textContent = "Neues Projekt";
    document.getElementById("inputTitel").value = "";
    document.getElementById("inputBeschreibung").value = "";
    document.getElementById("inputVerantwortlich").value = "";
    document.getElementById("inputAnzahlPersonen").value = "";
    document.getElementById("inputDauerTage").value = "";
    document.getElementById("inputStartDatum").value = "";
    document.getElementById("inputEndDatum").value = "";
    document.getElementById("inputVerschiebeStart").value = "";
    document.getElementById("inputVerschiebeEnde").value = "";
    document.getElementById("inputDatei").value = "";

    renderStatusSelect(document.getElementById("inputStatus"), statusOptionen[0]?.name);
    renderChecklisteEditor();
    renderKostenEditor();
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
    kostenEntwurf = (projekt.kostenpositionen || []).map(p => ({ ...p, _uid: neueKostenUid() }));
    ausgewaehlteDatei = null;
    dateiEntfernen = false;

    document.getElementById("editorTitel").textContent = "Projekt bearbeiten";
    document.getElementById("inputTitel").value = projekt.titel || "";
    document.getElementById("inputBeschreibung").value = projekt.beschreibung || "";
    document.getElementById("inputVerantwortlich").value = projekt.verantwortlich || "";
    document.getElementById("inputAnzahlPersonen").value = projekt.anzahlPersonen ?? "";
    document.getElementById("inputDauerTage").value = projekt.dauerTage ?? "";
    document.getElementById("inputStartDatum").value = projekt.startDatum || "";
    document.getElementById("inputEndDatum").value = projekt.endDatum || "";
    document.getElementById("inputVerschiebeStart").value = projekt.verschiebeStart || "";
    document.getElementById("inputVerschiebeEnde").value = projekt.verschiebeEnde || "";
    document.getElementById("inputDatei").value = "";

    renderStatusSelect(document.getElementById("inputStatus"), projekt.status);
    renderChecklisteEditor();
    renderKostenEditor();
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

// --- Kosten-Positionen ---

function neueKostenUid() {
    return "k" + (kostenUidZaehler++);
}

// Effektives Total einer Zeile: bei gesetzter Anzahl berechnet
// (Anzahl x CHF pro Anzahl), sonst der manuell eingetragene Totalwert
// (z.B. für Pauschalpositionen ohne saubere Stückzahl).
function kostenpositionZeileTotal(pos) {

    const anzahl = Number(pos.anzahl) || 0;

    if (anzahl > 0) {
        return anzahl * (Number(pos.chfProAnzahl) || 0);
    }

    return Number(pos.chfTotal) || 0;

}

function kostenGesamtTotal() {
    return kostenEntwurf.reduce((summe, pos) => summe + kostenpositionZeileTotal(pos), 0);
}

function kostenTotalAnzeigeAktualisieren() {
    document.getElementById("kostenTotalAnzeige").textContent = formatChf(kostenGesamtTotal());
}

function renderKostenEditor() {

    document.getElementById("kostenListe").innerHTML = kostenEntwurf.map(pos => {

        const hatAnzahl = Number(pos.anzahl) > 0;
        const total = kostenpositionZeileTotal(pos);

        return `
            <div class="kosten-zeile"
                draggable="true"
                data-uid="${pos._uid}"
                ondragstart="window.kostenDragStart(event)"
                ondragover="window.kostenDragOver(event)"
                ondrop="window.kostenDragDrop(event)"
                ondragend="window.kostenDragEnd(event)"
            >
                <div class="karte-griff" title="Zum Verschieben ziehen">⠿</div>
                <input type="text" value="${escapeHtml(pos.position)}" placeholder="Position" oninput="window.kostenpositionGeaendert('${pos._uid}', 'position', this.value)">
                <input type="number" class="kosten-anzahl" min="0" step="1" value="${pos.anzahl ?? ""}" placeholder="–" oninput="window.kostenpositionGeaendert('${pos._uid}', 'anzahl', this.value)">
                <input type="number" class="kosten-preis" min="0" step="0.05" value="${pos.chfProAnzahl ?? ""}" placeholder="–" ${hatAnzahl ? "" : "disabled"} oninput="window.kostenpositionGeaendert('${pos._uid}', 'chfProAnzahl', this.value)">
                <input type="number" class="kosten-total" min="0" step="0.05" value="${hatAnzahl ? total : (pos.chfTotal ?? "")}" placeholder="–" ${hatAnzahl ? "disabled" : ""} oninput="window.kostenpositionGeaendert('${pos._uid}', 'chfTotal', this.value)">
                <button type="button" class="entfernen-button" onclick="window.kostenpositionEntfernen('${pos._uid}')">✕</button>
            </div>
        `;

    }).join("");

    kostenTotalAnzeigeAktualisieren();

}

function kostenpositionHinzufuegen() {
    kostenEntwurf.push({ _uid: neueKostenUid(), position: "", anzahl: "", chfProAnzahl: "", chfTotal: "" });
    renderKostenEditor();
    const felder = document.querySelectorAll("#kostenListe .kosten-zeile input[type=text]");
    felder[felder.length - 1]?.focus();
}

// Bewusst KEIN volles Re-Render bei jedem Tastendruck (würde den Fokus
// aus dem gerade getippten Feld werfen, siehe Kalender-Feedback zu einem
// ähnlichen Problem) – nur wenn sich Anzahl/Preis ändern, muss die
// Total-Spalte derselben Zeile live nachgeführt werden.
function kostenpositionGeaendert(uid, feld, wert) {

    const pos = kostenEntwurf.find(p => p._uid === uid);

    if (!pos) {
        return;
    }

    pos[feld] = wert;

    if (feld === "position") {
        return; // reine Beschriftung, wirkt sich auf keine andere Anzeige aus
    }

    if (feld === "chfTotal") {
        kostenTotalAnzeigeAktualisieren(); // manuelles Total dieser Zeile fliesst nur ins Gesamt-Total ein
        return;
    }

    kostenZeileAktualisieren(uid); // aktualisiert die Zeile selbst UND (über kostenTotalAnzeigeAktualisieren) das Gesamt-Total

}

function kostenZeileAktualisieren(uid) {

    const pos = kostenEntwurf.find(p => p._uid === uid);
    const zeile = document.querySelector(`.kosten-zeile[data-uid="${uid}"]`);

    if (!pos || !zeile) {
        return;
    }

    const hatAnzahl = Number(pos.anzahl) > 0;
    const preisFeld = zeile.querySelector(".kosten-preis");
    const totalFeld = zeile.querySelector(".kosten-total");

    preisFeld.disabled = !hatAnzahl;
    totalFeld.disabled = hatAnzahl;

    if (hatAnzahl) {
        totalFeld.value = kostenpositionZeileTotal(pos);
    }

    kostenTotalAnzeigeAktualisieren();

}

function kostenpositionEntfernen(uid) {
    kostenEntwurf = kostenEntwurf.filter(p => p._uid !== uid);
    renderKostenEditor();
}

// Gleiche Live-Verschiebe-Technik wie bei den Projekte-Karten/der
// Status-Liste (siehe dragStart/dragOver dort).
function kostenZeilenElemente() {
    return [...document.querySelectorAll("#kostenListe .kosten-zeile")];
}

function kostenDragStart(event) {
    kostenZiehElement = event.currentTarget;
    kostenDropErfolgreich = false;
    event.dataTransfer.effectAllowed = "move";
    event.currentTarget.classList.add("dragging");
}

function kostenDragOver(event) {

    event.preventDefault();

    if (!kostenZiehElement) {
        return;
    }

    const zielEl = event.currentTarget;
    if (zielEl === kostenZiehElement) {
        return;
    }

    const rect = zielEl.getBoundingClientRect();
    const nachUnten = (event.clientY - rect.top) > rect.height / 2;

    if (nachUnten) {
        zielEl.after(kostenZiehElement);
    } else {
        zielEl.before(kostenZiehElement);
    }

}

function kostenDragDrop(event) {

    event.preventDefault();
    event.stopPropagation();

    if (!kostenZiehElement) {
        return;
    }

    kostenDropErfolgreich = true;

    const neueReihenfolge = kostenZeilenElemente().map(el => el.dataset.uid);
    kostenEntwurf.sort((a, b) => neueReihenfolge.indexOf(a._uid) - neueReihenfolge.indexOf(b._uid));

}

function kostenDragEnd(event) {

    event.currentTarget.classList.remove("dragging");

    if (!kostenDropErfolgreich && kostenZiehElement) {
        renderKostenEditor(); // Drag abgebrochen -> ursprüngliche Reihenfolge wiederherstellen
    }

    kostenZiehElement = null;

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

    const startDatum = document.getElementById("inputStartDatum").value;
    const endDatum = document.getElementById("inputEndDatum").value;

    let verschiebeStart = document.getElementById("inputVerschiebeStart").value;
    let verschiebeEnde = document.getElementById("inputVerschiebeEnde").value;

    if (verschiebeStart && (!verschiebeEnde || verschiebeEnde < verschiebeStart)) {
        verschiebeEnde = verschiebeStart;
    }

    const daten = {
        geloescht: false,
        titel,
        beschreibung: document.getElementById("inputBeschreibung").value.trim(),
        verantwortlich: document.getElementById("inputVerantwortlich").value.trim(),
        anzahlPersonen: Number(document.getElementById("inputAnzahlPersonen").value) || 0,
        dauerTage: Number(document.getElementById("inputDauerTage").value) || 0,
        kosten: kostenGesamtTotal(),
        kostenpositionen: kostenEntwurf
            .filter(p => p.position.trim() !== "")
            .map(({ _uid, ...rest }) => rest),
        status: document.getElementById("inputStatus").value,
        checkliste: checklisteEntwurf.filter(p => p.text.trim() !== ""),
        startDatum: startDatum || deleteField(),
        endDatum: endDatum || deleteField(),
        verschiebeStart: verschiebeStart || deleteField(),
        verschiebeEnde: verschiebeStart ? verschiebeEnde : deleteField()
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
    await ereignisFuerProjektSynchronisieren(projektId, titel, startDatum, endDatum, verschiebeStart, verschiebeEnde);

    schliesseEditor();

}

// Spiegelt die optionale Zeitspanne (und ein optionales Verschiebedatum)
// eines Projekts als Ereignis in den Kalender – deterministische ID, damit
// kein Nachschlagen nötig ist (siehe Plan). Best effort: ein Fehlschlag
// hier soll das Speichern des Projekts selbst nicht blockieren.
async function ereignisFuerProjektSynchronisieren(projektId, titel, startDatum, endDatum, verschiebeStart, verschiebeEnde) {

    const ereignisRef = doc(db, "ereignisse", "projekt-" + projektId);

    try {

        if (startDatum && endDatum) {

            // merge:true + explizites deleteField(), statt den Kalender-
            // Eintrag komplett zu überschreiben - sonst würde z.B. ein vom
            // Kalender aus verschobener Balken beim nächsten Projekt-Speichern
            // wieder auf den (dann veralteten) Formular-Stand zurückgesetzt.
            const daten = {
                titel,
                vonDatum: startDatum,
                bisDatum: endDatum,
                projektId,
                verschiebeVon: verschiebeStart && verschiebeEnde ? verschiebeStart : deleteField(),
                verschiebeBis: verschiebeStart && verschiebeEnde ? verschiebeEnde : deleteField()
            };

            await setDoc(ereignisRef, daten, { merge: true });

        } else {

            await deleteDoc(ereignisRef);

        }

    } catch (fehler) {

        console.error("Kalender-Ereignis für Projekt konnte nicht synchronisiert werden:", fehler);

    }

}

async function projektLoeschen(id) {

    const projekt = projekte.find(p => p.id === id);

    if (!confirm(`Projekt "${projekt?.titel || ""}" wirklich löschen?`)) {
        return;
    }

    // Soft delete: die Datei bleibt vorerst erhalten (erst bei endgültigem
    // Löschen aus dem Papierkorb entfernt), das Kalender-Ereignis
    // verschwindet aber sofort, damit ein "gelöschtes" Projekt nicht mehr
    // im Kalender auftaucht.
    await setDoc(doc(db, "projekte", id), { geloescht: true }, { merge: true });
    await deleteDoc(doc(db, "ereignisse", "projekt-" + id)).catch(() => {});

}

async function projektWiederherstellen(id) {

    const projekt = projekte.find(p => p.id === id);
    if (!projekt) {
        return;
    }

    await setDoc(doc(db, "projekte", id), { geloescht: false }, { merge: true });

    if (projekt.startDatum && projekt.endDatum) {
        await ereignisFuerProjektSynchronisieren(
            id, projekt.titel, projekt.startDatum, projekt.endDatum,
            projekt.verschiebeStart, projekt.verschiebeEnde
        );
    }

}

async function projektEndgueltigLoeschen(id) {

    const projekt = projekte.find(p => p.id === id);

    if (!confirm(`Projekt "${projekt?.titel || ""}" endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) {
        return;
    }

    if (projekt?.dateiId) {
        dateiLoeschen(projekt.dateiId);
    }

    await deleteDoc(doc(db, "projekte", id));
    await deleteDoc(doc(db, "ereignisse", "projekt-" + id)).catch(() => {});

}

// --- Status-Konfiguration ---

let statusUidZaehler = 0;

function neueStatusUid() {
    return "s" + (statusUidZaehler++);
}

function oeffneStatusConfig() {

    statusConfigEntwurf = statusOptionen.map(s => ({ ...s, _uid: neueStatusUid() }));
    renderStatusConfigListe();
    document.getElementById("statusConfigOverlay").classList.remove("hidden");

}

function schliesseStatusConfig() {
    document.getElementById("statusConfigOverlay").classList.add("hidden");
}

function renderStatusConfigListe() {

    document.getElementById("statusConfigListe").innerHTML = statusConfigEntwurf.map(eintrag => `
        <div class="status-config-zeile"
            draggable="true"
            data-uid="${eintrag._uid}"
            ondragstart="window.statusDragStart(event)"
            ondragover="window.statusDragOver(event)"
            ondrop="window.statusDragDrop(event)"
            ondragend="window.statusDragEnd(event)"
        >
            <div class="karte-griff" title="Zum Verschieben ziehen">⠿</div>
            <input type="text" value="${escapeHtml(eintrag.name)}" oninput="window.statusOptionGeaendert('${eintrag._uid}', this.value)">
            <div class="farb-swatches">
                ${FARB_VORSCHLAEGE.map(token => `
                    <button
                        type="button"
                        class="farb-swatch ${eintrag.farbe === token ? "ausgewaehlt" : ""}"
                        style="background:var(${token})"
                        onclick="window.statusFarbeSetzen('${eintrag._uid}', '${token}')"
                    ></button>
                `).join("")}
            </div>
            <button type="button" class="entfernen-button" onclick="window.statusOptionEntfernen('${eintrag._uid}')">✕</button>
        </div>
    `).join("");

}

function statusOptionHinzufuegen() {
    statusConfigEntwurf.push({ name: "", farbe: FARB_VORSCHLAEGE[statusConfigEntwurf.length % FARB_VORSCHLAEGE.length], _uid: neueStatusUid() });
    renderStatusConfigListe();
    const felder = document.querySelectorAll("#statusConfigListe input[type=text]");
    felder[felder.length - 1]?.focus();
}

function statusOptionGeaendert(uid, wert) {
    const eintrag = statusConfigEntwurf.find(e => e._uid === uid);
    if (eintrag) {
        eintrag.name = wert;
    }
}

function statusFarbeSetzen(uid, token) {
    const eintrag = statusConfigEntwurf.find(e => e._uid === uid);
    if (eintrag) {
        eintrag.farbe = token;
    }
    renderStatusConfigListe();
}

function statusOptionEntfernen(uid) {
    statusConfigEntwurf = statusConfigEntwurf.filter(e => e._uid !== uid);
    renderStatusConfigListe();
}

// Gleiche Live-Verschiebe-Technik wie bei den Projekte-Karten (siehe
// dragStart/dragOver dort) – Reihenfolge bleibt rein lokal in
// statusConfigEntwurf, bis "Speichern" geklickt wird.
function statusConfigZeilenElemente() {
    return [...document.querySelectorAll("#statusConfigListe .status-config-zeile")];
}

function statusDragStart(event) {
    statusZiehElement = event.currentTarget;
    statusDropErfolgreich = false;
    event.dataTransfer.effectAllowed = "move";
    event.currentTarget.classList.add("dragging");
}

function statusDragOver(event) {

    event.preventDefault();

    if (!statusZiehElement) {
        return;
    }

    const zielEl = event.currentTarget;
    if (zielEl === statusZiehElement) {
        return;
    }

    const rect = zielEl.getBoundingClientRect();
    const nachUnten = (event.clientY - rect.top) > rect.height / 2;

    if (nachUnten) {
        zielEl.after(statusZiehElement);
    } else {
        zielEl.before(statusZiehElement);
    }

}

function statusDragDrop(event) {

    event.preventDefault();
    event.stopPropagation();

    if (!statusZiehElement) {
        return;
    }

    statusDropErfolgreich = true;

    const neueReihenfolge = statusConfigZeilenElemente().map(el => el.dataset.uid);
    statusConfigEntwurf.sort((a, b) => neueReihenfolge.indexOf(a._uid) - neueReihenfolge.indexOf(b._uid));

}

function statusDragEnd(event) {

    event.currentTarget.classList.remove("dragging");

    if (!statusDropErfolgreich && statusZiehElement) {
        renderStatusConfigListe();
    }

    statusZiehElement = null;

}

async function statusConfigSpeichern() {

    const optionen = statusConfigEntwurf
        .map(s => ({ name: s.name.trim(), farbe: s.farbe }))
        .filter(s => s.name);

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
window.dragOver = dragOver;
window.dragOverListe = dragOverListe;
window.dragDrop = dragDrop;
window.dragEnd = dragEnd;
window.statusInZeileGeaendert = statusInZeileGeaendert;
window.neuesProjekt = neuesProjekt;
window.projektBearbeiten = projektBearbeiten;
window.schliesseEditor = schliesseEditor;
window.checklistePunktHinzufuegen = checklistePunktHinzufuegen;
window.checklistePunktGeaendert = checklistePunktGeaendert;
window.checklistePunktEntfernen = checklistePunktEntfernen;
window.kostenpositionHinzufuegen = kostenpositionHinzufuegen;
window.kostenpositionGeaendert = kostenpositionGeaendert;
window.kostenpositionEntfernen = kostenpositionEntfernen;
window.kostenDragStart = kostenDragStart;
window.kostenDragOver = kostenDragOver;
window.kostenDragDrop = kostenDragDrop;
window.kostenDragEnd = kostenDragEnd;
window.dateiEntfernenKlick = dateiEntfernenKlick;
window.projektSpeichern = projektSpeichern;
window.projektLoeschen = projektLoeschen;
window.projektWiederherstellen = projektWiederherstellen;
window.projektEndgueltigLoeschen = projektEndgueltigLoeschen;
function hilfeOeffnen() {
    document.getElementById("hilfeOverlay").classList.remove("hidden");
}

function hilfeSchliessen() {
    document.getElementById("hilfeOverlay").classList.add("hidden");
}

window.hilfeOeffnen = hilfeOeffnen;
window.hilfeSchliessen = hilfeSchliessen;
window.oeffneStatusConfig = oeffneStatusConfig;
window.schliesseStatusConfig = schliesseStatusConfig;
window.statusOptionHinzufuegen = statusOptionHinzufuegen;
window.statusOptionGeaendert = statusOptionGeaendert;
window.statusFarbeSetzen = statusFarbeSetzen;
window.statusOptionEntfernen = statusOptionEntfernen;
window.statusDragStart = statusDragStart;
window.statusDragOver = statusDragOver;
window.statusDragDrop = statusDragDrop;
window.statusDragEnd = statusDragEnd;
window.statusConfigSpeichern = statusConfigSpeichern;

init();

console.log("App gestartet");

// Zentrale Apps-Script-URL – nur an dieser einen Stelle eintragen.
const APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbzosmOtgS7rsXidxsoRodPDiJzAt6CBSEFeLkMZUBTK10O3r6v10t1E9Qfn4DlMF9Na_g/exec";

// Schlüssel für alles, was lokal überleben muss (Zustand & Fragen-Cache).
const ZUSTAND_KEY = "cortasiell_zustand";
const FRAGEN_CACHE_KEY = "cortasiell_fragen_cache";

// Additive Hierarchie: "alle Vorräte" enthält automatisch "nur das
// nötigste", "inkl. Einrichtung" enthält automatisch beides davor.
// Die Strings müssen exakt so auch in der Spalte "Inventartyp" im
// Google Sheet stehen.
const UMFANG_STUFEN = [
    "nur das nötigste",
    "alle Vorräte",
    "inkl. Einrichtung"
];

let alleFragen = [];
let fragen = [];
let inventur = [];
let neueEintraege = [];
let aktuelleFrage = 0;
let abgeschlossen = false;
let synchronisiert = false;
let umfang = null;

init();

async function init() {

    await ladeFragenMitCache();

    ladeZustand();

    if (umfang) {
        fragen = filtereFragenNachUmfang(alleFragen, umfang);
    }

    if (abgeschlossen && !synchronisiert) {

        // Es liegt eine fertig ausgefüllte, aber noch nicht
        // bestätigt synchronisierte Inventur vor (z.B. weil beim
        // letzten Mal die Verbindung abgerissen ist). Nicht neu
        // starten, sondern gleich wieder synchronisieren versuchen.
        zeigeAbschluss();
        synchronisieren();

    } else if (abgeschlossen && synchronisiert) {

        // Letzte Inventur ist erfolgreich durch. Sauberer Neustart,
        // inkl. erneuter Abfrage des gewünschten Umfangs.
        inventur = [];
        neueEintraege = [];
        aktuelleFrage = 0;
        abgeschlossen = false;
        synchronisiert = false;
        umfang = null;

        speichereZustand();

        zeigeUmfangAuswahl();

    } else if (!umfang) {

        // Ganz neue Session, es wurde noch kein Umfang gewählt.
        zeigeUmfangAuswahl();

    } else {

        // Laufende, noch nicht abgeschlossene Inventur fortsetzen.
        zeigeFrage();

    }

}

function filtereFragenNachUmfang(liste, gewaehlterUmfang) {

    const gewaehlterIndex = UMFANG_STUFEN.indexOf(gewaehlterUmfang);

    return liste.filter(f => {

        const typIndex = UMFANG_STUFEN.indexOf(
            String(f.inventartyp).trim()
        );

        return typIndex !== -1 && typIndex <= gewaehlterIndex;

    });

}

function zeigeUmfangAuswahl() {

    document.getElementById("fortschritt").innerHTML = "";
    document.getElementById("ort").innerHTML = "";

    document.getElementById("frage").innerHTML = `
        <h2>Was möchtest du prüfen?</h2>

        <button onclick="waehleUmfang('nur das nötigste')">
            Nur das Nötigste
        </button>

        <button onclick="waehleUmfang('alle Vorräte')">
            Alle Vorräte
        </button>

        <button onclick="waehleUmfang('inkl. Einrichtung')">
            Inkl. Einrichtung
        </button>
    `;

}

function waehleUmfang(gewaehlterUmfang) {

    umfang = gewaehlterUmfang;
    fragen = filtereFragenNachUmfang(alleFragen, umfang);

    inventur = [];
    neueEintraege = [];
    aktuelleFrage = 0;
    abgeschlossen = false;
    synchronisiert = false;

    speichereZustand();

    zeigeFrage();

}

async function ladeFragenMitCache() {

    try {

        const response = await fetch(APPS_SCRIPT_URL);

        alleFragen = await response.json();

        localStorage.setItem(
            FRAGEN_CACHE_KEY,
            JSON.stringify(alleFragen)
        );

        console.log("Fragen online geladen und zwischengespeichert:", alleFragen);

    } catch (error) {

        console.warn(
            "Fragen konnten nicht online geladen werden, versuche Cache:",
            error
        );

        const cache = localStorage.getItem(FRAGEN_CACHE_KEY);

        if (cache) {

            alleFragen = JSON.parse(cache);

            console.log("Fragen aus lokalem Cache geladen:", alleFragen);

        } else {

            alleFragen = [];

            zeigeFehler(
                "Keine Internetverbindung und keine gespeicherten " +
                "Fragen vorhanden. Bitte einmal mit Internetverbindung " +
                "starten, damit die Fragen lokal gespeichert werden."
            );

        }

    }

}

function ladeZustand() {

    const gespeichert = localStorage.getItem(ZUSTAND_KEY);

    if (!gespeichert) {
        return;
    }

    const zustand = JSON.parse(gespeichert);

    inventur = zustand.inventur || [];
    neueEintraege = zustand.neueEintraege || [];
    aktuelleFrage = zustand.aktuelleFrage || 0;
    abgeschlossen = zustand.abgeschlossen || false;
    synchronisiert = zustand.synchronisiert || false;
    umfang = zustand.umfang || null;

}

function speichereZustand() {

    localStorage.setItem(
        ZUSTAND_KEY,
        JSON.stringify({
            inventur,
            neueEintraege,
            aktuelleFrage,
            abgeschlossen,
            synchronisiert,
            umfang
        })
    );

}

function zeigeFehler(text) {

    document.getElementById("frage").innerHTML =
        `<h2>⚠️ ${text}</h2>`;

}

function zeigeFrage() {

    if (!fragen[aktuelleFrage]) {

        console.log("Keine weitere Frage vorhanden");

        return;
    }

    const frage = fragen[aktuelleFrage];

    const zurueckButton =
        aktuelleFrage > 0 ? `
            <button onclick="zurueck()" class="zurueck-button">
                ‹ Zurück
            </button>
        ` : "";

    const vorButton =
        aktuelleFrage < fragen.length - 1 ? `
            <button onclick="vor()" class="vor-button">
                Vor ›
            </button>
        ` : "";

    document.getElementById("fortschritt").innerHTML = `
        ${zurueckButton}
        <span class="fortschritt-zaehler">
            ${aktuelleFrage + 1} / ${fragen.length}
        </span>
        ${vorButton}
    `;

    document.getElementById("ort").innerHTML =
        frage.ort;

    const typ =
        String(frage.erfassungstyp).trim();

    if (typ === "Menge") {

        document.getElementById("frage").innerHTML = `
            <h2><span class="produkt">${frage.produkt}</span></h2>

            <div class="mengen-feld">
                <input
                    type="number"
                    id="anzahlFeld"
                    value="${frage.info || 0}"
                    min="0"
                    onfocus="this.select()"
                >
                <span class="einheit-suffix">${frage.einheit}</span>
            </div>

            <button onclick="speichereAnzahl()">
                Speichern & Weiter
            </button>

            <button onclick="zeigeNeuerEintragFormular()" class="neuer-eintrag-button">
                ➕ Neuer Eintrag
            </button>
        `;

    } else {

        const produktSpan =
            `<span class="produkt">${frage.produkt}</span>`;

        let frageText = produktSpan;

        let zeigeUnveraendert = false;

        if (typ === "vorhanden") {

            frageText =
                `${produktSpan} vorhanden?`;

        } else if (typ === "genügend") {

            frageText =
                `Genügend ${produktSpan} vorhanden?`;

            zeigeUnveraendert = true;

        } else if (!isNaN(Number(typ))) {

            frageText =
                `Mindestens ${typ} ${frage.einheit} ${produktSpan} vorhanden?`;

            zeigeUnveraendert = true;

        }

        // "Unverändert" nur anbieten, wenn es überhaupt einen
        // bisherigen Wert gibt, den man übernehmen könnte.
        const bisherigerWert =
            String(frage.info || "").trim();

        const unveraendertButton =
            (zeigeUnveraendert && bisherigerWert) ? `
                <button onclick="antwortUnveraendert()">
                    Unverändert (${bisherigerWert})
                </button>
            ` : "";

        document.getElementById("frage").innerHTML = `
            <h2>${frageText}</h2>

            ${unveraendertButton}

            <div class="ja-nein-reihe">
                <button onclick="antwortJa()">Ja</button>
                <button onclick="antwortNein()">Nein</button>
            </div>

            <button onclick="zeigeNeuerEintragFormular()" class="neuer-eintrag-button">
                ➕ Neuer Eintrag
            </button>
        `;
    }

}

function zurueck() {

    if (aktuelleFrage === 0) {
        return;
    }

    aktuelleFrage--;

    speichereZustand();

    zeigeFrage();

}

function vor() {

    if (aktuelleFrage >= fragen.length - 1) {
        return;
    }

    aktuelleFrage++;

    speichereZustand();

    zeigeFrage();

}

function geheZumStart() {

    if (fragen.length === 0) {
        return;
    }

    aktuelleFrage = 0;
    abgeschlossen = false;

    speichereZustand();

    zeigeFrage();

}

// Trägt die Antwort zur jeweiligen Sheet-Zeile ein. Gibt es für diese
// Zeile bereits einen Wert (z.B. weil die Frage nach einem Zurück/Vor
// erneut beantwortet wurde), wird er ersetzt statt dupliziert – so
// bleibt "eine Zeile = ein Eintrag" auch bei freier Navigation erhalten.
function speichereAntwort(zeile, wert) {

    const bestehenderIndex =
        inventur.findIndex(eintrag => eintrag.zeile === zeile);

    if (bestehenderIndex !== -1) {
        inventur[bestehenderIndex].wert = wert;
    } else {
        inventur.push({ zeile, wert });
    }

}


function antwortUnveraendert() {

    speichereAntwort(
        fragen[aktuelleFrage].zeile,
        fragen[aktuelleFrage].info
    );

    naechsteFrage();
}

function antwortJa() {

    speichereAntwort(fragen[aktuelleFrage].zeile, "ja");

    naechsteFrage();
}


function antwortNein() {

    speichereAntwort(fragen[aktuelleFrage].zeile, "nein");

    naechsteFrage();
}

function zeigeNeuerEintragFormular() {

    document.getElementById("frage").innerHTML = `
        <h2>Neuer Eintrag</h2>

        <input type="text" id="neuOrt" placeholder="Ort">
        <input type="text" id="neuProdukt" placeholder="Produkt">
        <input type="text" id="neuMenge" placeholder="Menge (z.B. 5 kg)">

        <button onclick="speichereNeuerEintrag()">
            Speichern
        </button>

        <button onclick="zeigeFrage()" class="abbrechen-button">
            Abbrechen
        </button>
    `;

}

function speichereNeuerEintrag() {

    const ort =
        document.getElementById("neuOrt").value.trim();

    const produkt =
        document.getElementById("neuProdukt").value.trim();

    const menge =
        document.getElementById("neuMenge").value.trim();

    if (!produkt) {

        alert("Bitte mindestens ein Produkt eingeben.");

        return;
    }

    neueEintraege.push({
        tempId:
            "neu_" + Date.now() + "_" +
            Math.random().toString(36).slice(2, 8),
        ort,
        produkt,
        menge
    });

    speichereZustand();

    // Zurück zur Frage, bei der wir unterbrochen haben – der
    // Fortschritt der eigentlichen Inventur bleibt unangetastet.
    zeigeFrage();

}

function speichereAnzahl() {

    const wert =
        document.getElementById("anzahlFeld").value;

    speichereAntwort(fragen[aktuelleFrage].zeile, wert);

    naechsteFrage();
}

function naechsteFrage() {

    aktuelleFrage++;

    if (aktuelleFrage < fragen.length) {

        // Nach jeder einzelnen Antwort sofort sichern – so geht bei
        // einem Absturz/Tab-Kill höchstens die aktuelle Frage
        // verloren, nie der bisherige Fortschritt.
        speichereZustand();

        zeigeFrage();

    } else {

        abgeschlossen = true;
        synchronisiert = false;

        speichereZustand();

        zeigeAbschluss();

        // Gleich den ersten Sync-Versuch anstossen. Klappt er nicht
        // (kein Netz, Verbindungsabbruch), bleibt die Inventur als
        // "pending" gespeichert und wird beim nächsten App-Start
        // bzw. sobald wieder Netz da ist, automatisch erneut versucht.
        synchronisieren();

    }

}

function zeigeAbschluss() {

    document.getElementById("frage").innerHTML = `
        <h2>Inventur abgeschlossen ✅</h2>

        <pre>
${JSON.stringify(inventur, null, 2)}
        </pre>

        <p>Zum Synchronisieren die Leiste unten verwenden.</p>
    `;

}

function zeigeSpeicher() {

    let ausgabe = "";

    for (let i = 0; i < localStorage.length; i++) {

        const key = localStorage.key(i);
        const value = localStorage.getItem(key);

        ausgabe += key + ": " + value + "\n";
    }

    alert(ausgabe);
}

if ("serviceWorker" in navigator) {

    navigator.serviceWorker
        .register("./service-worker.js")
        .then(() => {

            console.log("Service Worker registriert");

        });

}

// Sobald der Browser erkennt, dass wieder Netz da ist (während die
// App offen ist), automatisch einen neuen Sync-Versuch anstossen,
// falls noch eine unsynchronisierte Inventur aussteht.
window.addEventListener("online", () => {

    if (abgeschlossen && !synchronisiert) {

        console.log("Verbindung wiederhergestellt – versuche erneut zu synchronisieren.");

        synchronisieren();

    }

});

async function synchronisieren() {

    if (inventur.length === 0 && neueEintraege.length === 0) {

        // Weder Antworten noch neue Einträge vorhanden – nichts zu senden.
        zeigeSyncStatus("Noch keine Antworten zum Synchronisieren.");

        return;
    }

    const url = APPS_SCRIPT_URL;

    const payload = {
        daten: inventur,
        neu: neueEintraege
    };

    zeigeSyncStatus("Übertrage...");

    try {

        // Senden bleibt bewusst no-cors: die Antwort von doPost
        // wollen wir hier gar nicht lesen, nur die Daten hinschicken.
        await fetch(url, {
            method: "POST",
            mode: "no-cors",
            body: JSON.stringify(payload)
        });

        const bestaetigt = await warteAufBestaetigung(url, inventur, neueEintraege);

        if (bestaetigt) {

            const zeitpunkt = new Date().toLocaleTimeString(
                "de-CH",
                { hour: "2-digit", minute: "2-digit" }
            );

            // Neue Einträge sind jetzt bestätigt im Sheet – aus der
            // lokalen Warteschlange entfernen, damit sie bei einem
            // künftigen Sync nicht nochmals mitgeschickt werden.
            neueEintraege = [];

            if (abgeschlossen) {

                zeigeSyncStatus(
                    `Inventur übertragen ✅ (bestätigt, ${zeitpunkt})`
                );

                synchronisiert = true;

            } else {

                // Teil-Sicherung mitten in der Inventur: die bisher
                // beantworteten Fragen sind sicher im Sheet, das
                // Ausfüllen geht danach normal weiter.
                zeigeSyncStatus(
                    `Zwischenstand gesichert (${zeitpunkt}) – ` +
                    `${inventur.length} von ${fragen.length} beantwortet.`
                );

            }

            speichereZustand();

        } else {

            zeigeSyncStatus(
                "⚠️ Gesendet, aber nicht bestätigt – vermutlich " +
                "keine oder eine instabile Verbindung. Die Daten " +
                "bleiben lokal gespeichert und werden beim nächsten " +
                "Öffnen der App bzw. sobald wieder Netz da ist, " +
                "automatisch erneut versucht. Du kannst es auch " +
                "jederzeit über den Button unten erneut versuchen."
            );

        }

    } catch (error) {

        console.error(error);

        zeigeSyncStatus(
            "❌ Verbindung derzeit nicht möglich. Die Daten " +
            "bleiben lokal gespeichert – bitte später erneut " +
            "versuchen, sobald wieder Netz vorhanden ist."
        );

    }

}

// Lädt die aktuellen Daten per doGet neu (normaler, unproblematischer
// Cross-Origin-GET) und prüft, ob die gerade gesendeten Werte in den
// betroffenen Zeilen wirklich im Sheet angekommen sind. Das Verfahren
// ist idempotent: mehrfaches Senden derselben Inventur überschreibt
// dieselben Zeilen einfach erneut mit denselben Werten – schadet also
// nicht, falls ein Sync-Versuch mehrfach nötig ist.
async function warteAufBestaetigung(url, erwarteteEintraege, erwarteteNeueEintraege = [], versuche = 5, wartezeitMs = 1500) {

    for (let i = 0; i < versuche; i++) {

        await warte(wartezeitMs);

        try {

            const antwort = await fetch(url);
            const aktuelleDaten = await antwort.json();

            const passenUpdates = erwarteteEintraege.every(eintrag => {

                const zeile = aktuelleDaten.find(
                    f => f.zeile === eintrag.zeile
                );

                return zeile &&
                    String(zeile.info) === String(eintrag.wert);

            });

            const passenNeue = erwarteteNeueEintraege.every(eintrag =>

                aktuelleDaten.some(
                    f => f.erfasstId === eintrag.tempId
                )

            );

            if (passenUpdates && passenNeue) {
                return true;
            }

        } catch (error) {

            console.error("Prüfung fehlgeschlagen:", error);

        }

    }

    return false;

}

function warte(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function zeigeSyncStatus(text) {

    let statusEl = document.getElementById("syncStatus");

    if (!statusEl) {

        statusEl = document.createElement("p");
        statusEl.id = "syncStatus";

        document.getElementById("frage").appendChild(statusEl);

    }

    statusEl.innerHTML = text;

}
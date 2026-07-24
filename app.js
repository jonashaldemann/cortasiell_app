console.log("App gestartet");

// Zentrale Apps-Script-URL – nur an dieser einen Stelle eintragen.
const APPS_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbyu32EMYI3qNcifPw42J9rrdSjavNY0NGUvMqZduEFMBOyTlhJrnsUXiiBSFwmVT94uLQ/exec";

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

    document.getElementById("fortschritt").innerHTML =
        (aktuelleFrage + 1) +
        " / " +
        fragen.length;

    document.getElementById("ort").innerHTML =
        frage.ort;

    const typ =
        String(frage.erfassungstyp).trim();

    if (typ === "Menge") {

        document.getElementById("frage").innerHTML = `
            <h2><span class="produkt">${frage.produkt}</span></h2>

            <p>Einheit: ${frage.einheit}</p>

            <input
                type="number"
                id="anzahlFeld"
                value="${frage.info || 0}"
                min="0"
                onfocus="this.select()"
            >

            <button onclick="speichereAnzahl()">
                Speichern & Weiter
            </button>
        `;

    } else {

        const produktSpan =
            `<span class="produkt">${frage.produkt}</span>`;

        let frageText = produktSpan;

        if (typ === "vorhanden") {

            frageText =
                `${produktSpan} vorhanden?`;

        } else if (typ === "genügend") {

            frageText =
                `Genügend ${produktSpan} vorhanden?`;

        } else if (!isNaN(Number(typ))) {

            frageText =
                `Mindestens ${typ} ${frage.einheit} ${produktSpan} vorhanden?`;

        }

        document.getElementById("frage").innerHTML = `
            <h2>${frageText}</h2>

            <button onclick="antwortJa()">Ja</button>

            <button onclick="antwortNein()">Nein</button>
        `;
    }

}


function antwortJa() {

    inventur.push({
        zeile: fragen[aktuelleFrage].zeile,
        wert: "ja"
    });

    naechsteFrage();
}


function antwortNein() {

    inventur.push({
        zeile: fragen[aktuelleFrage].zeile,
        wert: "nein"
    });

    naechsteFrage();
}

function speichereAnzahl() {

    const wert =
        document.getElementById("anzahlFeld").value;

    inventur.push({
        zeile: fragen[aktuelleFrage].zeile,
        wert: wert
    });

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

    if (inventur.length === 0) {

        // Noch keine einzige Antwort vorhanden – nichts zu senden.
        zeigeSyncStatus("Noch keine Antworten zum Synchronisieren.");

        return;
    }

    const url = APPS_SCRIPT_URL;

    const payload = {
        daten: inventur
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

        const bestaetigt = await warteAufBestaetigung(url, inventur);

        if (bestaetigt) {

            const zeitpunkt = new Date().toLocaleTimeString(
                "de-CH",
                { hour: "2-digit", minute: "2-digit" }
            );

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
async function warteAufBestaetigung(url, erwarteteEintraege, versuche = 5, wartezeitMs = 1500) {

    for (let i = 0; i < versuche; i++) {

        await warte(wartezeitMs);

        try {

            const antwort = await fetch(url);
            const aktuelleDaten = await antwort.json();

            const passtAlles = erwarteteEintraege.every(eintrag => {

                const zeile = aktuelleDaten.find(
                    f => f.zeile === eintrag.zeile
                );

                return zeile &&
                    String(zeile.info) === String(eintrag.wert);

            });

            if (passtAlles) {
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
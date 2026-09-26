function doGet(e) {

  // Bewusst per GET statt POST: POST-Antworten von Apps-Script-Web-Apps
  // kommen beim automatischen Redirect-Folgen (macht sowohl fetch() im
  // Browser als auch curl -L) zuverlässig als kaputter 405 zurück - ein
  // altbekanntes Google-Apps-Script-Verhalten, unabhängig vom eigenen
  // Code. GET funktioniert dagegen nachweislich (siehe Rest dieser
  // Funktion), deshalb hängt sich diese Aktion hier mit dran statt in
  // doPost().
  if (e && e.parameter && e.parameter.aktion === "menuvorschlaege") {
    return ContentService
      .createTextOutput(JSON.stringify(holeMenuvorschlaege()))
      .setMimeType(ContentService.MimeType.JSON);
  }

  const sheet =
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName("Inventurdaten");

  const daten =
    sheet.getDataRange().getValues();

  const result = [];

  for (let i = 1; i < daten.length; i++) {

    result.push({
      zeile: i + 1,
      ort: daten[i][0],
      produkt: daten[i][1],
      erfassungstyp: daten[i][2],
      info: daten[i][3],
      einheit: daten[i][4],
      inventartyp: daten[i][5],
      erfasstId: daten[i][7]
    });

  }

  return ContentService
    .createTextOutput(
      JSON.stringify(result)
    )
    .setMimeType(
      ContentService.MimeType.JSON
    );

}

function doPost(e) {

  const payload =
    JSON.parse(e.postData.contents);

  const sheet =
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName("Inventurdaten");

  const daten =
    payload.daten || [];

  daten.forEach(eintrag => {

    // Spalte D = Info
    sheet
      .getRange(eintrag.zeile, 4)
      .setValue(eintrag.wert);

    // Spalte F = Inventartyp (wird manuell im Sheet gepflegt, hier nicht beschrieben)

    // Spalte G = Letzte Inventur (Datum + Uhrzeit)
    const zeitstempelZelle =
      sheet.getRange(eintrag.zeile, 7);

    zeitstempelZelle.setValue(new Date());
    zeitstempelZelle.setNumberFormat("dd.MM.yyyy HH:mm");

  });

  const neu =
    payload.neu || [];

  if (neu.length > 0) {

    // Bereits vorhandene Erfasst-IDs einlesen, um bei wiederholten
    // Sync-Versuchen keine doppelten Zeilen anzuhängen (im Gegensatz
    // zu den Updates oben ist appendRow nicht von selbst
    // wiederholungssicher).
    const anzahlZeilen =
      Math.max(sheet.getLastRow() - 1, 1);

    const vorhandeneIds =
      sheet
        .getRange(2, 8, anzahlZeilen, 1)
        .getValues()
        .flat();

    neu.forEach(eintrag => {

      if (vorhandeneIds.includes(eintrag.tempId)) {
        return; // schon vorhanden, überspringen
      }

      sheet.appendRow([
        eintrag.ort || "",
        eintrag.produkt || "",
        "",                    // Erfassungstyp: später manuell im Sheet
        eintrag.menge || "",
        "",                    // Einheit: später manuell im Sheet
        "",                    // Inventartyp: später manuell im Sheet
        new Date(),
        eintrag.tempId
      ]);

    });

  }

  return ContentService
    .createTextOutput("POST OK");
}


// Grobe Einschätzung "ist das (noch) vorhanden?" je nach Erfassungstyp
// (Spalte C) – dieselbe Logik wie in app.js beim Anzeigen der Frage,
// hier nur zur Entscheidung, was in den KI-Prompt aufgenommen wird.
function istVorhanden(erfassungstyp, info) {

  const typ = String(erfassungstyp || "").trim();
  const wert = String(info || "").trim().toLowerCase();

  if (typ === "Menge") {
    return Number(info) > 0;
  }

  // "vorhanden" / "genügend" / "Minimum N" (oder alte nackte Zahl) –
  // alles Ja/Nein-Fragen, "ja" heisst vorhanden bzw. genügend vorhanden.
  return wert === "ja";

}

// Google-Modelle antworten gelegentlich mit 503 ("high demand", meist
// kurz nach Release eines neuen Modells) oder 429 (Rate-Limit) - beides
// typischerweise vorübergehend. Statt sofort aufzugeben, bis zu 3x mit
// steigender Wartezeit erneut versuchen, bevor der letzte (dann auch
// fehlerhafte) Versuch zurückgegeben wird.
function rufeGeminiMitRetry(url, options, maxVersuche) {

  maxVersuche = maxVersuche || 3;

  for (let versuch = 1; versuch <= maxVersuche; versuch++) {

    const antwort = UrlFetchApp.fetch(url, options);
    const status = antwort.getResponseCode();

    if ((status !== 503 && status !== 429) || versuch === maxVersuche) {
      return antwort;
    }

    Utilities.sleep(2000 * versuch); // 2s, 4s, ...

  }

}

// Liest den aktuellen Vorrat aus dem Sheet, schickt ihn an die
// Anthropic-API und lässt 3 Rezeptvorschläge erstellen, die möglichst
// viel davon nutzen. Erwartet einen API-Key in den Script-Properties
// (Projekteinstellungen -> Script-Properties -> ANTHROPIC_API_KEY),
// damit der Key nicht im Code/Repo landet.
function holeMenuvorschlaege() {

  const sheet =
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName("Inventurdaten");

  const daten =
    sheet.getDataRange().getValues();

  const vorhandeneProdukte = [];

  for (let i = 1; i < daten.length; i++) {

    const ort = daten[i][0];
    const produkt = String(daten[i][1] || "").trim();
    const erfassungstyp = daten[i][2];
    const info = daten[i][3];

    if (produkt && istVorhanden(erfassungstyp, info)) {
      vorhandeneProdukte.push(ort ? `${produkt} (${ort})` : produkt);
    }

  }

  if (vorhandeneProdukte.length === 0) {
    return { fehler: "Keine als vorhanden erfassten Produkte im Inventar gefunden." };
  }

  const apiKey =
    PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");

  if (!apiKey) {
    return { fehler: "Kein Gemini-API-Key hinterlegt (Script-Properties: GEMINI_API_KEY fehlt)." };
  }

  const prompt =
    "Aktueller Vorrat einer Ferienhütte:\n\n" +
    vorhandeneProdukte.join("\n") +
    "\n\nSchlage genau 3 Rezepte vor, die sich möglichst gut aus diesem " +
    "Vorrat kochen lassen, mit möglichst wenigen zusätzlichen Zutaten. " +
    "Antworte AUSSCHLIESSLICH mit einem JSON-Array (kein Text davor/danach, " +
    "keine Markdown-Codeblöcke), jedes Element mit den Feldern: " +
    "\"titel\" (string), \"zubereitung\" (string, 2-3 Sätze), " +
    "\"zusatzZutaten\" (Array von Strings, leeres Array falls keine " +
    "zusätzlichen Zutaten nötig sind).";

  // "gemini-2.5-flash" ist für neue Nutzer nicht mehr verfügbar (Stand
  // September 2026, Google-Fehlermeldung empfiehlt "gemini-3.8-flash").
  const modell = "gemini-3.8-flash";

  const antwort = rufeGeminiMitRetry(
    "https://generativelanguage.googleapis.com/v1beta/models/" + modell + ":generateContent",
    {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-goog-api-key": apiKey
      },
      payload: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      }),
      muteHttpExceptions: true
    }
  );

  const status = antwort.getResponseCode();
  const body = JSON.parse(antwort.getContentText());

  if (status !== 200) {
    return { fehler: "Gemini-API-Fehler (" + status + "): " + (body.error?.message || antwort.getContentText()) };
  }

  const text =
    (body.candidates && body.candidates[0] && body.candidates[0].content &&
     body.candidates[0].content.parts && body.candidates[0].content.parts[0] &&
     body.candidates[0].content.parts[0].text) || "[]";

  let rezepte;

  try {
    rezepte = JSON.parse(text);
  } catch (fehler) {
    // Falls das Modell doch nicht sauberes JSON liefert, Rohtext
    // trotzdem anzeigen statt nur einen Fehler zu werfen.
    return { rezepte: [{ titel: "Antwort konnte nicht als JSON gelesen werden", zubereitung: text, zusatzZutaten: [] }] };
  }

  if (!Array.isArray(rezepte) || rezepte.length === 0) {

    // Leere Antwort ohne erkennbaren Fehlercode - lieber Rohtext +
    // finishReason als Fehlermeldung zurückgeben, damit das direkt im
    // Menüplan-Overlay sichtbar ist statt nur ein stummes "keine
    // Vorschläge" (spart eine weitere Runde über den Skript-Editor).
    const finishReason = body.candidates && body.candidates[0] && body.candidates[0].finishReason;

    return {
      fehler: "Leere/unerwartete Antwort von Gemini (finishReason: " + finishReason +
        "). Rohtext: " + text.slice(0, 300) +
        " - meist ein einmaliger Ausrutscher, bitte nochmal versuchen."
    };

  }

  return { rezepte };

}

// Manueller Test im Skript-Editor: Funktion oben im Dropdown auswählen,
// "Ausführen" klicken, Ergebnis erscheint im Ausführungsprotokoll -
// kein Deploy nötig. Wird von doGet/doPost nicht aufgerufen, rein zur
// Fehlersuche.
function testMenuvorschlaege() {
  console.log(JSON.stringify(holeMenuvorschlaege()));
}

function testDaten() {

    const sheet = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Inventurdaten");

    sheet.appendRow([
        "Testort",
        "Testprodukt",
        "vorhanden",
        "ja",
        "Stk",
        "nur das nötigste",
        new Date()
    ]);

}
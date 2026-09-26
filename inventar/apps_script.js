function doGet() {

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

  if (payload.aktion === "menuvorschlaege") {
    return ContentService
      .createTextOutput(JSON.stringify(holeMenuvorschlaege()))
      .setMimeType(ContentService.MimeType.JSON);
  }

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
    PropertiesService.getScriptProperties().getProperty("ANTHROPIC_API_KEY");

  if (!apiKey) {
    return { fehler: "Kein Anthropic-API-Key hinterlegt (Script-Properties: ANTHROPIC_API_KEY fehlt)." };
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

  const antwort =
    UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post",
      contentType: "application/json",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      payload: JSON.stringify({
        model: "claude-sonnet-5", // günstigere Alternative: "claude-haiku-4-5-20251001"
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }]
      }),
      muteHttpExceptions: true
    });

  const status = antwort.getResponseCode();
  const body = JSON.parse(antwort.getContentText());

  if (status !== 200) {
    return { fehler: "Anthropic-API-Fehler (" + status + "): " + (body.error?.message || antwort.getContentText()) };
  }

  const text = (body.content && body.content[0] && body.content[0].text) || "[]";

  try {
    return { rezepte: JSON.parse(text) };
  } catch (fehler) {
    // Falls das Modell doch nicht sauberes JSON liefert, Rohtext
    // trotzdem anzeigen statt nur einen Fehler zu werfen.
    return { rezepte: [{ titel: "Antwort konnte nicht als JSON gelesen werden", zubereitung: text, zusatzZutaten: [] }] };
  }

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
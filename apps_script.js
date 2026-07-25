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
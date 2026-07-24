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
      einheit: daten[i][4]
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

  const payload = JSON.parse(e.postData.contents);
  const daten = payload.daten;

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName("Inventurdaten");

  daten.forEach(eintrag => {

    // Spalte D = Info
    sheet
      .getRange(eintrag.zeile, 4)
      .setValue(eintrag.wert);

    // Spalte F = Letzte Inventur (Datum + Uhrzeit)
    const zeitstempelZelle =
      sheet.getRange(eintrag.zeile, 6);

    zeitstempelZelle.setValue(new Date());
    zeitstempelZelle.setNumberFormat("dd.MM.yyyy HH:mm");

  });

  return ContentService.createTextOutput("POST OK");
}


function testDaten() {

    const sheet = SpreadsheetApp
        .getActiveSpreadsheet()
        .getSheetByName("Inventurdaten");

    sheet.appendRow([
        "test_" + new Date().getTime(),
        new Date(),
        "ja",
        "nein",
        2
    ]);

}


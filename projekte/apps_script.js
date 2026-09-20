// Nimmt Datei-Uploads für das Projekte-Modul entgegen und legt sie in
// Google Drive ab (ein Unterordner pro Projekt-ID unter "Cortasiell
// Projekte"). Wird komplett unabhängig vom Inventar-Apps-Script als
// eigenes Apps-Script-Projekt deployt (eigene Web-App-URL).

function doGet() {

    return ContentService.createTextOutput(
        "Cortasiell Projekte – Datei-Upload aktiv."
    );

}

function doPost(e) {

    const payload = JSON.parse(e.postData.contents);

    if (payload.aktion === "loeschen") {

        DriveApp.getFileById(payload.dateiId).setTrashed(true);

        return ContentService
            .createTextOutput(JSON.stringify({ ok: true }))
            .setMimeType(ContentService.MimeType.JSON);

    }

    const ordner = ordnerFuerProjekt(payload.projektId);

    const bytes = Utilities.base64Decode(payload.datenBase64);
    const blob = Utilities.newBlob(bytes, payload.mimeType, payload.dateiName);

    const datei = ordner.createFile(blob);
    datei.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return ContentService
        .createTextOutput(JSON.stringify({
            url: datei.getUrl(),
            dateiId: datei.getId(),
            dateiName: payload.dateiName
        }))
        .setMimeType(ContentService.MimeType.JSON);

}

function ordnerFuerProjekt(projektId) {

    const hauptordner = ordnerFinden(DriveApp.getRootFolder(), "Cortasiell Projekte")
        || DriveApp.getRootFolder().createFolder("Cortasiell Projekte");

    return ordnerFinden(hauptordner, projektId)
        || hauptordner.createFolder(projektId);

}

function ordnerFinden(elternOrdner, name) {

    const iterator = elternOrdner.getFoldersByName(name);
    return iterator.hasNext() ? iterator.next() : null;

}

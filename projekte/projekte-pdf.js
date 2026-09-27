/* ============================================================
   Projekte — PDF-Export einer einzelnen Projekt-Karte.

   Nutzt pdf-lib + @pdf-lib/fontkit (CDN, siehe <script>-Tags in
   index.html) sowie die echten Nudica-Schriftdateien in
   ../shared/fonts/nudica-{light,medium}.ttf (NICHT die woff/woff2 -
   die sind fürs Web-UI; pdf-lib/fontkit können daraus keine
   zuverlässig einbettbare Schrift erzeugen, manche PDF-Reader
   (z.B. poppler) lehnen das dann als ungültig ab. Die .ttf-Dateien
   sind eine reine Format-Konvertierung derselben Schrift, kein
   neuer Font). Bewusst OHNE Subsetting eingebettet (subset:true
   erzeugt mit diesen Schriften eine Einbettung, die manche
   PDF-Reader ablehnen).

   Eigenständig gehalten (keine Funktionen aus projekte.js
   verwendet) - das Projekt-Objekt wird komplett übergeben, damit
   die Skript-Ladereihenfolge keine Rolle spielt.
   ============================================================ */

const PDF_PAGE_WIDTH = 595.28; // A4 in pt
const PDF_PAGE_HEIGHT = 841.89;
const PDF_MARGIN = 50;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;

const SIZE_TITLE = 18;
const SIZE_HEAD = 11;
const SIZE_BODY = 10;
const SIZE_SMALL = 9;

const KOSTEN_COL_ANZAHL_X = PDF_PAGE_WIDTH - PDF_MARGIN - 230;
const KOSTEN_COL_PREIS_RIGHT = PDF_PAGE_WIDTH - PDF_MARGIN - 90;
const KOSTEN_COL_TOTAL_RIGHT = PDF_PAGE_WIDTH - PDF_MARGIN;

function pdfHexRgb(hex) {
  const n = parseInt(hex.replace("#", ""), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

let PDF_COLOR_TEXT, PDF_COLOR_MUTED, PDF_COLOR_BORDER;
function initPdfColors() {
  PDF_COLOR_TEXT = pdfHexRgb("#333333");
  PDF_COLOR_MUTED = pdfHexRgb("#888888");
  PDF_COLOR_BORDER = pdfHexRgb("#DDDDDD");
}

function chNumberPdf(n) {
  if (n === undefined || n === null || n === "") return "";
  const num = Number(n);
  if (isNaN(num)) return String(n);
  return (Math.round(num * 100) / 100).toLocaleString("de-CH");
}
function chFrPdf(n) {
  return `CHF ${chNumberPdf(n) || "0"}`;
}
function chDateShort(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr || "");
  if (!m) return "";
  return `${m[3]}.${m[2]}.${m[1]}`;
}

function wrapText(font, str, size, maxWidth) {
  const words = String(str).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  return lines.length ? lines : (current ? [current] : []);
}

function newPage(ctx) {
  ctx.page = ctx.pdfDoc.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  ctx.y = PDF_PAGE_HEIGHT - PDF_MARGIN;
}

function ensureSpace(ctx, height, onBreak) {
  if (ctx.y - height < PDF_MARGIN) {
    newPage(ctx);
    if (onBreak) onBreak();
    return true;
  }
  return false;
}

function drawText(ctx, str, x, y, { size = SIZE_BODY, font, color, align = "left" } = {}) {
  if (!str) return 0;
  const f = font || ctx.light;
  const c = color || PDF_COLOR_TEXT;
  const w = f.widthOfTextAtSize(str, size);
  const drawX = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
  ctx.page.drawText(str, { x: drawX, y, size, font: f, color: c });
  return w;
}

function drawRule(ctx, y, { x0 = PDF_MARGIN, x1 = PDF_PAGE_WIDTH - PDF_MARGIN, thickness = 0.75, color } = {}) {
  ctx.page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness, color: color || PDF_COLOR_BORDER });
}

function drawHeading(ctx, text) {
  ensureSpace(ctx, 30);
  ctx.y -= 12;
  drawText(ctx, text.toUpperCase(), PDF_MARGIN, ctx.y, { size: SIZE_SMALL, font: ctx.medium, color: PDF_COLOR_MUTED });
  ctx.y -= 12;
}

function drawTitelUndMeta(ctx, p) {

  drawText(ctx, p.titel || "", PDF_MARGIN, ctx.y, { size: SIZE_TITLE, font: ctx.medium });
  ctx.y -= 8;
  drawRule(ctx, ctx.y, { thickness: 1 });
  ctx.y -= 20;

  const zeitspanne = (p.startDatum && p.endDatum)
    ? `${chDateShort(p.startDatum)} – ${chDateShort(p.endDatum)}`
    : "";

  const meta = [
    p.status && `Status: ${p.status}`,
    p.verantwortlich && `Verantwortlich: ${p.verantwortlich}`,
    p.anzahlPersonen ? `Personen: ${p.anzahlPersonen}` : null,
    p.dauerTage ? `Dauer: ${p.dauerTage} Tage` : null,
    zeitspanne && `Zeitspanne: ${zeitspanne}`
  ].filter(Boolean);

  let x = PDF_MARGIN;
  meta.forEach(stueck => {
    const w = drawText(ctx, stueck, x, ctx.y, { size: SIZE_SMALL, font: ctx.light, color: PDF_COLOR_MUTED });
    x += w + 22;
  });

  if (meta.length) {
    ctx.y -= 20;
  }

}

function drawBeschreibung(ctx, p) {

  if (!p.beschreibung || !p.beschreibung.trim()) {
    return;
  }

  drawHeading(ctx, "Beschreibung");

  p.beschreibung.split("\n").forEach(raw => {
    if (!raw.trim()) {
      ctx.y -= 8;
      return;
    }
    wrapText(ctx.light, raw, SIZE_BODY, PDF_CONTENT_WIDTH).forEach(line => {
      ensureSpace(ctx, 14);
      drawText(ctx, line, PDF_MARGIN, ctx.y, { size: SIZE_BODY, font: ctx.light });
      ctx.y -= 14;
    });
  });

}

function drawCheckliste(ctx, p) {

  const punkte = (p.checkliste || []).filter(c => c.text && c.text.trim());
  if (!punkte.length) {
    return;
  }

  drawHeading(ctx, "Abklärungen");

  punkte.forEach(c => {
    // "☐"/"☑" statt "[ ]"/"[x]": die eingebettete Nudica-Schrift hat für
    // diese Symbole keine echten Glyphen (fällt lautlos auf eine leere
    // Ersatzglyphe zurück - pdf-lib wirft dabei keinen Fehler, das Kästchen
    // bleibt im PDF einfach unsichtbar), Klammern/Buchstaben sind dagegen
    // in jeder lateinischen Schrift sicher vorhanden.
    const zeichen = c.erledigt ? "[x]" : "[ ]";
    wrapText(ctx.light, `${zeichen}  ${c.text}`, SIZE_BODY, PDF_CONTENT_WIDTH).forEach(line => {
      ensureSpace(ctx, 15);
      drawText(ctx, line, PDF_MARGIN, ctx.y, { size: SIZE_BODY, font: ctx.light });
      ctx.y -= 15;
    });
  });

}

function kostenpositionZeileTotal(pos) {
  const anzahl = Number(pos.anzahl);
  return anzahl > 0 ? anzahl * (Number(pos.chfProAnzahl) || 0) : Number(pos.chfTotal) || 0;
}

function drawKostenSpaltenkopf(ctx) {
  drawText(ctx, "Position", PDF_MARGIN, ctx.y, { size: SIZE_SMALL, font: ctx.light, color: PDF_COLOR_MUTED });
  drawText(ctx, "Anzahl", KOSTEN_COL_ANZAHL_X, ctx.y, { size: SIZE_SMALL, font: ctx.light, color: PDF_COLOR_MUTED, align: "right" });
  drawText(ctx, "CHF/Einheit", KOSTEN_COL_PREIS_RIGHT, ctx.y, { size: SIZE_SMALL, font: ctx.light, color: PDF_COLOR_MUTED, align: "right" });
  drawText(ctx, "CHF total", KOSTEN_COL_TOTAL_RIGHT, ctx.y, { size: SIZE_SMALL, font: ctx.light, color: PDF_COLOR_MUTED, align: "right" });
  ctx.y -= 6;
  drawRule(ctx, ctx.y);
  ctx.y -= 15;
}

function drawKosten(ctx, p) {

  const zeilen = (p.kostenpositionen || []).filter(k => k.position && k.position.trim());
  if (!zeilen.length) {
    return;
  }

  drawHeading(ctx, "Kosten");
  ensureSpace(ctx, 30, () => drawKostenSpaltenkopf(ctx));
  drawKostenSpaltenkopf(ctx);

  zeilen.forEach(k => {

    ensureSpace(ctx, 16, () => drawKostenSpaltenkopf(ctx));

    drawText(ctx, k.position, PDF_MARGIN, ctx.y, { size: SIZE_BODY, font: ctx.light });
    if (Number(k.anzahl) > 0) {
      drawText(ctx, chNumberPdf(k.anzahl), KOSTEN_COL_ANZAHL_X, ctx.y, { size: SIZE_BODY, font: ctx.light, align: "right" });
    }
    if (k.chfProAnzahl) {
      drawText(ctx, chFrPdf(k.chfProAnzahl), KOSTEN_COL_PREIS_RIGHT, ctx.y, { size: SIZE_BODY, font: ctx.light, align: "right" });
    }
    drawText(ctx, chFrPdf(kostenpositionZeileTotal(k)), KOSTEN_COL_TOTAL_RIGHT, ctx.y, { size: SIZE_BODY, font: ctx.light, align: "right" });
    ctx.y -= 16;

  });

  ensureSpace(ctx, 22);
  ctx.y -= 2;
  drawRule(ctx, ctx.y, { x0: KOSTEN_COL_ANZAHL_X - 10, thickness: 1 });
  ctx.y -= 15;
  drawText(ctx, "Total", KOSTEN_COL_PREIS_RIGHT, ctx.y, { size: SIZE_BODY, font: ctx.medium, align: "right" });
  drawText(ctx, chFrPdf(p.kosten), KOSTEN_COL_TOTAL_RIGHT, ctx.y, { size: SIZE_BODY, font: ctx.medium, align: "right" });
  ctx.y -= 18;

}

function drawWeblinks(ctx, p) {

  const links = (p.weblinks || []).filter(w => w.label && w.url);
  if (!links.length) {
    return;
  }

  drawHeading(ctx, "Weblinks");

  links.forEach(w => {
    ensureSpace(ctx, 15);
    drawText(ctx, `${w.label}: ${w.url}`, PDF_MARGIN, ctx.y, { size: SIZE_BODY, font: ctx.light });
    ctx.y -= 15;
  });

}

function pdfFilename(projekt) {
  const base = (projekt.titel || "Projekt").trim();
  return base.replace(/[\\/:*?"<>|]/g, "") + " - Projekt.pdf";
}

function downloadPdfBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function exportProjektPdf(projekt) {

  if (typeof PDFLib === "undefined" || typeof fontkit === "undefined") {
    throw new Error("PDF-Bibliothek nicht verfügbar (fürs erste Mal wird eine Internetverbindung gebraucht).");
  }

  initPdfColors();

  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const [lightBytes, mediumBytes] = await Promise.all([
    fetch("../shared/fonts/nudica-light.ttf").then(r => {
      if (!r.ok) throw new Error("Schriftdatei nudica-light.ttf konnte nicht geladen werden");
      return r.arrayBuffer();
    }),
    fetch("../shared/fonts/nudica-medium.ttf").then(r => {
      if (!r.ok) throw new Error("Schriftdatei nudica-medium.ttf konnte nicht geladen werden");
      return r.arrayBuffer();
    })
  ]);

  const ctx = {
    pdfDoc,
    light: await pdfDoc.embedFont(lightBytes, { subset: false }),
    medium: await pdfDoc.embedFont(mediumBytes, { subset: false }),
    page: null,
    y: 0
  };

  newPage(ctx);

  drawTitelUndMeta(ctx, projekt);
  drawBeschreibung(ctx, projekt);
  drawCheckliste(ctx, projekt);
  drawKosten(ctx, projekt);
  drawWeblinks(ctx, projekt);

  const bytes = await pdfDoc.save();
  downloadPdfBytes(bytes, pdfFilename(projekt));

}

// Verschieben von Listen-/Karten-Elementen per Ziehen am Griff - per Maus
// ODER Touch. Nutzt Pointer Events statt der nativen HTML5-Drag&Drop-API:
// die funktioniert auf dem Handy nicht zuverlässig (iOS Safari feuert z.B.
// gar kein "dragstart" bei einer Touch-Berührung), Pointer Events fassen
// Maus/Touch/Stift dagegen einheitlich zusammen.
//
// Ein Klon (siehe .ziehen-klon in shared/theme.css) folgt dem Finger/
// Mauszeiger - das übernimmt die Rolle, die bei der nativen API das
// automatische "Drag-Bild" gespielt hat. Das echte Element bleibt
// währenddessen (abgeblendet über .dragging) in der Liste und wird dort
// live an die Zielposition einsortiert.
//
// container: das Eltern-Element, in dem verschoben werden darf (Klicks
//   ausserhalb bzw. auf andere Elemente werden ignoriert).
// itemSelector: Selektor für ein verschiebbares Element (braucht ein
//   data-id-Attribut).
// griffSelector: Selektor für den Ziehgriff innerhalb eines Elements -
//   nur ein Pointerdown, der hier startet, löst das Verschieben aus.
// onDrop(neueReihenfolgeIds): wird beim Loslassen mit der Reihenfolge der
//   data-id-Attribute aller Elemente im Container aufgerufen.
// Gibt ein Objekt mit istAktiv() zurück - damit ein laufender Realtime-
// Listener (onSnapshot) das Neu-Rendern der Liste currenteilweise
// zurückstellen kann, solange gerade verschoben wird. Sonst würde ein
// Snapshot-Update, das zufällig genau während einer Ziehgeste eintrifft,
// die DOM-Elemente unter dem Zeiger per innerHTML-Ersetzung zerstören und
// die Geste abbrechen (kam in der Praxis vor, siehe Kommentar oben).
export function verschiebbarMachen({ container, itemSelector, griffSelector, onDrop }) {

    let ziehElement = null;
    let klon = null;
    let offsetX = 0;
    let offsetY = 0;

    function elemente() {
        return [...container.querySelectorAll(itemSelector)];
    }

    function zeigerRunter(event) {

        if (event.pointerType === "mouse" && event.button !== 0) {
            return; // nur linke Maustaste
        }

        const griff = event.target.closest(griffSelector);
        if (!griff || !container.contains(griff)) {
            return;
        }

        const item = griff.closest(itemSelector);
        if (!item) {
            return;
        }

        event.preventDefault();

        ziehElement = item;
        const rect = item.getBoundingClientRect();
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;

        klon = item.cloneNode(true);
        klon.classList.add("ziehen-klon");
        Object.assign(klon.style, {
            position: "fixed",
            left: rect.left + "px",
            top: rect.top + "px",
            width: rect.width + "px",
            margin: "0",
            pointerEvents: "none",
            zIndex: "9999"
        });
        document.body.appendChild(klon);

        item.classList.add("dragging");

        document.addEventListener("pointermove", zeigerBewegt);
        document.addEventListener("pointerup", zeigerLosgelassen, { once: true });
        document.addEventListener("pointercancel", zeigerLosgelassen, { once: true });

    }

    function zeigerBewegt(event) {

        if (!ziehElement) {
            return;
        }

        klon.style.left = (event.clientX - offsetX) + "px";
        klon.style.top = (event.clientY - offsetY) + "px";

        const geschwister = elemente().filter(el => el !== ziehElement);

        for (const el of geschwister) {
            const rect = el.getBoundingClientRect();
            const mitte = rect.top + rect.height / 2;
            if (event.clientY < mitte) {
                el.before(ziehElement);
                return;
            }
        }

        container.appendChild(ziehElement); // unter allen anderen -> ans Ende

    }

    function zeigerLosgelassen() {

        document.removeEventListener("pointermove", zeigerBewegt);

        klon?.remove();
        klon = null;

        if (!ziehElement) {
            return;
        }

        ziehElement.classList.remove("dragging");
        const neueReihenfolge = elemente().map(el => el.dataset.id);
        ziehElement = null;

        onDrop(neueReihenfolge);

    }

    container.addEventListener("pointerdown", zeigerRunter);

    return {
        istAktiv: () => ziehElement !== null
    };

}

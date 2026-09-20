// Zentrale Firebase-Konfiguration – nur an dieser einen Stelle eintragen.
//
// Werte kommen aus der Firebase-Konsole:
// Projektübersicht -> Web-App hinzufügen (</>) -> "firebaseConfig".
// Der apiKey ist bei Firebase kein Geheimnis (identifiziert nur das
// Projekt), er darf bedenkenlos im Repo liegen. Die eigentliche
// Absicherung passiert über die Firestore-Regeln (siehe README/Plan).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyD1abE2XeyYAtiXLlJLQTk5SguahWJJ8xE",
    authDomain: "cortasiell-app.firebaseapp.com",
    projectId: "cortasiell-app",
    storageBucket: "cortasiell-app.firebasestorage.app",
    messagingSenderId: "1031402195324",
    appId: "1:1031402195324:web:bcefec67ff2c711ea5bcf9"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);

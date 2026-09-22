// Zentrale Firebase-Konfiguration – identisch zu kalender/firebase-config.js,
// da beide Module dasselbe Firebase-Projekt nutzen. Nur an dieser einen
// Stelle eintragen, falls sich Werte ändern.
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

# ⌨️ Macro Pad Manager (Windows Desktop App)

[![Electron](https://img.shields.io/badge/Electron-34.x-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.x-61DAFB?logo=react&logoColor=black)](https://reactjs.org/)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?logo=windows&logoColor=white)](https://microsoft.com)

Un'applicazione Desktop moderna, reattiva e modulare per Windows progettata per gestire tastierini fisici e macro pad custom (Arduino, RP2040, ATmega32u4). Consente di mappare visivamente i tasti a qualsiasi combinazione di tastiera, caratteri speciali, macro, applicazioni, comandi PowerShell, script WSL Linux o link web.

---

## 🚀 Caratteristiche Principali

- **Background Service nella System Tray**: L'applicazione rimane attiva in background nella barra delle applicazioni di Windows anche chiudendo la finestra, intercettando i tasti del tastierino in qualsiasi momento.
- **Sistema di Profili / Template Multipli**: Crea, duplica, rinomina e passa al volo da un profilo all'altro (es. *Standard*, *Gaming*, *Coding & Dev*, *Video Editing*). Puoi cambiare profilo attivo anche dal menu contestuale della System Tray!
- **Abilitazione / Disabilitazione Singoli Tasti**: Interruttore rapido per ogni tasto. Se disabilitato, il backend ignora la pressione fisica del tasto senza eseguire azioni.
- **Riordinamento Tasti con Drag & Drop**: Trascina e riorganizza le card dei tasti nella griglia per rispecchiare la disposizione fisica del tuo tastierino. L'ordine viene salvato automaticamente.
- **Emulazione Tastiera Nativa Win32 (Latenza Zero)**: Utility nativa C# compilata (`tools/keySender.exe`) che sfrutta le API `SendInput` di Windows per emulare istantaneamente scorciatoie e digitare caratteri Unicode.
- **Auto-Save Continuo**: Qualsiasi modifica ai tasti, azioni, etichette, ordine o profili viene salvata automaticamente in tempo reale su `config.json`.
- **Feedback Hardware in Tempo Reale**: Quando premi un tasto fisico, la card corrispondente si illumina a schermo e l'evento viene registrato nella barra di stato.
- **Pulsante "Testa Azione Ora"**: Verifica istantaneamente qualsiasi comando o scorciatoia direttamente dall'interfaccia senza dover toccare l'hardware.
- **Supporto Ibrido (Electron IPC + HTTP Bridge)**: Funziona al 100% sia come applicazione nativa Electron sia se aperta nel browser web su `localhost:5173` tramite bridge HTTP e Server-Sent Events (SSE).

---

## 🎯 Azioni Supportate

| Tipo | Icona | Descrizione ed Esempi |
|---|---|---|
| **`KEY`** | ⌨️ | Emula tasti e scorciatoie di sistema (es. `Ctrl+C`, `Ctrl+V`, `Win+D`, `Alt+Tab`, `F1-F24`, `Volume_Up`, `Media_Play_Pause`, `Enter`, `Esc`). Include chip di selezione rapida. |
| **`TEXT`** | ✍️ | Digita automaticamente caratteri speciali (es. `~`, `€`, `@`, `#`, `\`, `{`, `}`) o intere stringhe e testi (email, password, snippet di codice). |
| **`MACRO`** | ⚙️ | Esegue sequenze di tasti e testi con intervalli di ritardo configurabili (es. `KEY:CTRL+A; DELAY:100; KEY:BACKSPACE; TEXT:Test; KEY:ENTER`). |
| **`APP`** | 🚀 | Avvia un file eseguibile `.exe` o comando di sistema in modo asincrono (es. `calc.exe`, `notepad.exe`, `"C:\Program Files\...\app.exe"`). |
| **`POWERSHELL`** | ⚡ | Esegue comandi o script PowerShell bypassando le policy di esecuzione (`-ExecutionPolicy Bypass`). |
| **`BASH`** | 🐧 | Esegue comandi nativi Linux all'interno del sottosistema WSL (`wsl.exe bash -c "..."`). |
| **`URL`** | 🌐 | Apre l'indirizzo web specificato nel browser predefinito di Windows. |

---

## 🔌 Configurazione Hardware (Arduino UNO R3)

L'applicazione comunica attualmente tramite porta seriale (COM) a **9600 baud**.

### Schema di Collegamento
1. Collega un capo del pulsante al **Pin Digitale 2** di Arduino.
2. Collega l'altro capo del pulsante al pin **GND** di Arduino.
*(Grazie alla resistenza di pull-up interna abilitata nel firmware, non sono necessarie resistenze esterne).*

### Firmware Arduino
Il codice sorgente completo è disponibile in [`firmware/arduino_uno/arduino_uno.ino`](firmware/arduino_uno/arduino_uno.ino).
Quando il pulsante viene premuto, Arduino invia sulla seriale la stringa `BTN_1_PRESSED`.

---

## 🔮 Roadmap: Fase 2 (USB Raw HID)

L'architettura include la classe astratta [`BaseHardwareListener`](src/main/hardware/BaseHardwareListener.js) e il modulo [`HidHardwareListener`](src/main/hardware/HidHardwareListener.js) già predisposto per microcontrollori **RP2040** o **ATmega32u4**:
1. Installare il driver: `npm install node-hid`
2. In `src/main/main.js`, istanziare `HidHardwareListener` al posto di `SerialHardwareListener`.
Tutte le logiche dell'applicazione (ActionDispatcher, profili, tray, UI) rimangono invariate.

---

## 📁 Struttura del Progetto

```text
├── package.json                         # Configurazione npm, dipendenze e script
├── vite.config.js                       # Configurazione build Vite per React (base './')
├── index.html                           # Entry point HTML dell'app
├── config.json                          # Configurazione attiva locale (profili, tasti, porta COM)
├── config.example.json                  # Template di configurazione pulito per repository Git
├── .gitignore                           # Esclusioni per Git (node_modules, dist, log)
├── assets/
│   └── tray-icon.png                    # Icona per la System Tray di Windows
├── firmware/
│   └── arduino_uno/
│       └── arduino_uno.ino              # Sketch C++ per Arduino UNO R3 (debounce + seriale)
├── tools/
│   ├── keySender.cs                     # Sorgente C# per simulazione SendInput Win32 ad alta velocità
│   └── keySender.exe                    # Eseguibile compilato nativo Win32
├── scripts/
│   └── build-tools.bat                  # Script batch per ricompilare keySender.exe con csc.exe
├── src/
│   ├── main/
│   │   ├── main.js                      # Electron Main Process: Tray, finestra, IPC e bridge HTTP
│   │   ├── preload.js                   # Bridge sicuro (contextBridge) tra Electron e React
│   │   ├── ConfigManager.js             # Gestore lettura/salvataggio/migrazione profili
│   │   ├── ActionDispatcher.js          # Motore di esecuzione comandi (KEY, TEXT, MACRO, APP, PS, WSL)
│   │   └── hardware/
│   │       ├── BaseHardwareListener.js   # Interfaccia comune EventEmitter
│   │       ├── SerialHardwareListener.js # FASE 1: Porta Seriale (Arduino a 9600 baud)
│   │       └── HidHardwareListener.js    # FASE 2: USB Raw HID a 64 byte (RP2040/ATmega32u4)
│   └── renderer/
│       └── src/
│           ├── App.jsx                  # UI React: Profili, Drag & Drop, editor tasti e test
│           ├── App.css                  # Stili Dark Theme per tastierino macro pad
│           └── main.jsx                 # Mount dell'applicazione React
```

---

## 💻 Installazione e Avvio

### Prerequisiti
- **Node.js** (versione 18 o superiore) e **npm**
- **Sistema Operativo Windows** (10 o 11)
- **Arduino IDE** (per caricare lo sketch su Arduino UNO)

### 1. Installazione Dipendenze
```powershell
npm install
```

### 2. Ricompilazione Strumenti Nativi (Opzionale)
L'eseguibile `tools/keySender.exe` è già incluso. Se desideri ricompilarlo dal sorgente C# usando il compilatore integrato di Windows (`csc.exe`):
```powershell
npm run build:tools
```

### 3. Avvio in Modalità Sviluppo (Consigliato)
Avvia contemporaneamente Vite con Hot Reload e la finestra Desktop Electron:
```powershell
npm run dev
```

### 4. Compilazione e Avvio in Produzione
```powershell
npm run build
npm start
```

---


## 📄 Licenza

Questo progetto è rilasciato sotto licenza MIT.

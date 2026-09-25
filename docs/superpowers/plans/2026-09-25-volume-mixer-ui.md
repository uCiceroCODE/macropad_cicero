# Volume Mixer UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere nell'app un Volume Mixer funzionante: lista delle sessioni audio di Windows con volume e mute per app, navigabile e regolabile con l'encoder rotativo KY-040, senza più rompere la selezione per nomi lunghi o duplicati.

**Architecture:** `serialHandler.js` diventa il proprietario dello stato mixer (device, snapshot, dispatch comandi, output seriale) ed espone un `EventEmitter`; `main.js` fa da bridge verso Electron IPC e SSE; `preload.js` espone l'API sicura; il renderer aggiunge una vista `MixerPane`. Il protocollo seriale diventa index-based: l'Arduino non trasporta più i nomi delle app, che sono lunghi fino a 100+ caratteri, contengono `|`, `:` e caratteri non-ASCII, e vengono letti solo dal main process e mostrati nella UI.

**Tech Stack:** Electron 34, React 18, Vite 6, `native-sound-mixer@3.4.6-win` (addon N-API, verificato caricabile sotto Electron ABI 132 / N-API 9), `serialport` 13, Arduino UNO R3 C++.

## Global Constraints

- Arduino UNO R3 (ATmega328P, 2 KB SRAM), seriale a 9600 baud, una messaggio per riga terminato da `\n`.
- L'OLED/SSD1306 resta commentato nel firmware. Non riattivarlo in questo piano.
- `CMD:MASTER_VOL_UP` / `CMD:MASTER_VOL_DOWN` restano invariati e fuori ambito: non implementare handler per loro, non rimuoverli dal firmware.
- Protocollo index-based: le app sono identificate solo da indice. Nessun nome app attraversa il link seriale.
- Delimitatore `:` splittato solo sui primi due due punti del messaggio, mai con `strtok`, per non rompere su contenuto.
- Step di volume 5%, volume nativo `0.0`-`1.0`, percentuale `0`-`100`.
- Etichetta di una sessione: `name`, altrimenti il nome del file eseguibile ricavato da `appName`, altrimenti `Sessione #N`.
- Non filtrare le sessioni per `state`: sessioni `INACTIVE` hanno comunque volume reale da controllare.
- Nessuna nuova dipendenza npm. Nessun comando di lint o typecheck: le verifiche sono `node test/*.js` e `npm run build:react`.
- Non aggiungere commenti nel codice scritto.
- Ogni task termina con un commit. Il Task 0 include il push obbligatorio su `origin/main` prima di modificare il codice.

## Dati reali rilevati sulla macchina di sviluppo

Rilevati con `SoundMixer.getDefaultDevice(DeviceType.RENDER).sessions`, da usare come fixture di riferimento nei test:

- 7 sessioni, di cui 3 con `name` stringa vuota e `appName` vuoto.
- 2 sessioni con lo stesso identico `name` `"Discord"` e lo stesso `appName` (`Discord.exe`): gli omonimi non sono distinguibili per nome, quindi l'indice è l'unica identità valida.
- 1 sessione con nome di oltre 100 caratteri, contenente `|` e caratteri giapponesi: `桜日和とタイムマシン with 初音ミク - Sakura Biyori and Time Machine with Hatsune Miku | YouTube Music — Mozilla Firefox`.
- `AudioSession` espone `name`, `appName`, `volume`, `mute` (booleano), `state` (`INACTIVE=0`, `ACTIVE=1`, `EXPIRED=2`).
- Il modulo espone `SoundMixer.devices` con 5 dispositivi; `getDefaultDevice(RENDER)` restituisce le cuffie Logitech.

---

## File Structure

| File | Ruolo |
|---|---|
| `src/main/serialHandler.js` | Proprietario dello stato mixer: accesso al device, snapshot, dispatch dei comandi, output seriale, `EventEmitter`. Non possiede più la `SerialPort`. |
| `src/main/main.js` | Crea l'handler con dependency injection, inoltra `state` su IPC e SSE, registra handler `mixer:*` e endpoint HTTP `/api/mixer*`. |
| `src/main/preload.js` | Espone `mixerGetState`, `mixerSetVolume`, `mixerSetMute`, `mixerRefresh`, `onMixerState`. |
| `src/renderer/src/component/MixerPane.jsx` | Nuovo. Vista della lista sessioni: etichetta, slider, percentuale, mute, riga selezionata. |
| `src/renderer/src/App.jsx` | Metodi mixer in entrambi gli API client, stato mixer, switch di vista Keypad/Mixer, montaggio di `MixerPane`. |
| `src/renderer/src/App.css` | Stili di `MixerPane` usando le variabili CSS già presenti. |
| `firmware/arduino_uno/arduino_uno.ino` | Protocollo v2, 4 variabili scalari al posto della tabella dei nomi, niente dump del menu, debounce sul push. |
| `test/mixer-test.js` | Test TDD di `serialHandler` con device finto e `sendLine` finto. |
| `test/mixer-protocol-test.js` | Nuovo. Contratto del protocollo: parsing dei messaggi PC→MCU e stringhe attese dal firmware. |
| `test/mixer-interactive.js` | Strumento CLI manuale, aggiornato al protocollo v2. |
| `README.md` | Sezione Volume Mixer, tabella protocollo, interazione encoder, schema hardware corretto. |
| `package.json` | Script `test`. |

## Protocolo v2

MCU→PC, cinque comandi:

```text
CMD:GET_MIXER_APPS
CMD:SELECT_APP:<index>
CMD:VOL_UP
CMD:VOL_DOWN
CMD:EXIT_MIXER
```

PC→MCU, cinque messaggi:

```text
MIXER_LIST:<count>
MIXER_SELECTED:<index>:<pct>:<mute>
MIXER_STATE:<index>:<pct>:<mute>
MIXER_EXIT
MIXER_ERR:<CODE>
```

Codici errore: `NO_DEVICE`, `NO_SELECTION`, `NOT_FOUND`, `GET_FAILED`, `SELECT_FAILED`, `VOL_FAILED`, `MIXER_UNAVAILABLE`. `<mute>` è `0` o `1`.

Variabili di stato sul firmware, in sostituzione di `char mixerApps[5][16]`:

```cpp
uint8_t mixerAppCount = 0;
int8_t selectedIndex = 0;
uint8_t selectedPct = 0;
bool selectedMute = false;
```

`MIXER_APP:<i>:<nome>` verrà reintrodotto solo al riattivamento dell'OLED, per disporre del nome della sola app selezionata.

## Interfacce

```js
// src/main/serialHandler.js
createMixerHandler({ getDevice, sendLine, step = 0.05, maxApps = 16 })
// -> {
//      handleCommand(cmd): Promise<void>,
//      getState(): Snapshot,
//      setVolume(index, pct): Snapshot,
//      setMute(index, mute): Snapshot,
//      refresh(): Snapshot,
//      on(event, cb): () => void
//    }

Snapshot = {
  available: boolean,
  error: string | null,
  deviceName: string | null,
  selectedIndex: number,
  apps: [{ index: number, label: string, name: string, pct: number, mute: boolean, active: boolean }]
}
```

`active` è `state === 1`. L'handler emette `state` a ogni mutazione e `getState()` non ha effetti collaterali.

---

### Task 0: Checkpoint Git prima di toccare il codice

**Files:**
- Commit: `README.md`, `src/renderer/src/App.jsx`, `src/renderer/src/component/` (lavoro pendente dell'utente, non ancora committato)
- Commit: `docs/superpowers/plans/2026-09-25-volume-mixer-ui.md` (questo piano)

**Interfaces:**
- Produce: working tree pulito e `origin/main` allineato a `HEAD`, così ogni task successivo parte da un punto di ripristino remoto.

- [ ] **Step 1: ispezionare il lavoro pendente**

```bash
git status --short --branch
git diff --stat
git diff -- README.md src/renderer/src/App.jsx
```

Expected: `M README.md`, `M src/renderer/src/App.jsx`, `?? src/renderer/src/component/`, branch `main...origin/main` senza ahead/behind. Se i file pendenti contengono segreti o path locali, escluderli e segnalarlo all'utente prima di continuare.

- [ ] **Step 2: committare il refactor dei componenti**

```bash
git add README.md src/renderer/src/App.jsx src/renderer/src/component/
git commit -m "chore: extract renderer components and update README"
```

- [ ] **Step 3: committare il piano**

```bash
git add docs/superpowers/plans/2026-09-25-volume-mixer-ui.md
git commit -m "docs: add volume mixer implementation plan"
```

- [ ] **Step 4: push del checkpoint**

```bash
git push origin main
```

Expected: push riuscito su `https://github.com/uCiceroCODE/macropad_cicero.git`.

- [ ] **Step 5: verificare il checkpoint**

```bash
git status --short --branch
git log --oneline -3
git rev-parse HEAD origin/main
```

Expected: working tree pulito, gli ultimi due commit sono quelli appena creati, `HEAD` e `origin/main` hanno lo stesso hash.

---

### Task 1: Core dello stato mixer in serialHandler.js

**Files:**
- Modify: `src/main/serialHandler.js` (riscrittura completa, da 164 righe a circa 110)
- Modify: `package.json:6-14` (aggiungere lo script `test`)
- Test: `test/mixer-test.js` (riscrittura completa)

**Interfaces:**
- Consumes: nessuno.
- Produces: `createMixerHandler(options)` con la firma sopra; `Snapshot` con la forma sopra; `handleCommand`, `getState`, `refresh` funzionanti per `CMD:GET_MIXER_APPS`; export `{ createMixerHandler }`.

- [ ] **Step 1: scrivere il test fallito**

Sostituire il contenuto di `test/mixer-test.js` con:

```js
const assert = require('assert');
const { createMixerHandler } = require('../src/main/serialHandler');

function fakeSession(name, volume, mute = false, appName = '', state = 1) {
  return { name, appName, state, volume, mute };
}

function setup(sessions, options = {}) {
  const sent = [];
  const states = [];
  const handler = createMixerHandler({
    getDevice: () => ({ name: 'Cuffie Test', sessions }),
    sendLine: (line) => sent.push(line),
    ...options
  });
  handler.on('state', (snapshot) => states.push(snapshot));
  return { handler, sent, states };
}

async function run() {
  const longName = '桜日和とタイムマシン with 初音ミク - Sakura Biyori | YouTube Music — Mozilla Firefox';
  const { handler, sent } = setup([
    fakeSession('', 1),
    fakeSession('DCv2', 0.5, false, 'C:\\Program Files\\DCv2\\DCv2.exe'),
    fakeSession('', 0.25, false, '', 0),
    fakeSession(longName, 0.45),
    fakeSession('Discord', 0.25, false, 'C:\\Users\\demo\\AppData\\Local\\Discord\\Discord.exe', 0),
    fakeSession('Discord', 0.75, false, 'C:\\Users\\demo\\AppData\\Local\\Discord\\Discord.exe', 0)
  ]);

  await handler.handleCommand('CMD:GET_MIXER_APPS');

  const state = handler.getState();
  assert.strictEqual(state.available, true, 'il device finto deve risultare disponibile');
  assert.strictEqual(state.deviceName, 'Cuffie Test');
  assert.strictEqual(state.selectedIndex, -1, 'nessuna selezione prima di CMD:SELECT_APP');
  assert.strictEqual(state.apps.length, 6, 'tutte le sessioni, incluse quelle senza nome');
  assert.strictEqual(state.apps[0].label, 'Sessione #1');
  assert.strictEqual(state.apps[1].label, 'DCv2', 'fallback su appName quando il nome e vuoto');
  assert.strictEqual(state.apps[2].label, 'Sessione #3', 'appName vuota genera Sessione #N');
  assert.strictEqual(state.apps[3].label, longName, 'il nome lungo deve arrivare intatto');
  assert.strictEqual(state.apps[4].pct, 25);
  assert.strictEqual(state.apps[5].pct, 75, 'i due Discord devono restare distinti');
  assert.deepStrictEqual(
    state.apps.map((a) => a.index),
    [0, 1, 2, 3, 4, 5],
    'indici sequenziali'
  );
  assert.strictEqual(state.apps[4].active, false, 'sessione INACTIVE resta in lista');

  assert.strictEqual(sent[0], 'MIXER_LIST:6', 'solo il conteggio attraversa la seriale');
  assert.strictEqual(
    sent.filter((l) => l.includes(longName)).length,
    0,
    'nessun nome app attraversa la seriale'
  );
  assert.strictEqual(sent.filter((l) => l.includes('|')).length, 0, 'nessun separatore ambiguo');

  const unavailable = setup([], { getDevice: () => null });
  await unavailable.handler.handleCommand('CMD:GET_MIXER_APPS');
  const down = unavailable.handler.getState();
  assert.strictEqual(down.available, false);
  assert.strictEqual(down.error, 'NO_DEVICE');
  assert.deepStrictEqual(down.apps, []);
  assert.ok(unavailable.sent.includes('MIXER_ERR:NO_DEVICE'));

  console.log('mixer-test: 9 assertions OK');
}

run().catch((err) => {
  console.error('mixer-test FAILED:', err.message);
  process.exit(1);
});
```

- [ ] **Step 2: eseguire il test per vedere che fallisce**

Run: `node test/mixer-test.js`
Expected: FAILED con `Cannot find module '../src/main/serialHandler'` oppure `createMixerHandler is not a function`.

- [ ] **Step 3: implementare il modulo**

Sostituire il contenuto di `src/main/serialHandler.js` con:

```js
const { EventEmitter } = require('events');

let SoundMixer = null;
let DeviceType = null;
try {
  const nativeMixer = require('native-sound-mixer');
  SoundMixer = nativeMixer.default || nativeMixer.SoundMixer || nativeMixer;
  DeviceType = nativeMixer.DeviceType;
} catch (err) {
  console.warn('[MixerHandler] native-sound-mixer non disponibile:', err.message);
}

function defaultGetDevice() {
  if (!SoundMixer || !DeviceType) {
    throw new Error('MIXER_UNAVAILABLE');
  }
  return SoundMixer.getDefaultDevice(DeviceType.RENDER);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function labelFor(session, index) {
  const name = typeof session.name === 'string' ? session.name.trim() : '';
  if (name) {
    return name;
  }
  const appName = typeof session.appName === 'string' ? session.appName.trim() : '';
  if (appName) {
    const file = appName.split(/[\\/]/).pop();
    return file ? file.replace(/\.exe$/i, '') : '';
  }
  return `Sessione #${index + 1}`;
}

function createMixerHandler({ getDevice = defaultGetDevice, sendLine = () => {}, step = 0.05, maxApps = 16 } = {}) {
  const emitter = new EventEmitter();
  let device = null;
  let sessions = [];
  let apps = [];
  let selectedIndex = -1;
  let error = null;
  let available = true;

  const snapshot = () => ({
    available,
    error,
    deviceName: device ? device.name : null,
    selectedIndex,
    apps: apps.map((app) => ({ ...app }))
  });

  const emit = () => {
    emitter.emit('state', snapshot());
    return snapshot();
  };

  const send = (line) => {
    try {
      sendLine(line);
    } catch (err) {
      console.error('[MixerHandler] invio seriale fallito:', err.message);
    }
  };

  const normalize = (session, index) => {
    const volume = typeof session.volume === 'number' && Number.isFinite(session.volume) ? session.volume : 0;
    const name = typeof session.name === 'string' ? session.name.trim() : '';
    return {
      index,
      name,
      label: labelFor(session, index),
      pct: Math.round(clamp(volume, 0, 1) * 100),
      mute: session.mute === true,
      active: session.state === 1
    };
  };

  const refresh = () => {
    try {
      device = getDevice() || null;
    } catch (err) {
      device = null;
      available = false;
      error = err.message === 'MIXER_UNAVAILABLE' ? 'MIXER_UNAVAILABLE' : 'GET_FAILED';
      sessions = [];
      apps = [];
      selectedIndex = -1;
      send(`MIXER_ERR:${error}`);
      return emit();
    }
    if (!device) {
      available = false;
      error = 'NO_DEVICE';
      sessions = [];
      apps = [];
      selectedIndex = -1;
      send('MIXER_ERR:NO_DEVICE');
      return emit();
    }
    available = true;
    error = null;
    sessions = Array.isArray(device.sessions) ? device.sessions.slice(0, maxApps) : [];
    apps = sessions.map(normalize);
    if (selectedIndex >= apps.length) {
      selectedIndex = -1;
    }
    send(`MIXER_LIST:${apps.length}`);
    return emit();
  };

  const applyVolume = (index, pct) => {
    const target = sessions[index];
    if (!target) {
      error = 'NOT_FOUND';
      send('MIXER_ERR:NOT_FOUND');
      return emit();
    }
    const clamped = clamp(Math.round(pct), 0, 100);
    try {
      target.volume = clamped / 100;
      target.mute = apps[index].mute;
      apps[index] = normalize(target, index);
    } catch (err) {
      error = 'VOL_FAILED';
      send('MIXER_ERR:VOL_FAILED');
      return emit();
    }
    error = null;
    return apps[index];
  };

  const setVolume = (index, pct) => {
    const updated = applyVolume(index, pct);
    if (apps[index] && updated !== apps[index] && error === null) {
      return emit();
    }
    return emit();
  };

  const setMute = (index, mute) => {
    const target = sessions[index];
    if (!target) {
      error = 'NOT_FOUND';
      send('MIXER_ERR:NOT_FOUND');
      return emit();
    }
    try {
      target.mute = mute === true;
      target.volume = apps[index].pct / 100;
      apps[index] = normalize(target, index);
    } catch (err) {
      error = 'VOL_FAILED';
      send('MIXER_ERR:VOL_FAILED');
      return emit();
    }
    error = null;
    send(`MIXER_STATE:${index}:${apps[index].pct}:${apps[index].mute ? 1 : 0}`);
    return emit();
  };

  const handleCommand = async (cmd) => {
    if (typeof cmd !== 'string' || cmd.length === 0) {
      return;
    }
    if (cmd === 'CMD:GET_MIXER_APPS') {
      refresh();
      return;
    }
    if (cmd === 'CMD:EXIT_MIXER') {
      selectedIndex = -1;
      send('MIXER_EXIT');
      emit();
      return;
    }
    if (cmd.startsWith('CMD:SELECT_APP:')) {
      const index = Number.parseInt(cmd.slice('CMD:SELECT_APP:'.length), 10);
      if (!Number.isInteger(index) || index < 0 || index >= apps.length) {
        error = 'NOT_FOUND';
        send('MIXER_ERR:NOT_FOUND');
        emit();
        return;
      }
      selectedIndex = index;
      error = null;
      send(`MIXER_SELECTED:${index}:${apps[index].pct}:${apps[index].mute ? 1 : 0}`);
      emit();
      return;
    }
    if (cmd === 'CMD:VOL_UP' || cmd === 'CMD:VOL_DOWN') {
      if (selectedIndex < 0 || !apps[selectedIndex]) {
        error = 'NO_SELECTION';
        send('MIXER_ERR:NO_SELECTION');
        emit();
        return;
      }
      const delta = cmd === 'CMD:VOL_UP' ? step * 100 : -step * 100;
      const next = clamp(apps[selectedIndex].pct + delta, 0, 100);
      applyVolume(selectedIndex, next);
      send(`MIXER_STATE:${selectedIndex}:${apps[selectedIndex].pct}:${apps[selectedIndex].mute ? 1 : 0}`);
      emit();
      return;
    }
    console.warn('[MixerHandler] comando non gestito:', cmd);
  };

  return {
    handleCommand,
    getState: snapshot,
    refresh,
    setVolume,
    setMute,
    on(event, cb) {
      emitter.on(event, cb);
      return () => emitter.removeListener(event, cb);
    }
  };
}

module.exports = { createMixerHandler, labelFor };
```

- [ ] **Step 4: eseguire il test per vedere che passa**

Run: `node test/mixer-test.js`
Expected: `mixer-test: 9 assertions OK`.

- [ ] **Step 5: aggiungere lo script test**

In `package.json`, tra le virgolette di `scripts`, aggiungere:

```json
"test": "node test/mixer-test.js"
```

- [ ] **Step 6: verificare che la porta seriale non venga più aperta dal modulo**

Run: `node -e "const s=require('./src/main/serialHandler');console.log(Object.keys(s).join(','))"`
Expected: `createMixerHandler,labelFor`. Nessun riferimento a `SerialPort` o `initSerial` nel file.

- [ ] **Step 7: commit**

```bash
git add src/main/serialHandler.js test/mixer-test.js package.json
git commit -m "feat: make serialHandler own mixer state with injectable device"
```

---

### Task 2: Comandi SELECT, VOL, EXIT

**Files:**
- Modify: `src/main/serialHandler.js`
- Test: `test/mixer-test.js`

**Interfaces:**
- Consumes: `createMixerHandler` e `Snapshot` del Task 1.
- Produces: `CMD:SELECT_APP:<index>`, `CMD:VOL_UP`, `CMD:VOL_DOWN`, `CMD:EXIT_MIXER` gestiti; `setVolume(index, pct)` e `setMute(index, mute)` per la UI; un evento `state` emesso a ogni mutazione.

- [ ] **Step 1: scrivere i test falliti**

Aggiungere in `test/mixer-test.js`, dentro `run()`, prima del `console.log` finale:

```js
  const flow = setup([
    fakeSession('Discord', 0.25, false, 'C:\\Users\\demo\\AppData\\Local\\Discord\\Discord.exe', 0),
    fakeSession('Discord', 0.75, false, 'C:\\Users\\demo\\AppData\\Local\\Discord\\Discord.exe', 0),
    fakeSession('Spotify', 0.5)
  ]);
  const sessions = [
    { name: 'Discord', appName: 'C:\\Users\\demo\\AppData\\Local\\Discord\\Discord.exe', state: 0, volume: 0.25, mute: false },
    { name: 'Discord', appName: 'C:\\Users\\demo\\AppData\\Local\\Discord\\Discord.exe', state: 0, volume: 0.75, mute: false },
    { name: 'Spotify', appName: 'spotify.exe', state: 1, volume: 0.5, mute: false }
  ];
  const dup = setup(sessions);
  await dup.handler.handleCommand('CMD:GET_MIXER_APPS');
  await dup.handler.handleCommand('CMD:SELECT_APP:1');
  assert.strictEqual(dup.handler.getState().selectedIndex, 1);
  assert.strictEqual(dup.sessions[1].volume, 0.75, 'il secondo Discord resta indipendente');
  assert.ok(dup.sent.includes('MIXER_SELECTED:1:75:0'));

  await dup.handler.handleCommand('CMD:VOL_UP');
  assert.strictEqual(dup.sessions[1].volume, 0.8, 'step del 5% applicato alla seconda sessione');
  assert.strictEqual(dup.sessions[0].volume, 0.25, 'la prima sessione non viene toccata');
  assert.ok(dup.sent.includes('MIXER_STATE:1:80:0'));

  await dup.handler.handleCommand('CMD:VOL_DOWN');
  await dup.handler.handleCommand('CMD:VOL_DOWN');
  assert.strictEqual(dup.sessions[1].volume, 0.7);

  dup.sessions[1].volume = 1;
  await dup.handler.handleCommand('CMD:VOL_UP');
  assert.strictEqual(dup.sessions[1].volume, 1, 'clamp a 100');

  dup.sessions[1].volume = 0;
  await dup.handler.handleCommand('CMD:VOL_DOWN');
  assert.strictEqual(dup.sessions[1].volume, 0, 'clamp a 0');

  assert.ok(dup.states.length >= 8, 'ogni mutazione emette state');
  assert.strictEqual(dup.states[dup.states.length - 1].selectedIndex, 1);

  await dup.handler.handleCommand('CMD:EXIT_MIXER');
  assert.strictEqual(dup.handler.getState().selectedIndex, -1);
  assert.ok(dup.sent.includes('MIXER_EXIT'));
  await dup.handler.handleCommand('CMD:VOL_UP');
  assert.ok(dup.sent.includes('MIXER_ERR:NO_SELECTION'), 'VOL_UP senza selezione');

  await dup.handler.handleCommand('CMD:SELECT_APP:9');
  assert.ok(dup.sent.includes('MIXER_ERR:NOT_FOUND'), 'indice fuori range');
  await dup.handler.handleCommand('CMD:SELECT_APP:abc');
  assert.ok(dup.sent.includes('MIXER_ERR:NOT_FOUND'), 'indice non numerico');

  const muted = setup([fakeSession('Spotify', 0.5)]);
  await muted.handler.handleCommand('CMD:GET_MIXER_APPS');
  muted.handler.setMute(0, true);
  assert.strictEqual(muted.sessions[0].mute, true);
  assert.ok(muted.sent.includes('MIXER_STATE:0:50:1'));
  muted.handler.setVolume(0, 33);
  assert.strictEqual(muted.sessions[0].volume, 0.33, 'arrotondamento a 33%');
  assert.strictEqual(muted.handler.getState().apps[0].mute, true, 'il mute resta dopo il volume');
```

- [ ] **Step 2: eseguire il test per vedere che fallisce**

Run: `node test/mixer-test.js`
Expected: FAILED con `Cannot read properties of undefined (reading 'length')` su `dup.sessions`, perché `setup` non ancora restituisce le sessioni.

- [ ] **Step 3: far restituire le sessioni da setup**

In `test/mixer-test.js`, sostituire la funzione `setup` con:

```js
function setup(sessions, options = {}) {
  const sent = [];
  const states = [];
  const handler = createMixerHandler({
    getDevice: () => ({ name: 'Cuffie Test', sessions }),
    sendLine: (line) => sent.push(line),
    ...options
  });
  handler.on('state', (snapshot) => states.push(snapshot));
  return { handler, sent, states, sessions };
}
```

- [ ] **Step 4: eseguire il test per vedere che passa**

Run: `node test/mixer-test.js`
Expected: PASS. Se `MIXER_SELECTED:1:75:0` non compare, `normalize` sta ricalcolando il volume da `target.volume` prima che la selezione sia registrata: verificare che `refresh()` chiami `sessions.map(normalize)` e che `select` usi `apps[index]`.

- [ ] **Step 5: rimuovere il codice morto in setVolume**

In `src/main/serialHandler.js`, sostituire `setVolume` con:

```js
  const setVolume = (index, pct) => {
    const updated = applyVolume(index, pct);
    if (updated) {
      send(`MIXER_STATE:${index}:${updated.pct}:${updated.mute ? 1 : 0}`);
    }
    return emit();
  };
```

- [ ] **Step 6: eseguire di nuovo il test**

Run: `node test/mixer-test.js`
Expected: PASS.

- [ ] **Step 7: commit**

```bash
git add src/main/serialHandler.js test/mixer-test.js
git commit -m "feat: handle mixer select volume and exit commands by index"
```

---

### Task 3: Firmware, protocollo v2

**Files:**
- Modify: `firmware/arduino_uno/arduino_uno.ino`
- Test: `test/mixer-protocol-test.js` (nuovo)

**Interfaces:**
- Consumes: i cinque messaggi PC→MCU definiti nel Protocollo v2.
- Produces: il firmware emette `CMD:SELECT_APP:<index>` con l'indice e non più il nome; mantiene solo `mixerAppCount`, `selectedIndex`, `selectedPct`, `selectedMute`.

- [ ] **Step 1: scrivere il test fallito del contratto di protocollo**

Creare `test/mixer-protocol-test.js`:

```js
const assert = require('assert');

function parseIncoming(line) {
  const result = { type: 'UNKNOWN' };
  if (line.startsWith('MIXER_LIST:')) {
    result.type = 'LIST';
    result.count = parseInt(line.slice('MIXER_LIST:'.length), 10) || 0;
    return result;
  }
  if (line.startsWith('MIXER_EXIT')) {
    result.type = 'EXIT';
    return result;
  }
  if (line.startsWith('MIXER_SELECTED:') || line.startsWith('MIXER_STATE:')) {
    const type = line.startsWith('MIXER_SELECTED:') ? 'SELECTED' : 'STATE';
    const rest = line.slice(type === 'SELECTED' ? 'MIXER_SELECTED:'.length : 'MIXER_STATE:'.length);
    const first = rest.indexOf(':');
    const second = rest.indexOf(':', first + 1);
    if (first === -1 || second === -1) {
      return { type: 'MALFORMED' };
    }
    result.type = type;
    result.index = parseInt(rest.slice(0, first), 10);
    result.pct = parseInt(rest.slice(first + 1, second), 10);
    result.mute = rest.slice(second + 1) === '1';
    return result;
  }
  if (line.startsWith('MIXER_ERR:')) {
    result.type = 'ERR';
    result.code = line.slice('MIXER_ERR:'.length);
    return result;
  }
  return result;
}

function run() {
  assert.deepStrictEqual(parseIncoming('MIXER_LIST:6'), { type: 'LIST', count: 6 });
  assert.deepStrictEqual(parseIncoming('MIXER_SELECTED:3:45:0'), { type: 'SELECTED', index: 3, pct: 45, mute: false });
  assert.deepStrictEqual(parseIncoming('MIXER_STATE:0:100:1'), { type: 'STATE', index: 0, pct: 100, mute: true });
  assert.deepStrictEqual(parseIncoming('MIXER_EXIT'), { type: 'EXIT' });
  assert.deepStrictEqual(parseIncoming('MIXER_ERR:NO_SELECTION'), { type: 'ERR', code: 'NO_SELECTION' });
  assert.strictEqual(parseIncoming('MIXER_STATE:abc:1:0').type, 'MALFORMED');
  assert.strictEqual(parseIncoming('CMD:GET_MIXER_APPS').type, 'UNKNOWN');

  const firmware = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'firmware', 'arduino_uno', 'arduino_uno.ino'),
    'utf-8'
  );
  assert.ok(firmware.includes('CMD:SELECT_APP:'), 'il firmware deve emettere CMD:SELECT_APP:');
  assert.ok(!firmware.includes('mixerApps['), 'la tabella dei nomi deve essere eliminata');
  assert.ok(!firmware.includes('strtok('), 'niente strtok: i nomi non attraversano la seriale');
  assert.ok(firmware.includes('CMD:EXIT_MIXER'), 'deve esistere l uscita dal mixer');
  assert.ok(firmware.includes('selectedPct'), 'lo stato del volume deve restare sul firmware');

  console.log('mixer-protocol-test: 10 assertions OK');
}

run();
```

- [ ] **Step 2: eseguire il test per vedere che fallisce**

Run: `node test/mixer-protocol-test.js`
Expected: FAILED su `CMD:EXIT_MIXER` assente nel firmware e su `mixerApps[` ancora presente.

- [ ] **Step 3: sostituire lo stato e il parser nel firmware**

In `firmware/arduino_uno/arduino_uno.ino`, sostituire le righe da `char mixerApps[5][16];` fino a `uint8_t rxIndex = 0;` con:

```cpp
uint8_t mixerAppCount = 0;
int8_t selectedIndex = 0;
uint8_t selectedPct = 0;
bool selectedMute = false;
Mode currentMode = MACRO;

char rxBuffer[48];
uint8_t rxIndex = 0;
```

Sostituire `void drawMenu()` con:

```cpp
void announce(const char* prefix) {
  Serial.print(prefix);
  Serial.print(F(" | "));
  Serial.print(F("app "));
  Serial.print(selectedIndex + 1);
  Serial.print(F("/"));
  Serial.print(mixerAppCount);
  Serial.print(F(" | "));
  Serial.print(selectedPct);
  Serial.print(F("%"));
  if (selectedMute) Serial.print(F(" MUTO"));
  Serial.println();
}
```

Sostituire `void parseIncoming()` con:

```cpp
void parseIncoming() {
  if (strncmp(rxBuffer, "MIXER_LIST:", 11) == 0) {
    mixerAppCount = (uint8_t)atoi(rxBuffer + 11);
    selectedIndex = 0;
    currentMode = mixerAppCount > 0 ? MIXER_MENU : MACRO;
    Serial.print(F("MIXER: "));
    Serial.print(mixerAppCount);
    Serial.println(F(" app disponibili"));
    return;
  }

  if (strncmp(rxBuffer, "MIXER_SELECTED:", 15) == 0 || strncmp(rxBuffer, "MIXER_STATE:", 12) == 0) {
    char* p = strchr(rxBuffer + 1, ':');
    if (p == NULL) return;
    p = strchr(p + 1, ':');
    if (p == NULL) return;
    *p = '\0';
    int8_t idx = (int8_t)atoi(rxBuffer + strchr(rxBuffer, ':') - rxBuffer + 1);
    p++;
    char* p2 = strchr(p, ':');
    if (p2 != NULL) *p2 = '\0';
    selectedPct = (uint8_t)atoi(p);
    if (p2 != NULL) selectedMute = atoi(p2 + 1) == 1;
    if (idx == selectedIndex) announce(F("MIXER"));
    return;
  }

  if (strncmp(rxBuffer, "MIXER_EXIT", 10) == 0) {
    currentMode = MACRO;
    Serial.println(F("MIXER: uscita"));
    return;
  }

  if (strncmp(rxBuffer, "MIXER_ERR:", 10) == 0) {
    Serial.print(F("MIXER ERRORE: "));
    Serial.println(rxBuffer + 10);
  }
}
```

- [ ] **Step 4: correggere l'invio dei comandi encoder**

Nella sezione pressione breve, sostituire il blocco che invia `CMD:SELECT_APP:` con il nome dell'app con:

```cpp
        Serial.print(F("CMD:SELECT_APP:"));
        Serial.println(selectedIndex);
```

Sostituire l'uscita manuale `currentMode = MACRO;` dentro `MIXER_ADJUST` con l'invio del comando:

```cpp
        Serial.println(F("CMD:EXIT_MIXER"));
        currentMode = MACRO;
```

Aggiungere la lunga pressione in modalità mixer, subito dopo il blocco della lunga pressura esistente, con:

```cpp
      if (currentMode == MIXER_MENU || currentMode == MIXER_ADJUST) {
        Serial.println(F("CMD:EXIT_MIXER"));
        currentMode = MACRO;
      } else {
        Serial.println(F("CMD:GET_MIXER_APPS"));
      }
```

- [ ] **Step 5: togliere il dump del menu dalla rotazione**

Nella sezione rotazione, sostituire la chiamata `drawMenu();` dentro `MIXER_MENU` con:

```cpp
      announce(F("SELEZIONE"));
```

- [ ] **Step 6: aggiungere il debounce sul push dell'encoder**

Sostituire il blocco di gestione del pulsante encoder con:

```cpp
  bool encBtnCur = digitalRead(ENCODER_BTN_PIN);
  static unsigned long encBtnLastChange = 0;
  if (encBtnCur != encoderBtnLastState && (now - encBtnLastChange) > DEBOUNCE_DELAY_MS) {
    encBtnLastChange = now;
    encoderBtnLastState = encBtnCur;
    if (encBtnCur == LOW) {
      encoderBtnPressStart = now;
    } else {
      unsigned long pressDuration = now - encoderBtnPressStart;
      if (pressDuration >= LONG_PRESS_MS) {
        if (currentMode == MIXER_MENU || currentMode == MIXER_ADJUST) {
          Serial.println(F("CMD:EXIT_MIXER"));
          currentMode = MACRO;
        } else {
          Serial.println(F("CMD:GET_MIXER_APPS"));
        }
      } else if (currentMode == MIXER_MENU && mixerAppCount > 0) {
        Serial.print(F("CMD:SELECT_APP:"));
        Serial.println(selectedIndex);
        currentMode = MIXER_ADJUST;
      } else if (currentMode == MIXER_ADJUST) {
        Serial.println(F("CMD:EXIT_MIXER"));
        currentMode = MACRO;
      } else {
        Serial.println(F("BTN_ENCODER_PRESSED"));
      }
    }
  }
```

- [ ] **Step 7: eseguire il test del contratto**

Run: `node test/mixer-protocol-test.js`
Expected: `mixer-protocol-test: 10 assertions OK`.

- [ ] **Step 8: verifica manuale del firmware**

Upload dello sketch su Arduino UNO R3, aprire il Serial Monitor a 9600 baud, e controllare: pressione lunga dell'encoder in MACRO stampa `CMD:GET_MIXER_APPS`; rotazione in MACRO stampa `CMD:MASTER_VOL_UP` o `CMD:MASTER_VOL_DOWN` invariati; alla ricezione di `MIXER_LIST:3` il firmware annuncia 3 app; rotazione in MIXER_MENU stampa una sola riga di selezione e non più il menu intero; pressione breve stampa `CMD:SELECT_APP:0`; rotazione in MIXER_ADJUST stampa `CMD:VOL_UP`. Segnalare all'utente il risultato: questa verifica non è automatizzabile in questo ambiente.

- [ ] **Step 9: commit**

```bash
git add firmware/arduino_uno/arduino_uno.ino test/mixer-protocol-test.js
git commit -m "feat: switch firmware to index-based mixer protocol"
```

---

### Task 4: Bridge main e preload

**Files:**
- Modify: `src/main/main.js:206-213` (setup), più handler IPC e route HTTP
- Modify: `src/main/preload.js:7-34`

**Interfaces:**
- Consumes: `createMixerHandler({ getDevice, sendLine })`, `on('state', cb)`, `getState`, `setVolume`, `setMute`, `refresh` dal Task 1-2.
- Produces: canali `mixer:state` (IPC push e SSE), invocazioni `mixer:get-state`, `mixer:set-volume`, `mixer:set-mute`, `mixer:refresh`, endpoint `GET /api/mixer` e `POST /api/mixer/volume`, `POST /api/mixer/mute`, `POST /api/mixer/refresh`.

- [ ] **Step 1: creare l'handler e collegare gli eventi in main.js**

Sostituire le righe 210-213 di `src/main/main.js` con:

```js
  const { createMixerHandler } = require('./serialHandler');
  const mixer = createMixerHandler({
    sendLine: (line) => {
      if (hardware && typeof hardware.sendLine === 'function') {
        hardware.sendLine(line);
      }
    }
  });
  global.mixer = mixer;
  hardware.on('mixer-cmd', (cmd) => {
    mixer.handleCommand(cmd);
  });
  mixer.on('state', (snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mixer:state', snapshot);
    }
    broadcastSse('mixer:state', snapshot);
  });
```

- [ ] **Step 2: registrare gli handler IPC**

Accanto agli altri `ipcMain.handle` in `src/main/main.js`, aggiungere:

```js
ipcMain.handle('mixer:get-state', () => global.mixer.getState());
ipcMain.handle('mixer:set-volume', (_event, { index, pct }) => global.mixer.setVolume(index, pct));
ipcMain.handle('mixer:set-mute', (_event, { index, mute }) => global.mixer.setMute(index, mute));
ipcMain.handle('mixer:refresh', () => global.mixer.refresh());
```

- [ ] **Step 3: aggiungere gli endpoint HTTP**

Nella sezione che gestisce le richieste HTTP, aggiungere le route `/api/mixer`, `/api/mixer/volume`, `/api/mixer/mute`, `/api/mixer/refresh` con lo stesso schema di risposta JSON usato dalle altre route, usando `global.mixer.getState()`, `global.mixer.setVolume(body.index, body.pct)`, `global.mixer.setMute(body.index, body.mute)` e `global.mixer.refresh()`. Usare esattamente le convenzioni di codice di risposta e di parsing del body già presenti nel file.

- [ ] **Step 4: esporre l'API in preload.js**

In `src/main/preload.js`, aggiungere prima della chiusura dell'oggetto:

```js
  mixerGetState: () => ipcRenderer.invoke('mixer:get-state'),
  mixerSetVolume: (index, pct) => ipcRenderer.invoke('mixer:set-volume', { index, pct }),
  mixerSetMute: (index, mute) => ipcRenderer.invoke('mixer:set-mute', { index, mute }),
  mixerRefresh: () => ipcRenderer.invoke('mixer:refresh'),

  onMixerState: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('mixer:state', subscription);
    return () => ipcRenderer.removeListener('mixer:state', subscription);
  }
```

- [ ] **Step 5: verificare il bridge a runtime**

Run: `npm run dev`, poi in un altro terminale:

```powershell
Invoke-RestMethod -Uri http://localhost:5174/api/mixer -Method Get | ConvertTo-Json -Depth 5
```

Expected: JSON con `available`, `deviceName`, `selectedIndex`, `apps` e le sessioni reali del dispositivo di default. Se `available` è `false`, il problema è il caricamento del modulo nativo nel main process e va risolto prima di proseguire.

- [ ] **Step 6: commit**

```bash
git add src/main/main.js src/main/preload.js
git commit -m "feat: bridge mixer state to renderer over ipc and http"
```

---

### Task 5: UI MixerPane

**Files:**
- Create: `src/renderer/src/component/MixerPane.jsx`
- Modify: `src/renderer/src/App.jsx` (client API, stato, switch vista, montaggio)
- Modify: `src/renderer/src/App.css`

**Interfaces:**
- Consumes: `mixerGetState`, `mixerSetVolume(index, pct)`, `mixerSetMute(index, mute)`, `mixerRefresh`, `onMixerState(cb)` dal Task 4; forma `Snapshot` dal Task 1.
- Produces: componente `MixerPane({ state, onSetVolume, onSetMute, onRefresh })`.

- [ ] **Step 1: creare MixerPane.jsx**

Creare `src/renderer/src/component/MixerPane.jsx`:

```jsx
import React from 'react';

export default function MixerPane({ state, onSetVolume, onSetMute, onRefresh }) {
  if (!state || state.available === false) {
    return (
      <section className="mixer-pane mixer-pane-empty">
        <p className="mixer-empty-message">
          Mixer non disponibile{state && state.error ? `: ${state.error}` : ''}
        </p>
        <button type="button" className="mixer-refresh" onClick={onRefresh}>
          Riprova
        </button>
      </section>
    );
  }

  return (
    <section className="mixer-pane">
      <header className="mixer-header">
        <div>
          <h2>Volume Mixer</h2>
          <p className="mixer-device">{state.deviceName || 'Dispositivo predefinito'}</p>
        </div>
        <button type="button" className="mixer-refresh" onClick={onRefresh}>
          Aggiorna
        </button>
      </header>

      {state.apps.length === 0 ? (
        <p className="mixer-empty-message">Nessuna sessione audio attiva.</p>
      ) : (
        <ul className="mixer-list">
          {state.apps.map((app) => (
            <li
              key={app.index}
              className={`mixer-row${app.index === state.selectedIndex ? ' is-selected' : ''}${
                app.active ? '' : ' is-inactive'
              }`}
            >
              <div className="mixer-row-label" title={app.name || app.label}>
                <span className="mixer-row-name">{app.label}</span>
                {app.index === state.selectedIndex && <span className="mixer-row-badge">selezionata</span>}
              </div>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={app.pct}
                onChange={(event) => onSetVolume(app.index, Number(event.target.value))}
                aria-label={`Volume ${app.label}`}
              />
              <span className="mixer-row-pct">{app.pct}%</span>
              <button
                type="button"
                className={`mixer-mute${app.mute ? ' is-muted' : ''}`}
                onClick={() => onSetMute(app.index, !app.mute)}
                aria-label={`Mute ${app.label}`}
              >
                M
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="mixer-hint">
        Pressione lunga sull'encoder: apri il mixer. Rotazione: scorri le app. Pressione breve: seleziona e regola. Rotazione in regolazione: volume.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: aggiungere i metodi mixer agli API client in App.jsx**

Nel ramo `electron` di `createApiClient` (`src/renderer/src/App.jsx:10-23`) aggiungere:

```jsx
      mixerGetState: () => window.macroPadAPI.mixerGetState(),
      mixerSetVolume: (index, pct) => window.macroPadAPI.mixerSetVolume(index, pct),
      mixerSetMute: (index, mute) => window.macroPadAPI.mixerSetMute(index, mute),
      mixerRefresh: () => window.macroPadAPI.mixerRefresh(),
      onMixerState: (cb) => window.macroPadAPI.onMixerState(cb),
```

Nel ramo `web` (`src/renderer/src/App.jsx:27-91`) aggiungere:

```jsx
    mixerGetState: async () => {
      const r = await fetch(`${HTTP_BASE}/mixer`);
      return await r.json();
    },
    mixerSetVolume: async (index, pct) => {
      const r = await fetch(`${HTTP_BASE}/mixer/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, pct })
      });
      return await r.json();
    },
    mixerSetMute: async (index, mute) => {
      const r = await fetch(`${HTTP_BASE}/mixer/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, mute })
      });
      return await r.json();
    },
    mixerRefresh: async () => {
      const r = await fetch(`${HTTP_BASE}/mixer/refresh`, { method: 'POST' });
      return await r.json();
    },
    onMixerState: (cb) => {
      const eventSource = new EventSource(`${HTTP_BASE}/events`);
      eventSource.addEventListener('mixer:state', (e) => {
        try {
          cb(JSON.parse(e.data));
        } catch (err) {
          console.error('Errore parsing SSE mixer:state:', err);
        }
      });
      return () => eventSource.close();
    }
```

- [ ] **Step 3: aggiungere stato e sottoscrizione in App.jsx**

Dentro il componente `App`, aggiungere stato e effetto:

```jsx
  const [view, setView] = useState('keypad');
  const [mixerState, setMixerState] = useState(null);

  useEffect(() => {
    let active = true;
    api.mixerGetState()
      .then((snapshot) => {
        if (active) setMixerState(snapshot);
      })
      .catch((err) => console.error('Errore caricamento mixer:', err));
    const unsubscribe = api.onMixerState((snapshot) => {
      if (active) setMixerState(snapshot);
    });
    return () => {
      active = false;
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);
```

E montare il pannello accanto a `KeypadPane`, con lo switch di vista:

```jsx
      <ActivityBar statusMessage={statusMessage} lastEvent={lastEvent} />
      <div className="view-switch">
        <button type="button" className={view === 'keypad' ? 'is-active' : ''} onClick={() => setView('keypad')}>
          Tastierino
        </button>
        <button type="button" className={view === 'mixer' ? 'is-active' : ''} onClick={() => setView('mixer')}>
          Volume Mixer
        </button>
      </div>
      {view === 'mixer' ? (
        <MixerPane
          state={mixerState}
          onSetVolume={(index, pct) => api.mixerSetVolume(index, pct)}
          onSetMute={(index, mute) => api.mixerSetMute(index, mute)}
          onRefresh={() => api.mixerRefresh()}
        />
      ) : (
        <KeypadPane
          profile={activeProfile}
          config={config}
          onUpdateConfig={handleUpdateConfig}
          onTestAction={handleTestAction}
        />
      )}
```

Adattare i nomi delle prop e la posizione alla struttura JSX già presente in `App.jsx`, senza rimuovere nessun elemento esistente.

- [ ] **Step 4: importare MixerPane in App.jsx**

Aggiungere in cima a `src/renderer/src/App.jsx`:

```jsx
import MixerPane from './component/MixerPane';
```

- [ ] **Step 5: aggiungere gli stili in App.css**

Aggiungere in fondo a `src/renderer/src/App.css`, riusando le variabili già definite nel file:

```css
.view-switch {
  display: flex;
  gap: 8px;
  padding: 0 16px 12px;
}

.view-switch button {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px 12px;
}

.view-switch button.is-active {
  border-color: var(--accent);
  color: var(--accent);
}

.mixer-pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.mixer-header {
  align-items: center;
  display: flex;
  justify-content: space-between;
}

.mixer-device,
.mixer-hint,
.mixer-empty-message {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin: 4px 0 0;
}

.mixer-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.mixer-row {
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(120px, 1fr) 2fr 56px 40px;
  padding: 10px 12px;
}

.mixer-row.is-selected {
  border-color: var(--accent);
}

.mixer-row.is-inactive {
  opacity: 0.75;
}

.mixer-row-label {
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
}

.mixer-row-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mixer-row-badge {
  color: var(--accent);
  font-size: 0.7rem;
  text-transform: uppercase;
}

.mixer-row-pct {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.mixer-mute,
.mixer-refresh {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: inherit;
  cursor: pointer;
  padding: 4px 8px;
}

.mixer-mute.is-muted {
  border-color: #e05252;
  color: #e05252;
}
```

- [ ] **Step 6: verificare la build del renderer**

Run: `npm run build:react`
Expected: build Vite completata senza errori.

- [ ] **Step 7: verifica manuale della UI**

Run: `npm run dev`, aprire la finestra, andare alla scheda Volume Mixer e verificare: tutte le sessioni elencate, `Sessione #N` per quelle senza nome, i due Discord come righe separate, la riga selezionata che si sposta con l'encoder quando è in modalità mixer, lo slider che cambia il volume dell'app indicata, il mute che funziona, il pulsante Aggiorna che ricarica la lista. Segnalare all'utente il risultato.

- [ ] **Step 8: commit**

```bash
git add src/renderer/src/component/MixerPane.jsx src/renderer/src/App.jsx src/renderer/src/App.css
git commit -m "feat: add volume mixer pane to the renderer"
```

---

### Task 6: Strumento CLI e documentazione

**Files:**
- Modify: `test/mixer-interactive.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `createMixerHandler` dal Task 1 e il protocollo v2.
- Produce: strumento manuale coerente col protocollo e documentazione aggiornata.

- [ ] **Step 1: aggiornare test/mixer-interactive.js**

Sostituire i riferimenti al vecchio protocollo con: `CMD:GET_MIXER_APPS` per il refresh della lista, `CMD:SELECT_APP:<i>` con `i` ricavato dall'indice mostrato, `CMD:VOL_UP` e `CMD:VOL_DOWN` per il volume, `CMD:EXIT_MIXER` per uscire. Lo strumento deve stampare lo `Snapshot` completo a ogni cambio, includendo `label`, `pct` e `mute`, e deve accettare `refresh`, `select <i>`, `up`, `down`, `mute <i>`, `vol <i> <pct>`, `exit`.

- [ ] **Step 2: eseguire lo strumento in modalità mock**

Run: `node test/mixer-interactive.js`
Expected: lo strumento si avvia, `refresh` stampa lo snapshot con le sessioni del dispositivo di default e `select 0` emette `MIXER_SELECTED:0:<pct>:0`. Uscire con `exit`.

- [ ] **Step 3: documentare il Volume Mixer nel README**

Aggiungere al `README.md` una sezione con: tabella dei cinque comandi MCU→PC e dei cinque messaggi PC→MCU, i sette codici di errore, la descrizione dell'interazione con l'encoder (pressione lunga apre il mixer, rotazione scorri le app, pressione breve seleziona ed entra in regolazione, rotazione in regolazione cambia il volume, pressione lunga o breve in regolazione esce) e la spiegazione che i nomi delle app non transitano sulla seriale perché possono superare 100 caratteri e contenere `|` e caratteri non-ASCII.

- [ ] **Step 4: correggere la sezione hardware del README**

La sezione "Schema di Collegamento" documenta oggi un solo pulsante sul pin 2 e non menziona l'encoder. Sostituirla con lo schema reale: tre pulsanti sui pin 8, 9 e 10, encoder KY-040 con A sul pin 2, B sul pin 3 e push sul pin 4, tutti con pull-up interno e senza resistenze esterne.

- [ ] **Step 5: commit**

```bash
git add test/mixer-interactive.js README.md
git commit -m "docs: document the index-based volume mixer protocol"
```

---

### Task 7: Verifica finale e push

**Files:**
- Nessun file nuovo; verifica dell'intero piano.

**Interfaces:**
- Consumes: tutto ciò che i Task 1-6 hanno prodotto.
- Produce: evidenza che test e build passano, e `origin/main` allineato.

- [ ] **Step 1: eseguire tutti i test**

```bash
node test/mixer-test.js
node test/mixer-protocol-test.js
```

Expected: entrambi stampano le rispettive righe di conferma e il processo termina con codice 0.

- [ ] **Step 2: eseguire la build**

Run: `npm run build:react`
Expected: build completata senza errori.

- [ ] **Step 3: rieseguire i test del Task 1 sul flusso completo**

Run: `npm test`
Expected: `mixer-test` in uscita 0.

- [ ] **Step 4: ispezionare il diff complessivo**

```bash
git status --short
git diff --stat origin/main
git log --oneline origin/main..HEAD
```

Expected: solo i file previsti dal piano, nessun file inatteso, nessun segreto.

- [ ] **Step 5: commit finale se ci sono modifiche non committate**

```bash
git add -A
git commit -m "test: verify volume mixer end to end"
```

- [ ] **Step 6: push**

```bash
git push origin main
```

- [ ] **Step 7: confermare allineamento e stato pulito**

```bash
git status --short --branch
git rev-parse HEAD origin/main
```

Expected: working tree pulito e hash identici.

## fuori ambito

- OLED/SSD1306: resta commentato. Al riattivamento reintroducire `MIXER_APP:<i>:<nome>` per il nome della sola app selezionata e `mixerAppCount` come limite di navigazione.
- `CMD:MASTER_VOL_UP` e `CMD:MASTER_VOL_DOWN`: invariati nel firmware, senza handler nel main process per decisione dell'utente.
- Bug non-mixer già identificati e non toccati da questo piano: `vite.config.js:8` espone `config.json` e `tools/` via dev server; CORS `*` con endpoint `/api/test` espone esecuzione di comandi a qualunque pagina; `preload.js` senza evento di cambio configurazione; `KeyEditor.jsx` senza il tipo `BASH`; doppio `loadConfig()` per ogni pressione in `ConfigManager.js`; `executeMacro` ignora gli errori; `keySender.exe` e `config.json` restano dentro `app.asar`; `sendLine` definito fuori classe; due `EventSource` per la stessa connessione; `test/server.js` usa il vecchio protocollo; firmware duplicato in `test/`.

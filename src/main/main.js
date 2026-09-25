const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, Notification } = require('electron');
const path = require('path');
const http = require('http');
const configManager = require('./ConfigManager');
const ActionDispatcher = require('./ActionDispatcher');
const SerialHardwareListener = require('./hardware/SerialHardwareListener');
const serialHandler = require('./serialHandler');

// Nota per Fase 2: per passare a USB Raw HID, basta sostituire con:
// const HidHardwareListener = require('./hardware/HidHardwareListener');
// hardware = new HidHardwareListener();

let mainWindow = null;
let tray = null;
let hardware = null;
let httpServer = null;
const sseClients = [];
app.isQuitting = false;

// Evita istanze multiple
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('[Main] Un\'altra istanza dell\'app è già in esecuzione. Chiusura.');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Crea la finestra principale di configurazione.
 */
function createWindow() {
  const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
  const startHidden = process.argv.includes('--hidden') || process.argv.includes('--minimized');

  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    title: 'Macro Pad Manager',
    show: isDev ? true : !startHidden, // Mostra la finestra se avviata in dev o dall'utente
    autoHideMenuBar: true,
    backgroundColor: '#121318',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Mostra quando pronta se in sviluppo
  mainWindow.once('ready-to-show', () => {
    if (isDev && !startHidden) {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Carica React (in dev da Vite dev server, in prod da dist/index.html)
  if (isDev) {
    const devUrl = 'http://localhost:5173';
    mainWindow.loadURL(devUrl).catch(() => {
      console.log(`[Main] In attesa del server Vite a ${devUrl}...`);
      setTimeout(() => mainWindow.loadURL(devUrl), 1500);
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // Intercetta la chiusura per minimizzare nella Tray invece di terminare
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      console.log('[Main] Finestra nascosta nella System Tray.');
    }
  });
}

/**
 * Crea e configura l'icona nella System Tray di Windows.
 */
function createTray() {
  const iconPath = path.join(__dirname, '../../assets/tray-icon.png');
  let trayIcon = nativeImage.createFromPath(iconPath);

  if (trayIcon.isEmpty()) {
    console.warn('[Tray] Icona PNG non trovata, uso fallback.');
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Macro Pad Manager (Attivo in background)');

  updateTrayMenu();

  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

/**
 * Aggiorna il menu contestuale della System Tray con lo stato attuale.
 */
function updateTrayMenu() {
  if (!tray) return;

  const isConnected = hardware ? hardware.isConnected() : false;
  const currentPort = hardware ? hardware.currentPort || 'Nessuna' : 'Nessuna';

  const cfg = configManager.getConfig();
  const profilesList = Object.values(cfg.profiles || {});
  const activeProf = cfg.profiles?.[cfg.activeProfile] || profilesList[0];

  const profileMenuItems = profilesList.map(p => ({
    label: `${p.name || p.id}${p.id === cfg.activeProfile ? ' ✓' : ''}`,
    type: 'radio',
    checked: p.id === cfg.activeProfile,
    click: () => {
      cfg.activeProfile = p.id;
      configManager.saveConfig(cfg);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('config:updated', cfg);
      }
      broadcastSse('config:updated', cfg);
      updateTrayMenu();
    }
  }));

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Stato: ${isConnected ? '🟢 Connesso (' + currentPort + ')' : '🔴 Disconnesso'}`,
      enabled: false
    },
    {
      label: `Profilo Attivo: ${activeProf?.name || 'Standard'}`,
      submenu: profileMenuItems
    },
    { type: 'separator' },
    {
      label: 'Apri Tastierino Config',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Riconnetti Hardware',
      click: async () => {
        const config = configManager.getConfig();
        if (config.serial?.port && hardware) {
          try {
            await hardware.connect(config.serial.port, { baudRate: config.serial.baudRate || 9600 });
          } catch (err) {
            console.error('[Main] Errore riconnessione:', err.message);
          }
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Esci',
      click: () => {
        app.isQuitting = true;
        if (hardware) hardware.disconnect();
        if (httpServer) httpServer.close();
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

/**
 * Trasmette un evento a tutti i client SSE (browser web su localhost:5173).
 */
function broadcastSse(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = sseClients.length - 1; i >= 0; i--) {
    try {
      sseClients[i].write(payload);
    } catch {
      sseClients.splice(i, 1);
    }
  }
}

/**
 * Inizializza l'ascolto hardware (FASE 1: Seriale Arduino UNO R3).
 */
function setupHardware() {
  hardware = new SerialHardwareListener();
  // expose hardware globally for serialHandler sendLine
  global.hardware = hardware;
  hardware.on('mixer-cmd', (cmd) => {
    serialHandler.handleCommand(cmd);
  });

  // Ricezione pressione tasto
  hardware.on('key-pressed', async ({ keyId, raw }) => {
    console.log(`[Main] Evento hardware ricevuto: Key="${keyId}" (Raw: "${raw}")`);

    const eventPayload = { keyId, raw, timestamp: Date.now() };

    // Invia evento al renderer Electron
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hardware:key-pressed', eventPayload);
    }

    // Invia evento a eventuali browser connessi
    broadcastSse('hardware:key-pressed', eventPayload);

    // Cerca l'azione configurata (ricarica automaticamente la configurazione aggiornata)
    const action = configManager.getKeyAction(keyId);
    if (action) {
      console.log(`[Main] Esecuzione azione per tasto "${keyId}":`, action);
      const result = await ActionDispatcher.execute(action);
      console.log(`[Main] Risultato esecuzione tasto "${keyId}":`, result);

      if (mainWindow && !mainWindow.isVisible() && Notification.isSupported()) {
        const notif = new Notification({
          title: `Macro Pad: Tasto ${keyId} premuto`,
          body: `${action.label || action.type}: ${action.value}`,
          silent: true
        });
        notif.show();
      }
    } else {
      console.warn(`[Main] Nessuna azione configurata per il tasto ID: "${keyId}"`);
    }
  });

  // Aggiornamenti di stato della connessione hardware
  hardware.on('status', (status) => {
    updateTrayMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hardware:status', status);
    }
    broadcastSse('hardware:status', status);
  });

  hardware.on('error', (err) => {
    console.error('[Main] Errore hardware listener:', err.message);
  });

  // Connessione automatica iniziale da config.json se presente
  const cfg = configManager.getConfig();
  if (cfg.serial?.autoConnect && cfg.serial?.port) {
    console.log(`[Main] Tentativo di auto-connessione su ${cfg.serial.port}...`);
    hardware.connect(cfg.serial.port, { baudRate: cfg.serial.baudRate || 9600 })
      .catch((err) => {
        console.warn(`[Main] Auto-connessione fallita su ${cfg.serial.port}: ${err.message}`);
      });
  }
}

/**
 * Server HTTP locale su porta 5174 per consentire al frontend React
 * di salvare/leggere le configurazioni ed eseguire azioni anche quando aperto nel browser web (Firefox/Chrome).
 */
function setupHttpBridge() {
  const PORT = 5174;
  httpServer = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    // Endpoint Server-Sent Events per lo streaming di key-pressed e status
    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
      });
      res.write(': connected\n\n');
      sseClients.push(res);
      req.on('close', () => {
        const idx = sseClients.indexOf(res);
        if (idx !== -1) sseClients.splice(idx, 1);
      });
      return;
    }

    // Helper per leggere il body JSON
    const readJsonBody = () => new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => { data += chunk; });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });

    try {
      if (url.pathname === '/api/config') {
        if (req.method === 'GET') {
          const cfg = configManager.getConfig();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(cfg));
        } else if (req.method === 'POST') {
          const body = await readJsonBody();
          const result = configManager.saveConfig(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(result));
        }
      }

      if (url.pathname === '/api/ports' && req.method === 'GET') {
        const ports = hardware ? await hardware.listDevices() : [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(ports));
      }

      if (url.pathname === '/api/connect' && req.method === 'POST') {
        const body = await readJsonBody();
        const portPath = body.portPath;
        const baudRate = body.baudRate || 9600;
        await hardware.connect(portPath, { baudRate });
        const cfg = configManager.getConfig();
        cfg.serial = { ...cfg.serial, port: portPath, baudRate };
        configManager.saveConfig(cfg);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }

      if (url.pathname === '/api/disconnect' && req.method === 'POST') {
        if (hardware) await hardware.disconnect();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: true }));
      }

      if (url.pathname === '/api/status' && req.method === 'GET') {
        const status = {
          connected: hardware ? hardware.isConnected() : false,
          port: hardware ? hardware.currentPort : null
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(status));
      }

      if (url.pathname === '/api/test' && req.method === 'POST') {
        const action = await readJsonBody();
        const result = await ActionDispatcher.execute(action);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(result));
      }

      if (url.pathname === '/api/mixer' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(serialHandler.getApps()));
      }

      if (url.pathname === '/api/mixer/select' && req.method === 'POST') {
        const body = await readJsonBody();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(serialHandler.selectAppByIndex(body.index)));
      }

      if (url.pathname === '/api/mixer/volume' && req.method === 'POST') {
        const body = await readJsonBody();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(serialHandler.setAppVolume(body.index, body.pct)));
      }

      if (url.pathname === '/api/mixer/mute' && req.method === 'POST') {
        const body = await readJsonBody();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(serialHandler.setAppMute(body.index, body.mute)));
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Endpoint non trovato' }));
    } catch (err) {
      console.error('[HttpBridge] Errore richiesta:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });

  httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`[Main] Bridge HTTP attivo su http://127.0.0.1:${PORT}`);
  });
}

/**
 * Configurazione degli handler IPC per la comunicazione con React via Electron contextBridge.
 */
function setupIpcHandlers() {
  ipcMain.handle('config:get', () => {
    return configManager.getConfig();
  });

  ipcMain.handle('mixer:get-apps', () => {
    return serialHandler.getApps();
  });

  ipcMain.handle('mixer:select', (_event, { index }) => {
    return serialHandler.selectAppByIndex(index);
  });

  ipcMain.handle('mixer:set-volume', (_event, { index, pct }) => {
    return serialHandler.setAppVolume(index, pct);
  });

  ipcMain.handle('mixer:set-mute', (_event, { index, mute }) => {
    return serialHandler.setAppMute(index, mute);
  });

  ipcMain.handle('config:save', (_event, newConfig) => {
    return configManager.saveConfig(newConfig);
  });

  ipcMain.handle('hardware:list-ports', async () => {
    if (!hardware) return [];
    return await hardware.listDevices();
  });

  ipcMain.handle('hardware:connect', async (_event, { portPath, baudRate }) => {
    if (!hardware) return { success: false, error: 'Hardware listener non inizializzato' };
    try {
      await hardware.connect(portPath, { baudRate: baudRate || 9600 });
      const cfg = configManager.getConfig();
      cfg.serial = { ...cfg.serial, port: portPath, baudRate: baudRate || 9600 };
      configManager.saveConfig(cfg);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('hardware:disconnect', async () => {
    if (hardware) {
      await hardware.disconnect();
    }
    return { success: true };
  });

  ipcMain.handle('hardware:get-status', () => {
    return {
      connected: hardware ? hardware.isConnected() : false,
      port: hardware ? hardware.currentPort : null
    };
  });

  ipcMain.handle('action:test', async (_event, action) => {
    return await ActionDispatcher.execute(action);
  });
}

// Inizializzazione dell'app Electron
app.whenReady().then(() => {
  createTray();
  createWindow();
  setupIpcHandlers();
  setupHttpBridge();
  setupHardware();

  console.log('[Main] Applicazione avviata con successo.');
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

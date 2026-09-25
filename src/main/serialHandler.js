// src/main/serialHandler.js
// Serial communication handler for per‑app volume mixer feature.
// Uses @serialport and @serialport/parser-readline to communicate with the Arduino.
// Parses commands from Arduino and interacts with the optional `native-sound-mixer` package.

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

// Optional native-sound-mixer import – requires native build tools on some systems.
let SoundMixer = null;
let DeviceType = null;
try {
  const nativeMixer = require('native-sound-mixer');
  SoundMixer = nativeMixer.default || nativeMixer.SoundMixer || nativeMixer;
  DeviceType = nativeMixer.DeviceType;
  console.log('[SerialHandler] native-sound-mixer loaded successfully');
} catch (err) {
  console.warn('[SerialHandler] native-sound-mixer not installed – mixer functionality disabled');
  console.warn('[SerialHandler]', err.message);
}

let port = null;
let selectedSession = null;
let selectedRef = null;

/**
 * Sends a line terminated by "\n" to the Arduino via the global hardware listener.
 * @param {string} line
 */
function sendLine(line) {
  if (global.hardware && typeof global.hardware.sendLine === 'function') {
    global.hardware.sendLine(line);
  } else {
    console.warn('[SerialHandler] No hardware sendLine available');
  }
}

/**
 * Handles a command received from the Arduino.
 * @param {string} cmd
 */
async function handleCommand(cmd) {
  console.log('[SerialHandler] Received:', cmd);

  // ---- GET apps ----
  if (cmd === 'CMD:GET_MIXER_APPS') {
    if (!SoundMixer || !DeviceType) {
      console.warn('[SerialHandler] Mixer not available – sending mock list');
      sendLine('MIXER_LIST:MockApp');
      return;
    }
    try {
      const device = SoundMixer.getDefaultDevice(DeviceType.RENDER);
      if (!device) {
        sendLine('MIXER_ERR:NO_DEVICE');
        return;
      }
      const names = device.sessions
        .map(s => s.name)
        .filter(Boolean)
        .slice(0, 5);
      if (names.length === 0) {
        sendLine('MIXER_LIST:NoApps');
      } else {
        sendLine(`MIXER_LIST:${names.join('|')}`);
      }
    } catch (err) {
      console.error('[SerialHandler] Mixer error:', err);
      sendLine('MIXER_ERR:GET_FAILED');
    }
    return;
  }

  // ---- SELECT app ----
  if (cmd.startsWith('CMD:SELECT_APP:')) {
    const appName = cmd.substring('CMD:SELECT_APP:'.length);
    if (!SoundMixer || !DeviceType) {
      // Mock: create a dummy session object
      selectedSession = {
        name: appName,
        _vol: 0.5,
        get volume() { return this._vol; },
        set volume(v) { this._vol = v; }
      };
      sendLine(`MIXER_SELECTED:${appName}`);
      return;
    }
    try {
      const device = SoundMixer.getDefaultDevice(DeviceType.RENDER);
      if (!device) {
        sendLine('MIXER_ERR:NO_DEVICE');
        return;
      }
      const session = device.sessions.find(s => s.name === appName);
      if (session) {
        selectedSession = session;
        selectedRef = { index: device.sessions.indexOf(session), label: appName };
        sendLine(`MIXER_SELECTED:${appName}`);
      } else {
        sendLine('MIXER_ERR:NotFound');
      }
    } catch (err) {
      console.error('[SerialHandler] Select error:', err);
      sendLine('MIXER_ERR:SELECT_FAILED');
    }
    return;
  }

  // ---- Volume up/down ----
  if (cmd === 'CMD:VOL_UP' || cmd === 'CMD:VOL_DOWN') {
    if (!selectedSession) {
      sendLine('MIXER_ERR:NO_SELECTION');
      return;
    }
    try {
      const step = 0.05; // 5% step (native-sound-mixer uses 0.0–1.0 range)
      let vol = selectedSession.volume;
      if (cmd === 'CMD:VOL_UP') {
        vol = Math.min(1.0, vol + step);
      } else {
        vol = Math.max(0.0, vol - step);
      }
      selectedSession.volume = vol;
      const pct = Math.round(vol * 100);
      sendLine(`MIXER_VOL:${selectedSession.name}|${pct}`);
    } catch (err) {
      console.error('[SerialHandler] Volume error:', err);
      sendLine('MIXER_ERR:VOL_FAILED');
    }
    return;
  }

  console.warn('[SerialHandler] Unknown command:', cmd);
}

/**
 * Initializes the serial port using configuration from ConfigManager.
 */
function initSerial() {
  const configManager = require('./ConfigManager');
  const cfg = configManager.getConfig();
  if (!cfg.serial || !cfg.serial.port) {
    console.warn('[SerialHandler] No serial port configured. Skipping init.');
    return;
  }
  port = new SerialPort({
    path: cfg.serial.port,
    baudRate: cfg.serial.baudRate || 9600,
    autoOpen: false,
  });

  const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
  parser.on('data', handleCommand);

  port.on('open', () => console.log('[SerialHandler] Port opened', cfg.serial.port));
  port.on('error', err => console.error('[SerialHandler] Port error', err));
  port.on('close', () => console.log('[SerialHandler] Port closed'));

  port.open(err => {
    if (err) {
      console.error('[SerialHandler] Failed to open port:', err.message);
    }
  });
}

function getRenderDevice() {
  if (!SoundMixer || !DeviceType) {
    throw new Error('Mixer Windows non disponibile');
  }
  const device = SoundMixer.getDefaultDevice(DeviceType.RENDER);
  if (!device) {
    throw new Error('Nessun dispositivo di uscita attivo');
  }
  return device;
}

function labelForSession(session, index) {
  const name = typeof session.name === 'string' ? session.name.trim() : '';
  if (name) return name;
  const appName = typeof session.appName === 'string' ? session.appName.trim() : '';
  if (appName) {
    const file = appName.split(/[\\/]/).pop();
    const base = file ? file.replace(/\.exe$/i, '') : '';
    if (base) return base;
  }
  return `Sessione #${index + 1}`;
}

const EXPIRED_STATE = SoundMixer && SoundMixer.AudioSessionState
  ? SoundMixer.AudioSessionState.EXPIRED
  : 2;

function isHiddenSession(session) {
  const name = typeof session.name === 'string' ? session.name.trim() : '';
  const appName = typeof session.appName === 'string' ? session.appName.trim() : '';
  if (!name && !appName) return true;
  if (session.state === EXPIRED_STATE) return true;
  return false;
}

function indexOfSelection(sessions) {
  if (!selectedRef) return null;
  const at = sessions[selectedRef.index];
  if (at && !isHiddenSession(at) && labelForSession(at, selectedRef.index) === selectedRef.label) {
    return selectedRef.index;
  }
  let fallback = null;
  for (let i = 0; i < sessions.length; i += 1) {
    if (isHiddenSession(sessions[i])) continue;
    if (labelForSession(sessions[i], i) === selectedRef.label && fallback === null) {
      fallback = i;
    }
  }
  return fallback;
}

function getApps() {
  try {
    const device = getRenderDevice();
    const sessions = device.sessions || [];
    const apps = [];
    sessions.forEach((session, rawIndex) => {
      if (isHiddenSession(session)) return;
      const raw = Number(session.volume);
      const safe = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
      apps.push({
        index: rawIndex,
        label: labelForSession(session, apps.length),
        pct: Math.round(safe * 100),
        mute: session.mute === true
      });
    });
    return { success: true, deviceName: device.name, apps, selectedIndex: indexOfSelection(sessions) };
  } catch (err) {
    console.error('[SerialHandler] getApps:', err.message);
    return { success: false, error: err.message, apps: [], selectedIndex: null };
  }
}

function selectAppByIndex(index) {
  try {
    const sessions = getRenderDevice().sessions || [];
    const session = sessions[index];
    if (!session || isHiddenSession(session)) {
      return { success: false, error: 'App non trovata' };
    }
    selectedSession = session;
    selectedRef = { index, label: labelForSession(session, index) };
    const raw = Number(session.volume);
    const safe = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
    return {
      success: true,
      index,
      label: selectedRef.label,
      pct: Math.round(safe * 100),
      mute: session.mute === true
    };
  } catch (err) {
    console.error('[SerialHandler] selectAppByIndex:', err.message);
    return { success: false, error: err.message };
  }
}

function setAppVolume(index, pct) {
  try {
    const sessions = getRenderDevice().sessions || [];
    const session = sessions[index];
    if (!session || isHiddenSession(session)) return { success: false, error: 'App non trovata' };
    const value = Number(pct);
    if (!Number.isFinite(value)) return { success: false, error: 'Valore volume non valido' };
    session.volume = Math.min(100, Math.max(0, Math.round(value))) / 100;
    return { success: true, pct: Math.round(session.volume * 100) };
  } catch (err) {
    console.error('[SerialHandler] setAppVolume:', err.message);
    return { success: false, error: err.message };
  }
}

function setAppMute(index, mute) {
  try {
    const sessions = getRenderDevice().sessions || [];
    const session = sessions[index];
    if (!session || isHiddenSession(session)) return { success: false, error: 'App non trovata' };
    session.mute = mute === true;
    return { success: true, mute: session.mute };
  } catch (err) {
    console.error('[SerialHandler] setAppMute:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { initSerial, sendLine, handleCommand, getApps, selectAppByIndex, setAppVolume, setAppMute };

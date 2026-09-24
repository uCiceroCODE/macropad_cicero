// test/mixer-interactive.js
// Interactive CLI tool to test per-app volume mixer without Arduino/OLED.
// Run with: node test/mixer-interactive.js
//
// Controls:
//   L = List apps (CMD:GET_MIXER_APPS)
//   1-5 = Select app by number
//   + / = = Volume UP
//   - = Volume DOWN
//   Q = Quit

const path = require('path');
process.chdir(path.resolve(__dirname, '..'));

// Mock hardware sendLine → just print
global.hardware = {
  sendLine(line) {
    // We parse the response here to show it nicely
  }
};

const { handleCommand } = require('../src/main/serialHandler');

let appList = [];
let selectedApp = null;
let currentVol = null;

// Override sendLine to capture and display results
const originalSendLine = global.hardware.sendLine;
global.hardware.sendLine = function(line) {
  if (line.startsWith('MIXER_LIST:')) {
    const names = line.substring('MIXER_LIST:'.length).split('|').filter(Boolean);
    appList = names;
    console.log('\n╔══════════════════════════════════════╗');
    console.log('║        🎵 APP AUDIO ATTIVE           ║');
    console.log('╠══════════════════════════════════════╣');
    names.forEach((name, i) => {
      const sel = (name === selectedApp) ? ' ◄' : '';
      console.log(`║  [${i + 1}] ${name.padEnd(28)}${sel}   ║`);
    });
    console.log('╚══════════════════════════════════════╝');
    console.log('  Premi 1-5 per selezionare un\'app');
  } else if (line.startsWith('MIXER_SELECTED:')) {
    selectedApp = line.substring('MIXER_SELECTED:'.length);
    console.log(`\n  ✅ Selezionata: ${selectedApp}`);
    console.log('  Usa + / - per cambiare il volume');
  } else if (line.startsWith('MIXER_VOL:')) {
    const parts = line.substring('MIXER_VOL:'.length).split('|');
    const name = parts[0];
    const vol = parseInt(parts[1]);
    currentVol = vol;
    // Draw a volume bar
    const barLen = 30;
    const filled = Math.round(vol / 100 * barLen);
    const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);
    console.log(`\n  🔊 ${name}: [${bar}] ${vol}%`);
  } else if (line.startsWith('MIXER_ERR:')) {
    console.log(`\n  ❌ Errore: ${line}`);
  } else {
    console.log(`\n  📡 ${line}`);
  }
};

function showHelp() {
  console.log('\n┌──────────────────────────────────────┐');
  console.log('│  🎛️  MACRO PAD - MIXER TEST CLI      │');
  console.log('├──────────────────────────────────────┤');
  console.log('│  L     = Lista app audio             │');
  console.log('│  1-5   = Seleziona app               │');
  console.log('│  + / = = Volume SU  (+5%)            │');
  console.log('│  -     = Volume GIÙ (-5%)            │');
  console.log('│  Q     = Esci                        │');
  console.log('└──────────────────────────────────────┘');
}

// Set up raw keyboard input
const readline = require('readline');
readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}

showHelp();
console.log('\n  Premi L per iniziare...\n');

process.stdin.on('keypress', async (str, key) => {
  if (key.ctrl && key.name === 'c') {
    console.log('\n  Bye! 👋');
    process.exit();
  }

  const ch = (str || '').toLowerCase();

  if (ch === 'q') {
    console.log('\n  Bye! 👋');
    process.exit();
  }

  if (ch === 'l') {
    await handleCommand('CMD:GET_MIXER_APPS');
  } else if (ch >= '1' && ch <= '5') {
    const idx = parseInt(ch) - 1;
    if (idx < appList.length) {
      await handleCommand(`CMD:SELECT_APP:${appList[idx]}`);
    } else {
      console.log(`\n  ⚠️  App #${ch} non disponibile. Premi L per aggiornare la lista.`);
    }
  } else if (ch === '+' || ch === '=') {
    if (!selectedApp) {
      console.log('\n  ⚠️  Nessuna app selezionata. Premi L poi 1-5.');
    } else {
      await handleCommand('CMD:VOL_UP');
    }
  } else if (ch === '-') {
    if (!selectedApp) {
      console.log('\n  ⚠️  Nessuna app selezionata. Premi L poi 1-5.');
    } else {
      await handleCommand('CMD:VOL_DOWN');
    }
  } else if (ch === 'h') {
    showHelp();
  }
});

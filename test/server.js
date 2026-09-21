const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const { exec } = require('child_process');

// Puoi impostare la porta con SERIAL_PORT=COM4 oppure: node server.js COM4
const PORT_NAME = process.env.SERIAL_PORT || process.argv[2] || 'COM3';

const port = new SerialPort({ path: PORT_NAME, baudRate: 9600 });
const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

port.on('open', () => {
  console.log(`[PC] In ascolto sulla porta ${PORT_NAME}... Premi il pulsante su Arduino!`);
});

port.on('error', (error) => {
  console.error(`[PC] Impossibile aprire ${PORT_NAME}: ${error.message}`);
  if (error.message.includes('Access denied')) {
    console.error('[PC] Chiudi il Monitor Seriale/Serial Plotter di Arduino IDE e riprova.');
  } else {
    console.error('[PC] Controlla la porta indicata in Arduino IDE e avvia con: node server.js COMx');
  }
  process.exitCode = 1;
});

parser.on('data', (data) => {
  const comando = data.trim();
  console.log(`[PC] Ricevuto da Arduino: ${comando}`);

  if (comando === 'TASTO_1_PREMUTO') {
    eseguiAzione();
  }
});

function eseguiAzione() {
  console.log('[PC] Esecuzione azione in corso...');

  // --- OPZIONE 1: Aprire un'applicazione Windows (es. Calcolatrice / Notepad / VS Code) ---
  exec('start calc.exe');

  // --- OPZIONE 2: Eseguire uno script Bash tramite WSL ---
  // exec('wsl bash -c "echo Hello from WSL! && date"');

  // --- OPZIONE 3: Eseguire uno script PowerShell ---
  // exec('powershell -Command "Write-Host Hello from PowerShell!"');
}
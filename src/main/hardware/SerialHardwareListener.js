const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const BaseHardwareListener = require('./BaseHardwareListener');

/**
 * FASE 1: Listener Hardware per Porta Seriale (Arduino UNO R3 / Nano / Mega).
 * Comunica via porta COM a 9600 baud (o configurabile), ricevendo stringhe
 * come "BTN_1_PRESSED" o "TASTO_1_PREMUTO".
 */
class SerialHardwareListener extends BaseHardwareListener {
  constructor() {
    super();
    this.port = null;
    this.parser = null;
    this.reconnectTimer = null;
    this.desiredPortPath = null;
    this.desiredBaudRate = 9600;
  }

  /**
   * Elenca tutte le porte seriali disponibili nel sistema.
   */
  async listDevices() {
    try {
      const ports = await SerialPort.list();
      return ports.map(p => ({
        path: p.path,
        manufacturer: p.manufacturer || 'Sconosciuto',
        serialNumber: p.serialNumber || '',
        friendlyName: p.friendlyName || p.path
      }));
    } catch (err) {
      console.error('[SerialHardware] Errore durante listDevices:', err);
      return [];
    }
  }

  /**
   * Connette alla porta seriale specificata.
   * @param {string} portPath - Es. "COM3" o "/dev/ttyACM0"
   * @param {object} options - { baudRate: 9600 }
   */
  async connect(portPath, options = {}) {
    this.desiredPortPath = portPath;
    this.desiredBaudRate = options.baudRate || 9600;

    // Chiudi eventuale connessione precedente
    if (this.port && this.port.isOpen) {
      await this.disconnect();
    }

    return new Promise((resolve, reject) => {
      try {
        this.port = new SerialPort({
          path: portPath,
          baudRate: this.desiredBaudRate,
          autoOpen: false
        });

        this.parser = this.port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

        this.port.on('open', () => {
          this.connected = true;
          this.currentPort = portPath;
          console.log(`[SerialHardware] Connesso a ${portPath} (${this.desiredBaudRate} baud)`);
          this.emit('status', {
            connected: true,
            port: portPath,
            message: `Connesso a ${portPath}`
          });
          resolve(true);
        });

        this.port.on('error', (err) => {
          console.error(`[SerialHardware] Errore porta ${portPath}:`, err.message);
          this.connected = false;
          this.emit('status', {
            connected: false,
            port: portPath,
            error: err.message
          });
          this.emit('error', err);
          // Se la promise non è ancora risolta:
          if (!this.port.isOpen) {
            reject(err);
          }
        });

        this.port.on('close', () => {
          console.log(`[SerialHardware] Porta ${portPath} chiusa.`);
          this.connected = false;
          this.emit('status', {
            connected: false,
            port: portPath,
            message: `Disconnesso da ${portPath}`
          });
        });

        // Parser dei dati in arrivo
        this.parser.on('data', (rawLine) => {
          const line = rawLine.toString().trim();
          if (!line) return;

          console.log(`[SerialHardware] Ricevuto: "${line}"`);
          // Forward mixer commands directly
          if (line.startsWith('CMD:')) {
            this.emit('mixer-cmd', line);
            return;
          }
          const keyId = this.parseKeyFromLine(line);

          if (keyId) {
            this.emit('key-pressed', {
              keyId: String(keyId),
              raw: line,
              timestamp: Date.now()
            });
          }
        });

        this.port.open((err) => {
          if (err) {
            this.connected = false;
            reject(err);
          }
        });
      } catch (err) {
        this.connected = false;
        reject(err);
      }
    });
  }

  /**
   * Estrae l'identificativo del tasto dalla riga ricevuta.
   * Supporta formati come:
   * - "BTN_1_PRESSED" -> "1"
   * - "TASTO_1_PREMUTO" -> "1"
   * - "BTN_A_PRESSED" -> "A"
   * - "KEY_3" -> "3"
   * - "1" -> "1"
   */
  parseKeyFromLine(line) {
    // 1. Regex per prefissi BTN / TASTO / KEY
    const matchNamed = line.match(/(?:BTN|TASTO|KEY)[-_]?([0-9a-zA-Z]+)(?:[-_]?(?:PRESSED|PREMUTO))?/i);
    if (matchNamed && matchNamed[1]) {
      return matchNamed[1];
    }

    // 2. Stringa numerica diretta (es. "1", "2")
    const matchDirect = line.match(/^([0-9a-zA-Z]+)$/);
    if (matchDirect && matchDirect[1]) {
      return matchDirect[1];
    }

    return null;
  }

  /**
   * Disconnette la porta seriale corrente.
   */
  async disconnect() {
    return new Promise((resolve) => {
      if (!this.port) {
        this.connected = false;
        return resolve();
      }

      if (this.port.isOpen) {
        this.port.close(() => {
          this.connected = false;
          this.port = null;
          this.parser = null;
          resolve();
        });
      } else {
        this.connected = false;
        this.port = null;
        this.parser = null;
        resolve();
      }
    });
  }
}

  // Sends a line to Arduino via serial port
  SerialHardwareListener.prototype.sendLine = function(line) {
    if (this.port && this.port.isOpen) {
      this.port.write(`${line}\n`);
      console.log(`[SerialHardware] Sent: ${line}`);
    } else {
      console.warn('[SerialHardware] Cannot send, port not open');
    }
  };

module.exports = SerialHardwareListener;

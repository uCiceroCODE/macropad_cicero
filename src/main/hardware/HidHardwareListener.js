const BaseHardwareListener = require('./BaseHardwareListener');

/**
 * FASE 2 (Futura - Produzione): Listener Hardware per USB RAW HID (RP2040, ATmega32u4).
 * Riceve pacchetti binari di 64 byte direttamente dal controller via USB HID.
 *
 * Per attivarla in produzione:
 * 1. Installare 'node-hid': npm install node-hid
 * 2. Istanziare HidHardwareListener in main.js al posto di SerialHardwareListener
 */
class HidHardwareListener extends BaseHardwareListener {
  constructor(vendorId = 0xcafe, productId = 0x4000) {
    super();
    this.vendorId = vendorId;
    this.productId = productId;
    this.device = null;
    this.hidModule = null;

    // Tentativo di caricamento dinamico se disponibile
    try {
      this.hidModule = require('node-hid');
    } catch {
      this.hidModule = null;
    }
  }

  /**
   * Elenca tutti i dispositivi USB HID compatibili.
   */
  async listDevices() {
    if (!this.hidModule) {
      console.warn('[HidHardware] Modulo "node-hid" non ancora installato. Disponibile per Fase 2.');
      return [];
    }

    try {
      const devices = this.hidModule.devices();
      return devices.map(d => ({
        path: d.path,
        vendorId: d.vendorId,
        productId: d.productId,
        manufacturer: d.manufacturer || 'Custom HID Device',
        product: d.product || 'Macro Pad (USB Raw HID)',
        friendlyName: `${d.product || 'Macro Pad'} (VID:${d.vendorId.toString(16)} PID:${d.productId.toString(16)})`
      }));
    } catch (err) {
      console.error('[HidHardware] Errore elenco dispositivi HID:', err);
      return [];
    }
  }

  /**
   * Connette al dispositivo USB Raw HID specificato.
   * @param {string|object} devicePathOrInfo - Percorso del dispositivo o { vendorId, productId }
   */
  async connect(devicePathOrInfo) {
    if (!this.hidModule) {
      throw new Error('Modulo "node-hid" non installato. Esegui "npm install node-hid" per la Fase 2.');
    }

    if (this.device) {
      await this.disconnect();
    }

    return new Promise((resolve, reject) => {
      try {
        if (typeof devicePathOrInfo === 'string') {
          this.device = new this.hidModule.HID(devicePathOrInfo);
        } else {
          const vid = devicePathOrInfo?.vendorId || this.vendorId;
          const pid = devicePathOrInfo?.productId || this.productId;
          this.device = new this.hidModule.HID(vid, pid);
        }

        this.connected = true;
        this.currentPort = typeof devicePathOrInfo === 'string' ? devicePathOrInfo : 'USB-HID';

        this.emit('status', {
          connected: true,
          port: this.currentPort,
          message: 'Connesso a Macro Pad USB Raw HID'
        });

        // Gestione pacchetti binari a 64 byte
        this.device.on('data', (buffer) => {
          this.handleRawHidPacket(buffer);
        });

        this.device.on('error', (err) => {
          console.error('[HidHardware] Errore HID:', err);
          this.connected = false;
          this.emit('status', { connected: false, error: err.message });
          this.emit('error', err);
        });

        resolve(true);
      } catch (err) {
        this.connected = false;
        reject(err);
      }
    });
  }

  /**
   * Decodifica il pacchetto binario da 64 byte ricevuto dal firmware USB HID.
   * Esempio di struttura pacchetto:
   * [0]: Report ID (es. 0x01)
   * [1]: Key ID (es. 1, 2, 3...)
   * [2]: State (0x01 = Pressed, 0x00 = Released)
   * [3..63]: Dati accessori o CRC
   */
  handleRawHidPacket(buffer) {
    if (!buffer || buffer.length < 2) return;

    const reportId = buffer[0];
    const keyId = buffer[1];
    const state = buffer.length > 2 ? buffer[2] : 1;

    console.log(`[HidHardware] Ricevuto pacchetto HID (${buffer.length} byte): Key=${keyId}, State=${state}`);

    // Consideriamo l'evento di pressione (state === 1 o senza stato)
    if (state === 1 && keyId > 0) {
      this.emit('key-pressed', {
        keyId: String(keyId),
        raw: buffer.toString('hex'),
        timestamp: Date.now()
      });
    }
  }

  /**
   * Disconnette il dispositivo HID.
   */
  async disconnect() {
    if (this.device) {
      try {
        this.device.close();
      } catch (err) {
        console.warn('[HidHardware] Chiusura dispositivo:', err.message);
      }
      this.device = null;
      this.connected = false;
      this.emit('status', { connected: false, message: 'Dispositivo HID disconnesso' });
    }
  }
}

module.exports = HidHardwareListener;

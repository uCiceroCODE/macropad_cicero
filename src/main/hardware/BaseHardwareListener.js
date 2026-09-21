const EventEmitter = require('events');

/**
 * Classe astratta/base per i listener hardware del Macro Pad.
 * Permette di disaccoppiare la logica dell'applicazione dal tipo di connessione fisica
 * (Seriale Arduino, USB Raw HID con RP2040/ATmega32u4, Bluetooth, ecc.).
 *
 * Eventi emessi:
 * - 'key-pressed': { keyId: string, raw: string, timestamp: number }
 * - 'status': { connected: boolean, port?: string, message?: string, error?: string }
 * - 'error': Error
 */
class BaseHardwareListener extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.currentPort = null;
  }

  /**
   * Restituisce l'elenco dei dispositivi/porte disponibili nel sistema.
   * @returns {Promise<Array<{ path: string, manufacturer?: string, friendlyName?: string }>>}
   */
  async listDevices() {
    throw new Error('Il metodo listDevices() deve essere implementato nella sottoclasse');
  }

  /**
   * Connette il listener al dispositivo hardware.
   * @param {string} deviceIdentifier - Es. 'COM3' per seriale o VendorID:ProductID per HID
   * @param {object} options - Opzioni aggiuntive (es. baudRate)
   * @returns {Promise<boolean>}
   */
  async connect(deviceIdentifier, options = {}) {
    throw new Error('Il metodo connect() deve essere implementato nella sottoclasse');
  }

  /**
   * Disconnette il dispositivo hardware.
   * @returns {Promise<void>}
   */
  async disconnect() {
    throw new Error('Il metodo disconnect() deve essere implementato nella sottoclasse');
  }

  /**
   * Restituisce se l'hardware è attualmente connesso.
   * @returns {boolean}
   */
  isConnected() {
    return this.connected;
  }
}

module.exports = BaseHardwareListener;

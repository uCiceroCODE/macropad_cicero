const fs = require('fs');
const path = require('path');
const { app } = require('electron');

/**
 * Gestore della configurazione locale (config.json) con supporto a profili/template multipli
 * e abilitazione/disabilitazione dei singoli tasti.
 */
class ConfigManager {
  constructor() {
    const rootPath = path.resolve(__dirname, '../../config.json');
    const userDataPath = app ? path.join(app.getPath('userData'), 'config.json') : null;

    if (fs.existsSync(rootPath)) {
      this.configPath = rootPath;
    } else if (userDataPath && fs.existsSync(userDataPath)) {
      this.configPath = userDataPath;
    } else {
      this.configPath = rootPath;
    }

    this.defaultProfile = {
      id: 'default',
      name: 'Standard / Generale',
      keyOrder: ['1', '2', '3', '4'],
      keys: {
        "1": { type: "KEY", value: "Ctrl+C", label: "Copia", enabled: true },
        "2": { type: "TEXT", value: "ciao@email.com", label: "Email Rapida", enabled: true },
        "3": { type: "APP", value: "calc.exe", label: "Calcolatrice", enabled: true },
        "4": { type: "URL", value: "https://github.com", label: "GitHub", enabled: true }
      }
    };

    this.defaultConfig = {
      serial: {
        port: 'COM3',
        baudRate: 9600,
        autoConnect: true
      },
      activeProfile: 'default',
      profiles: {
        'default': this.defaultProfile
      }
    };

    this.config = this.loadConfig();
  }

  /**
   * Carica la configurazione da file o la migra se nel vecchio formato flat.
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw);

        let profiles = parsed.profiles;
        let activeProfile = parsed.activeProfile || 'default';

        // Migrazione se config.json era nel vecchio formato (senza profiles)
        if (!profiles || typeof profiles !== 'object' || Object.keys(profiles).length === 0) {
          const oldKeys = parsed.keys || this.defaultProfile.keys;
          const oldOrder = parsed.keyOrder || Object.keys(oldKeys);

          // Assicura che ogni tasto abbia enabled: true
          Object.values(oldKeys).forEach(k => {
            if (k.enabled === undefined) k.enabled = true;
          });

          profiles = {
            'default': {
              id: 'default',
              name: 'Standard / Generale',
              keyOrder: oldOrder,
              keys: oldKeys
            }
          };
          activeProfile = 'default';
        } else {
          // Assicura proprietà enabled su tutti i tasti dei profili
          Object.values(profiles).forEach(prof => {
            if (!prof.keyOrder) prof.keyOrder = Object.keys(prof.keys || {});
            Object.values(prof.keys || {}).forEach(k => {
              if (k.enabled === undefined) k.enabled = true;
            });
          });
        }

        // Se activeProfile non esiste tra i profili, seleziona il primo disponibile
        if (!profiles[activeProfile]) {
          activeProfile = Object.keys(profiles)[0];
        }

        this.config = {
          serial: { ...this.defaultConfig.serial, ...(parsed.serial || {}) },
          activeProfile,
          profiles
        };
        return this.config;
      }
    } catch (err) {
      console.error('[ConfigManager] Errore lettura config.json, uso configurazione default:', err.message);
    }

    this.config = JSON.parse(JSON.stringify(this.defaultConfig));
    this.saveConfig(this.config);
    return this.config;
  }

  /**
   * Salva la nuova configurazione su disco.
   * @param {object} newConfig 
   */
  saveConfig(newConfig) {
    try {
      const activeProfile = newConfig.activeProfile || this.config?.activeProfile || 'default';
      const profiles = newConfig.profiles || this.config?.profiles || this.defaultConfig.profiles;

      this.config = {
        serial: { ...(this.config?.serial || {}), ...(newConfig.serial || {}) },
        activeProfile,
        profiles
      };

      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
      console.log(`[ConfigManager] Configurazione salvata con successo in ${this.configPath}`);
      return { success: true, config: this.config };
    } catch (err) {
      console.error('[ConfigManager] Errore salvataggio config.json:', err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Restituisce la configurazione in memoria.
   */
  getConfig() {
    return this.config || this.loadConfig();
  }

  /**
   * Restituisce il profilo attualmente attivo.
   */
  getActiveProfile() {
    this.loadConfig();
    const activeId = this.config?.activeProfile || 'default';
    return this.config?.profiles?.[activeId] || Object.values(this.config?.profiles || {})[0] || null;
  }

  /**
   * Recupera l'azione associata a un determinato keyId (es. "1", "2")
   * nel profilo attualmente attivo. Se il tasto è disabilitato (enabled: false), restituisce null.
   * @param {string|number} keyId 
   */
  getKeyAction(keyId) {
    this.loadConfig();
    const id = String(keyId);
    const profile = this.getActiveProfile();

    if (!profile || !profile.keys) {
      console.warn(`[ConfigManager] Nessun profilo o tasti trovati per il keyId "${id}"`);
      return null;
    }

    const action = profile.keys[id];
    if (!action) {
      console.warn(`[ConfigManager] Tasto "${id}" non presente nel profilo attivo "${profile.name}"`);
      return null;
    }

    // Controllo abilitazione
    if (action.enabled === false) {
      console.log(`[ConfigManager] Tasto "${id}" premuto ma DISABILITATO nel profilo "${profile.name}". Azione ignorata.`);
      return null;
    }

    console.log(`[ConfigManager] Azione letta per keyId "${id}" [Profilo: ${profile.name}]:`, action);
    return action;
  }
}

module.exports = new ConfigManager();

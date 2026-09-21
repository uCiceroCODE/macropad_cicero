const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload script per esporre API sicure al renderer React
 * attraverso contextBridge.
 */
contextBridge.exposeInMainWorld('macroPadAPI', {
  // Configurazione
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (newConfig) => ipcRenderer.invoke('config:save', newConfig),

  // Hardware / Seriale
  listSerialPorts: () => ipcRenderer.invoke('hardware:list-ports'),
  connectSerialPort: (portPath, baudRate) =>
    ipcRenderer.invoke('hardware:connect', { portPath, baudRate }),
  disconnectSerialPort: () => ipcRenderer.invoke('hardware:disconnect'),
  getHardwareStatus: () => ipcRenderer.invoke('hardware:get-status'),

  // Azioni & Testing
  testAction: (action) => ipcRenderer.invoke('action:test', action),

  // Eventi dal Main Process verso React
  onKeyPressed: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('hardware:key-pressed', subscription);
    return () => ipcRenderer.removeListener('hardware:key-pressed', subscription);
  },

  onHardwareStatus: (callback) => {
    const subscription = (_event, data) => callback(data);
    ipcRenderer.on('hardware:status', subscription);
    return () => ipcRenderer.removeListener('hardware:status', subscription);
  }
});

import React, { useState, useEffect, useRef, useCallback } from 'react';

// Client API unificato: usa IPC se in Electron, altrimenti HTTP su localhost:5174 se aperto nel browser (Firefox/Chrome)
const createApiClient = () => {
  if (typeof window !== 'undefined' && window.macroPadAPI) {
    return {
      type: 'electron',
      getConfig: () => window.macroPadAPI.getConfig(),
      saveConfig: (cfg) => window.macroPadAPI.saveConfig(cfg),
      listSerialPorts: () => window.macroPadAPI.listSerialPorts(),
      connectSerialPort: (port, baud) => window.macroPadAPI.connectSerialPort(port, baud),
      disconnectSerialPort: () => window.macroPadAPI.disconnectSerialPort(),
      getHardwareStatus: () => window.macroPadAPI.getHardwareStatus(),
      testAction: (act) => window.macroPadAPI.testAction(act),
      onKeyPressed: (cb) => window.macroPadAPI.onKeyPressed(cb),
      onHardwareStatus: (cb) => window.macroPadAPI.onHardwareStatus(cb)
    };
  }

  // Fallback HTTP/SSE per browser web (es. Firefox su localhost:5173)
  const HTTP_BASE = 'http://localhost:5174/api';
  return {
    type: 'web',
    getConfig: async () => {
      const r = await fetch(`${HTTP_BASE}/config`);
      return await r.json();
    },
    saveConfig: async (cfg) => {
      const r = await fetch(`${HTTP_BASE}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg)
      });
      return await r.json();
    },
    listSerialPorts: async () => {
      const r = await fetch(`${HTTP_BASE}/ports`);
      return await r.json();
    },
    connectSerialPort: async (portPath, baudRate) => {
      const r = await fetch(`${HTTP_BASE}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portPath, baudRate })
      });
      return await r.json();
    },
    disconnectSerialPort: async () => {
      const r = await fetch(`${HTTP_BASE}/disconnect`, { method: 'POST' });
      return await r.json();
    },
    getHardwareStatus: async () => {
      const r = await fetch(`${HTTP_BASE}/status`);
      return await r.json();
    },
    testAction: async (action) => {
      const r = await fetch(`${HTTP_BASE}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action)
      });
      return await r.json();
    },
    onKeyPressed: (cb) => {
      const eventSource = new EventSource(`${HTTP_BASE}/events`);
      eventSource.addEventListener('hardware:key-pressed', (e) => {
        try {
          cb(JSON.parse(e.data));
        } catch (err) {
          console.error('Errore parsing SSE key-pressed:', err);
        }
      });
      return () => eventSource.close();
    },
    onHardwareStatus: (cb) => {
      const eventSource = new EventSource(`${HTTP_BASE}/events`);
      eventSource.addEventListener('hardware:status', (e) => {
        try {
          cb(JSON.parse(e.data));
        } catch (err) {
          console.error('Errore parsing SSE status:', err);
        }
      });
      return () => eventSource.close();
    }
  };
};

const api = createApiClient();

const COMMON_KEYS = [
  'Ctrl+C', 'Ctrl+V', 'Ctrl+Z', 'Ctrl+Y', 'Alt+Tab', 'Win+D',
  'Enter', 'Esc', 'Space', 'Volume_Up', 'Volume_Down', 'Mute',
  'PlayPause', 'F5', 'F11', 'F12', 'F13'
];

const COMMON_CHARS = ['~', '€', '@', '#', '$', '\\', '|', '{', '}', '[', ']', '`'];

export default function App() {
  const [config, setConfig] = useState({
    serial: { port: '', baudRate: 9600 },
    activeProfile: 'default',
    profiles: {
      default: {
        id: 'default',
        name: 'Standard / Generale',
        keyOrder: ['1', '2', '3', '4'],
        keys: {}
      }
    }
  });

  const [selectedKeyId, setSelectedKeyId] = useState('1');
  const [ports, setPorts] = useState([]);
  const [selectedPort, setSelectedPort] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [activePressedKey, setActivePressedKey] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [saveStatus, setSaveStatus] = useState('saved'); // 'saved', 'saving', 'error'
  const [statusMessage, setStatusMessage] = useState('Inizializzazione...');
  const [lastEvent, setLastEvent] = useState(null);

  // Drag & Drop states
  const [draggedKeyId, setDraggedKeyId] = useState(null);
  const [dragOverKeyId, setDragOverKeyId] = useState(null);

  const autoSaveTimerRef = useRef(null);

  // Profilo corrente attivo
  const activeProfileId = config.activeProfile || Object.keys(config.profiles || {})[0] || 'default';
  const currentProfile = (config.profiles && config.profiles[activeProfileId]) || {
    id: 'default',
    name: 'Standard',
    keyOrder: [],
    keys: {}
  };

  // Caricamento configurazione e porte all'avvio
  useEffect(() => {
    async function init() {
      try {
        const loadedConfig = await api.getConfig();
        if (loadedConfig) {
          setConfig(loadedConfig);
          if (loadedConfig.serial?.port) {
            setSelectedPort(loadedConfig.serial.port);
          }

          const activeProf = (loadedConfig.profiles && loadedConfig.profiles[loadedConfig.activeProfile])
            || Object.values(loadedConfig.profiles || {})[0];

          if (activeProf) {
            const firstKey = (activeProf.keyOrder && activeProf.keyOrder[0])
              || Object.keys(activeProf.keys || {})[0];
            if (firstKey) setSelectedKeyId(firstKey);
          }
        }

        await refreshPorts();

        const hwStatus = await api.getHardwareStatus();
        setIsConnected(hwStatus.connected);
        if (hwStatus.port) setSelectedPort(hwStatus.port);
        setStatusMessage(hwStatus.connected ? `Connesso a ${hwStatus.port}` : 'In attesa di connessione hardware');
      } catch (err) {
        console.error('Errore inizializzazione:', err);
        setStatusMessage('Errore connessione backend.');
      }
    }

    init();

    // Sottoscrizione eventi hardware
    const unsubKey = api.onKeyPressed((data) => {
      console.log('Tasto fisico premuto:', data);
      setActivePressedKey(data.keyId);
      setLastEvent(`Tasto [${data.keyId}] premuto alle ${new Date().toLocaleTimeString()} (Raw: "${data.raw}")`);
      setTimeout(() => setActivePressedKey(null), 600);
    });

    const unsubStatus = api.onHardwareStatus((status) => {
      setIsConnected(status.connected);
      if (status.port) setSelectedPort(status.port);
      setStatusMessage(status.message || (status.connected ? `Connesso a ${status.port}` : 'Disconnesso'));
    });

    return () => {
      if (typeof unsubKey === 'function') unsubKey();
      if (typeof unsubStatus === 'function') unsubStatus();
    };
  }, []);

  const refreshPorts = async () => {
    try {
      const list = await api.listSerialPorts();
      setPorts(list || []);
      if (!selectedPort && list && list.length > 0) {
        setSelectedPort(list[0].path);
      }
    } catch (err) {
      console.error('Errore elenco porte:', err);
    }
  };

  // Funzione di salvataggio automatico persistente
  const persistConfig = useCallback(async (cfgToSave) => {
    setSaveStatus('saving');
    try {
      const res = await api.saveConfig(cfgToSave);
      if (res && res.success !== false) {
        setSaveStatus('saved');
      } else {
        setSaveStatus('error');
      }
    } catch (err) {
      console.error('Errore salvataggio:', err);
      setSaveStatus('error');
    }
  }, []);

  // --- GESTIONE PROFILI / TEMPLATE ---

  const handleSelectProfile = (profileId) => {
    if (profileId === config.activeProfile) return;
    const updated = { ...config, activeProfile: profileId };
    setConfig(updated);

    const targetProf = config.profiles[profileId];
    if (targetProf) {
      const firstKey = (targetProf.keyOrder && targetProf.keyOrder[0])
        || Object.keys(targetProf.keys || {})[0];
      if (firstKey) setSelectedKeyId(firstKey);
    }

    persistConfig(updated);
  };

  const handleCreateProfile = () => {
    const name = window.prompt('Inserisci il nome del nuovo profilo / template:', 'Nuovo Contesto');
    if (!name || !name.trim()) return;

    const id = 'profile_' + Date.now();
    const newProfile = {
      id,
      name: name.trim(),
      keyOrder: ['1', '2', '3', '4'],
      keys: {
        '1': { type: 'KEY', value: 'Ctrl+C', label: 'Copia', enabled: true },
        '2': { type: 'KEY', value: 'Ctrl+V', label: 'Incolla', enabled: true },
        '3': { type: 'TEXT', value: 'Ciao!', label: 'Saluto', enabled: true },
        '4': { type: 'APP', value: 'calc.exe', label: 'Calcolatrice', enabled: true }
      }
    };

    const updated = {
      ...config,
      activeProfile: id,
      profiles: {
        ...config.profiles,
        [id]: newProfile
      }
    };

    setConfig(updated);
    setSelectedKeyId('1');
    persistConfig(updated);
  };

  const handleDuplicateProfile = () => {
    const name = window.prompt('Nome per la copia del profilo:', `${currentProfile.name} (Copia)`);
    if (!name || !name.trim()) return;

    const id = 'profile_' + Date.now();
    const clonedKeys = JSON.parse(JSON.stringify(currentProfile.keys || {}));
    const clonedOrder = [...(currentProfile.keyOrder || Object.keys(clonedKeys))];

    const newProfile = {
      id,
      name: name.trim(),
      keyOrder: clonedOrder,
      keys: clonedKeys
    };

    const updated = {
      ...config,
      activeProfile: id,
      profiles: {
        ...config.profiles,
        [id]: newProfile
      }
    };

    setConfig(updated);
    persistConfig(updated);
  };

  const handleRenameProfile = () => {
    const newName = window.prompt('Rinomina profilo:', currentProfile.name);
    if (!newName || !newName.trim() || newName === currentProfile.name) return;

    const updatedProfiles = {
      ...config.profiles,
      [activeProfileId]: {
        ...currentProfile,
        name: newName.trim()
      }
    };

    const updated = { ...config, profiles: updatedProfiles };
    setConfig(updated);
    persistConfig(updated);
  };

  const handleDeleteProfile = () => {
    const profileKeys = Object.keys(config.profiles || {});
    if (profileKeys.length <= 1) {
      alert('Devi mantenere almeno un profilo configurato.');
      return;
    }

    if (!window.confirm(`Sei sicuro di voler eliminare il profilo "${currentProfile.name}"?`)) return;

    const updatedProfiles = { ...config.profiles };
    delete updatedProfiles[activeProfileId];

    const remainingIds = Object.keys(updatedProfiles);
    const nextActiveId = remainingIds[0];

    const updated = {
      ...config,
      activeProfile: nextActiveId,
      profiles: updatedProfiles
    };

    setConfig(updated);
    const nextProf = updatedProfiles[nextActiveId];
    if (nextProf) {
      const first = (nextProf.keyOrder && nextProf.keyOrder[0]) || Object.keys(nextProf.keys || {})[0];
      if (first) setSelectedKeyId(first);
    }

    persistConfig(updated);
  };

  // --- GESTIONE TASTI NEL PROFILO ATTIVO ---

  const handleKeyFieldChange = (field, value) => {
    setConfig((prev) => {
      const prof = prev.profiles[prev.activeProfile] || currentProfile;
      const currentKeyData = prof.keys[selectedKeyId] || { type: 'KEY', value: '', label: '', enabled: true };

      const updatedKey = {
        ...currentKeyData,
        [field]: value
      };

      const updatedProfile = {
        ...prof,
        keys: {
          ...prof.keys,
          [selectedKeyId]: updatedKey
        }
      };

      const updatedConfig = {
        ...prev,
        serial: { ...prev.serial, port: selectedPort },
        profiles: {
          ...prev.profiles,
          [prev.activeProfile]: updatedProfile
        }
      };

      // Se cambia il tipo o abilitazione, salva IMMEDIATAMENTE
      if (field === 'type' || field === 'enabled') {
        persistConfig(updatedConfig);
      } else {
        if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
        setSaveStatus('saving');
        autoSaveTimerRef.current = setTimeout(() => {
          persistConfig(updatedConfig);
        }, 350);
      }

      return updatedConfig;
    });
  };

  // Drag and drop reordering
  const handleDragStart = (e, keyId) => {
    setDraggedKeyId(keyId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', keyId);
  };

  const handleDragOver = (e, keyId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverKeyId !== keyId) {
      setDragOverKeyId(keyId);
    }
  };

  const handleDragLeave = (e, keyId) => {
    if (dragOverKeyId === keyId) {
      setDragOverKeyId(null);
    }
  };

  const handleDrop = (e, targetKeyId) => {
    e.preventDefault();
    if (!draggedKeyId || draggedKeyId === targetKeyId) {
      setDraggedKeyId(null);
      setDragOverKeyId(null);
      return;
    }

    const currentOrder = currentProfile.keyOrder && currentProfile.keyOrder.length > 0
      ? [...currentProfile.keyOrder]
      : Object.keys(currentProfile.keys || {});

    const fromIdx = currentOrder.indexOf(draggedKeyId);
    const toIdx = currentOrder.indexOf(targetKeyId);

    if (fromIdx !== -1 && toIdx !== -1) {
      currentOrder.splice(fromIdx, 1);
      currentOrder.splice(toIdx, 0, draggedKeyId);

      const reorderedKeys = {};
      currentOrder.forEach((k) => {
        if (currentProfile.keys[k]) reorderedKeys[k] = currentProfile.keys[k];
      });

      const updatedProfile = {
        ...currentProfile,
        keyOrder: currentOrder,
        keys: reorderedKeys
      };

      const updated = {
        ...config,
        profiles: {
          ...config.profiles,
          [activeProfileId]: updatedProfile
        }
      };

      setConfig(updated);
      persistConfig(updated);
    }

    setDraggedKeyId(null);
    setDragOverKeyId(null);
  };

  const handleDragEnd = () => {
    setDraggedKeyId(null);
    setDragOverKeyId(null);
  };

  const handleConnectToggle = async () => {
    if (isConnected) {
      await api.disconnectSerialPort();
      setIsConnected(false);
      setStatusMessage('Disconnesso manualmente.');
    } else {
      if (!selectedPort) {
        alert('Seleziona una porta seriale COM valida.');
        return;
      }
      setStatusMessage(`Connessione a ${selectedPort}...`);
      const res = await api.connectSerialPort(selectedPort, config.serial?.baudRate || 9600);
      if (res.success) {
        setIsConnected(true);
        setStatusMessage(`Connesso a ${selectedPort}`);
      } else {
        alert(`Errore di connessione: ${res.error || 'Impossibile aprire la porta'}`);
        setStatusMessage(`Errore: ${res.error}`);
      }
    }
  };

  const handleAddKey = () => {
    const existingIds = Object.keys(currentProfile.keys || {});
    let nextId = 1;
    while (existingIds.includes(String(nextId))) {
      nextId++;
    }
    const newId = String(nextId);

    const updatedKeys = {
      ...(currentProfile.keys || {}),
      [newId]: {
        type: 'KEY',
        value: 'Ctrl+C',
        label: `Tasto ${newId}`,
        enabled: true
      }
    };
    const updatedOrder = [...(currentProfile.keyOrder || Object.keys(currentProfile.keys || {})), newId];

    const updatedProfile = {
      ...currentProfile,
      keys: updatedKeys,
      keyOrder: updatedOrder
    };

    const updated = {
      ...config,
      profiles: {
        ...config.profiles,
        [activeProfileId]: updatedProfile
      }
    };

    setConfig(updated);
    setSelectedKeyId(newId);
    persistConfig(updated);
  };

  const handleDeleteKey = (idToDelete) => {
    const keysObj = currentProfile.keys || {};
    if (Object.keys(keysObj).length <= 1) {
      alert('Devi mantenere almeno un tasto configurato in questo profilo.');
      return;
    }
    const updatedKeys = { ...keysObj };
    delete updatedKeys[idToDelete];

    const updatedOrder = (currentProfile.keyOrder || []).filter(k => k !== idToDelete);
    const updatedProfile = {
      ...currentProfile,
      keys: updatedKeys,
      keyOrder: updatedOrder
    };

    const updated = {
      ...config,
      profiles: {
        ...config.profiles,
        [activeProfileId]: updatedProfile
      }
    };

    setConfig(updated);
    setSelectedKeyId(updatedOrder[0] || Object.keys(updatedKeys)[0]);
    persistConfig(updated);
  };

  const handleManualSave = async () => {
    const toSave = {
      ...config,
      serial: { ...config.serial, port: selectedPort }
    };
    await persistConfig(toSave);
    setTestResult({ success: true, output: 'Configurazione salvata con successo su config.json!' });
  };

  const handleTestAction = async () => {
    const currentAction = (currentProfile.keys && currentProfile.keys[selectedKeyId]) || {};
    if (!currentAction || currentAction.value === undefined) {
      alert('Inserisci prima un valore da testare.');
      return;
    }

    if (currentAction.enabled === false) {
      setTestResult({
        success: false,
        error: 'Attenzione: Il tasto è attualmente DISABILITATO. Abilitalo per eseguirlo.'
      });
      return;
    }

    await persistConfig({ ...config, serial: { ...config.serial, port: selectedPort } });

    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testAction(currentAction);
      setTestResult(res);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    } finally {
      setIsTesting(false);
    }
  };

  const currentKey = (currentProfile.keys && currentProfile.keys[selectedKeyId]) || {
    type: 'KEY',
    value: '',
    label: '',
    enabled: true
  };

  const getActionHelperText = (type) => {
    switch (type) {
      case 'KEY':
        return 'Simula la pressione di un tasto o scorciatoia tastiera (Win32 SendInput). Es: Ctrl+C, Win+D, Alt+Tab, F1-F24, Volume_Up';
      case 'TEXT':
        return 'Digita automaticamente qualsiasi testo, stringa o carattere custom (es. ~, €, @, snippet o email)';
      case 'MACRO':
        return 'Esegue sequenze di tasti e testi con ritardi. Es: KEY:CTRL+A; DELAY:100; KEY:BACKSPACE; TEXT:Ciao!; KEY:ENTER';
      case 'APP':
        return 'Avvia un file .exe o un comando di sistema. Es: calc.exe, notepad.exe, o "C:\\Program Files\\...\\app.exe"';
      case 'POWERSHELL':
        return 'Esegue script PowerShell con ExecutionPolicy Bypass. Es: Write-Host "Hello" oppure Get-Service';
      case 'BASH':
        return 'Esegue un comando Linux nativo in WSL. Es: echo "Hello WSL" && git status';
      case 'URL':
        return 'Apre il link specificato nel browser predefinito di Windows. Es: https://google.com';
      default:
        return '';
    }
  };

  // Ordine di visualizzazione dei tasti
  const orderedKeyIds = currentProfile.keyOrder && currentProfile.keyOrder.length > 0
    ? currentProfile.keyOrder.filter(id => currentProfile.keys && currentProfile.keys[id])
    : Object.keys(currentProfile.keys || {});

  const profilesList = Object.values(config.profiles || {});

  return (
    <div className="app-container">
      {/* Top Header & Serial Connection */}
      <header className="app-header">
        <div className="brand-title">
          <span className="brand-icon">⌨️</span>
          <span>Macro Pad Manager</span>
          <span style={{ fontSize: '0.72rem', opacity: 0.7, marginLeft: '6px' }}>
            {api.type === 'electron' ? '🖥️ Desktop App' : '🌐 Web Browser (Bridge 5174)'}
          </span>
        </div>

        <div className="hardware-controls">
          <select
            className="port-select"
            value={selectedPort}
            onChange={(e) => {
              setSelectedPort(e.target.value);
              persistConfig({ ...config, serial: { ...config.serial, port: e.target.value } });
            }}
            disabled={isConnected}
          >
            {ports.length === 0 ? (
              <option value="">Nessuna porta COM rilevata</option>
            ) : (
              ports.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.path} {p.friendlyName && p.friendlyName !== p.path ? `(${p.friendlyName})` : ''}
                </option>
              ))
            )}
          </select>

          <button className="btn" onClick={refreshPorts} title="Aggiorna porte">
            🔄
          </button>

          <button
            className={`btn ${isConnected ? 'btn-danger' : 'btn-success'}`}
            onClick={handleConnectToggle}
          >
            {isConnected ? 'Disconnetti' : 'Connetti Hardware'}
          </button>

          <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot"></span>
            <span>{isConnected ? 'Connesso' : 'Disconnesso'}</span>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleManualSave}
            title="Salva la configurazione su disco"
          >
            💾 {saveStatus === 'saving' ? 'Salvataggio...' : saveStatus === 'saved' ? 'Salvato ✓' : 'Salva Config'}
          </button>
        </div>
      </header>

      {/* Profiles / Templates Switcher Toolbar */}
      <div className="profiles-bar">
        <div className="profiles-left">
          <span className="profiles-label">📑 Profilo:</span>
          <div className="profiles-tabs">
            {profilesList.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`profile-tab ${p.id === activeProfileId ? 'active' : ''}`}
                onClick={() => handleSelectProfile(p.id)}
              >
                <span>{p.id === activeProfileId ? '●' : '○'}</span>
                <span>{p.name || p.id}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="profile-actions">
          <button className="btn" onClick={handleCreateProfile} title="Crea un nuovo profilo">
            ➕ Nuovo
          </button>
          <button className="btn" onClick={handleDuplicateProfile} title="Duplica il profilo corrente">
            📋 Duplica
          </button>
          <button className="btn" onClick={handleRenameProfile} title="Rinomina il profilo corrente">
            ✏️ Rinomina
          </button>
          {profilesList.length > 1 && (
            <button className="btn btn-danger" onClick={handleDeleteProfile} title="Elimina il profilo corrente">
              🗑️
            </button>
          )}
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <main className="main-content">
        {/* Left: Keypad Grid with Drag & Drop */}
        <div className="keypad-pane">
          <div className="pane-title">
            <span>Tasti ({currentProfile.name})</span>
            <span className="drag-hint">↕ Trascina per riordinare</span>
          </div>

          <div className="keys-grid">
            {orderedKeyIds.map((id) => {
              const item = (currentProfile.keys && currentProfile.keys[id]) || {};
              const isSelected = selectedKeyId === id;
              const isPressed = activePressedKey === id;
              const isDragging = draggedKeyId === id;
              const isDragOver = dragOverKeyId === id;
              const isEnabled = item.enabled !== false;

              return (
                <div
                  key={id}
                  draggable={true}
                  onDragStart={(e) => handleDragStart(e, id)}
                  onDragOver={(e) => handleDragOver(e, id)}
                  onDragLeave={(e) => handleDragLeave(e, id)}
                  onDrop={(e) => handleDrop(e, id)}
                  onDragEnd={handleDragEnd}
                  className={`key-card ${isSelected ? 'selected' : ''} ${isPressed ? 'pressed' : ''} ${
                    isDragging ? 'dragging' : ''
                  } ${isDragOver ? 'drag-over' : ''} ${!isEnabled ? 'disabled' : ''}`}
                  onClick={() => setSelectedKeyId(id)}
                  title={!isEnabled ? 'Tasto DISABILITATO (clicca per configurare)' : 'Clicca per modificare o trascina'}
                >
                  <span className="key-number">#{id}</span>
                  <span className={`key-type-tag tag-${(item.type || 'app').toLowerCase()}`}>
                    {item.type || 'APP'}
                  </span>
                  <div className="key-label">{item.label || `Tasto ${id}`}</div>

                  {!isEnabled && <span className="disabled-badge">OFF</span>}
                  <span className="drag-handle" title="Trascina">⠿</span>
                </div>
              );
            })}
          </div>

          <button className="add-key-btn" onClick={handleAddKey}>
            ➕ Aggiungi Tasto al Profilo
          </button>
        </div>

        {/* Right: Key Config Editor */}
        <div className="editor-pane">
          <div className="pane-title">
            <span>Configura Tasto <strong>#{selectedKeyId}</strong> [{currentProfile.name}]</span>
            {Object.keys(currentProfile.keys || {}).length > 1 && (
              <button
                className="btn btn-danger"
                style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                onClick={() => handleDeleteKey(selectedKeyId)}
              >
                Elimina Tasto
              </button>
            )}
          </div>

          <div className="editor-card">
            {/* Enable / Disable Toggle Switch */}
            <div className="enable-toggle-box">
              <div>
                <strong>Abilitazione Tasto #{selectedKeyId}: </strong>
                <span style={{ color: currentKey.enabled !== false ? 'var(--success)' : 'var(--danger)' }}>
                  {currentKey.enabled !== false ? 'ATTIVO (Esegue l\'azione)' : 'DISABILITATO (Ignora la pressione)'}
                </span>
              </div>
              <button
                type="button"
                className={`toggle-btn ${currentKey.enabled !== false ? 'enabled' : 'disabled'}`}
                onClick={() => handleKeyFieldChange('enabled', currentKey.enabled === false ? true : false)}
              >
                <span>{currentKey.enabled !== false ? '✓ Abilitato' : '✕ Disabilitato'}</span>
              </button>
            </div>

            {/* Label Input */}
            <div className="form-group">
              <label>Etichetta Descrittiva Tasto</label>
              <input
                type="text"
                className="form-control"
                value={currentKey.label || ''}
                placeholder="Es. Copia, Muto, Calcolatrice, Scrivi Email"
                onChange={(e) => handleKeyFieldChange('label', e.target.value)}
              />
            </div>

            {/* Action Type Selector */}
            <div className="form-group">
              <label>Tipo di Azione</label>
              <div className="action-type-selector">
                {[
                  { id: 'KEY', icon: '⌨️', label: 'Tasto' },
                  { id: 'TEXT', icon: '✍️', label: 'Testo' },
                  { id: 'MACRO', icon: '⚙️', label: 'Macro' },
                  { id: 'APP', icon: '🚀', label: 'App' },
                  { id: 'POWERSHELL', icon: '⚡', label: 'PowerShell' },
                  { id: 'URL', icon: '🌐', label: 'Web URL' }
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`type-btn ${currentKey.type === t.id ? 'active' : ''}`}
                    onClick={() => handleKeyFieldChange('type', t.id)}
                  >
                    <span>{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>
              <div className="helper-text">{getActionHelperText(currentKey.type)}</div>
            </div>

            {/* Value / Command Input */}
            <div className="form-group">
              <label>
                {currentKey.type === 'KEY'
                  ? 'Tasto o Scorciatoia da simulare'
                  : currentKey.type === 'TEXT'
                  ? 'Carattere custom o stringa da digitare'
                  : currentKey.type === 'MACRO'
                  ? 'Sequenza Macro (separata da ;)'
                  : currentKey.type === 'APP'
                  ? 'Percorso applicazione .exe'
                  : currentKey.type === 'POWERSHELL'
                  ? 'Comando PowerShell'
                  : 'Indirizzo Web (URL)'}
              </label>

              {currentKey.type === 'TEXT' || currentKey.type === 'MACRO' ? (
                <textarea
                  rows={3}
                  className="form-control"
                  value={currentKey.value !== undefined ? currentKey.value : ''}
                  placeholder={
                    currentKey.type === 'TEXT'
                      ? 'Es: ~ oppure mia.email@example.com oppure un messaggio preimpostato...'
                      : 'Es: KEY:CTRL+A; DELAY:100; KEY:BACKSPACE; TEXT:Ciao Mondo!; KEY:ENTER'
                  }
                  onChange={(e) => handleKeyFieldChange('value', e.target.value)}
                />
              ) : (
                <input
                  type="text"
                  className="form-control"
                  value={currentKey.value !== undefined ? currentKey.value : ''}
                  placeholder={
                    currentKey.type === 'KEY'
                      ? 'Es: Ctrl+C, Win+D, Alt+Tab, Volume_Up, Enter...'
                      : currentKey.type === 'APP'
                      ? 'calc.exe oppure notepad.exe'
                      : currentKey.type === 'POWERSHELL'
                      ? 'Write-Host "Test PowerShell"'
                      : 'https://github.com'
                  }
                  onChange={(e) => handleKeyFieldChange('value', e.target.value)}
                />
              )}

              {/* Quick chips for KEY type */}
              {currentKey.type === 'KEY' && (
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                    Scorciatoie rapide (clicca per inserire):
                  </div>
                  <div className="quick-chips">
                    {COMMON_KEYS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className="chip-btn"
                        onClick={() => handleKeyFieldChange('value', k)}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick chips for TEXT / Caratteri speciali */}
              {currentKey.type === 'TEXT' && (
                <div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px' }}>
                    Caratteri speciali rapidi:
                  </div>
                  <div className="quick-chips">
                    {COMMON_CHARS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="chip-btn"
                        onClick={() => handleKeyFieldChange('value', (currentKey.value || '') + c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Actions: Test & Run */}
            <div className="editor-actions">
              <button
                className="btn btn-primary"
                onClick={handleTestAction}
                disabled={isTesting}
              >
                ▶️ {isTesting ? 'Esecuzione...' : 'Testa Azione Ora'}
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span
                  style={{
                    fontSize: '0.8rem',
                    color: saveStatus === 'error' ? 'var(--danger)' : 'var(--success)'
                  }}
                >
                  {saveStatus === 'saving'
                    ? 'Salvataggio...'
                    : saveStatus === 'saved'
                    ? '✓ Salvato automaticamente'
                    : '✗ Errore salvataggio'}
                </span>
                <button className="btn btn-success" onClick={handleManualSave}>
                  💾 Salva Modifiche
                </button>
              </div>
            </div>

            {/* Test output box */}
            {testResult && (
              <div className={`test-result-box ${testResult.success ? 'success' : 'error'}`}>
                <strong>{testResult.success ? '✓ Risultato Esecuzione:' : '✗ Errore:'}</strong>
                <div>{testResult.output || testResult.error || 'Azione eseguita con successo.'}</div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer Activity Bar */}
      <footer className="activity-bar">
        <div className="live-indicator">
          <span>📡 {statusMessage}</span>
        </div>
        <div>
          {lastEvent ? (
            <span style={{ color: 'var(--accent)' }}>{lastEvent}</span>
          ) : (
            <span>In ascolto segnali hardware...</span>
          )}
        </div>
      </footer>
    </div>
  );
}

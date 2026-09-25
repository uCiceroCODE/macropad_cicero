import React, { useState, useEffect, useRef, useCallback } from 'react';
import ActivityBar from './component/ActivityBar';
import Header from './component/Header';
import KeyEditor from './component/KeyEditor';
import KeypadPane from './component/KeypadPane';
import MixerPane from './component/MixerPane';
import ProfilesBar from './component/ProfilesBar';

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
      mixerGetApps: () => window.macroPadAPI.mixerGetApps(),
      mixerSelect: (index) => window.macroPadAPI.mixerSelect(index),
      mixerSetVolume: (index, pct) => window.macroPadAPI.mixerSetVolume(index, pct),
      mixerSetMute: (index, mute) => window.macroPadAPI.mixerSetMute(index, mute),
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
    mixerGetApps: async () => {
      const r = await fetch(`${HTTP_BASE}/mixer`);
      return await r.json();
    },
    mixerSelect: async (index) => {
      const r = await fetch(`${HTTP_BASE}/mixer/select`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index })
      });
      return await r.json();
    },
    mixerSetVolume: async (index, pct) => {
      const r = await fetch(`${HTTP_BASE}/mixer/volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, pct })
      });
      return await r.json();
    },
    mixerSetMute: async (index, mute) => {
      const r = await fetch(`${HTTP_BASE}/mixer/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ index, mute })
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
  const [view, setView] = useState('keypad');
  const [mixer, setMixer] = useState({ apps: [], deviceName: null, error: null, selectedIndex: null });

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

  const mixerDraggingRef = useRef(false);

  const loadMixer = useCallback(async () => {
    if (mixerDraggingRef.current) return;
    const result = await api.mixerGetApps();
    setMixer((prev) => ({
      ...prev,
      apps: result.apps || [],
      deviceName: result.deviceName || null,
      error: result.success === false ? result.error : null,
      selectedIndex: result.selectedIndex === undefined ? null : result.selectedIndex
    }));
  }, []);

  const selectMixerApp = useCallback(async (index) => {
    const result = await api.mixerSelect(index);
    if (result && result.success === false) {
      setMixer((prev) => ({ ...prev, error: result.error }));
      return;
    }
    setMixer((prev) => ({ ...prev, selectedIndex: index }));
  }, []);

  const handleMixerVolume = useCallback(async (index, pct) => {
    setMixer((prev) => ({
      ...prev,
      selectedIndex: index,
      apps: prev.apps.map((app) => (app.index === index ? { ...app, pct } : app))
    }));
    const result = await api.mixerSetVolume(index, pct);
    if (result && result.success === false) {
      setMixer((prev) => ({ ...prev, error: result.error }));
      return;
    }
    await api.mixerSelect(index);
  }, []);

  const handleMixerMute = useCallback(async (index, mute) => {
    setMixer((prev) => ({
      ...prev,
      selectedIndex: index,
      apps: prev.apps.map((app) => (app.index === index ? { ...app, mute } : app))
    }));
    const result = await api.mixerSetMute(index, mute);
    if (result && result.success === false) {
      setMixer((prev) => ({ ...prev, error: result.error }));
      return;
    }
    await api.mixerSelect(index);
  }, []);

  useEffect(() => {
    if (view !== 'mixer') return undefined;
    loadMixer();
    const timer = setInterval(loadMixer, 800);
    return () => clearInterval(timer);
  }, [view, loadMixer]);

  return (
    <div className="app-container">
      <Header
        apiType={api.type}
        ports={ports}
        selectedPort={selectedPort}
        isConnected={isConnected}
        saveStatus={saveStatus}
        onPortChange={(port) => {
          setSelectedPort(port);
          persistConfig({ ...config, serial: { ...config.serial, port } });
        }}
        onRefreshPorts={refreshPorts}
        onConnectToggle={handleConnectToggle}
        onManualSave={handleManualSave}
      />

      <ProfilesBar
        profiles={profilesList}
        activeProfileId={activeProfileId}
        onSelectProfile={handleSelectProfile}
        onCreateProfile={handleCreateProfile}
        onDuplicateProfile={handleDuplicateProfile}
        onRenameProfile={handleRenameProfile}
        onDeleteProfile={handleDeleteProfile}
      />

      <div className="view-switch">
        <button
          type="button"
          className={`view-tab${view === 'keypad' ? ' active' : ''}`}
          onClick={() => setView('keypad')}
        >
          Tastierino
        </button>
        <button
          type="button"
          className={`view-tab${view === 'mixer' ? ' active' : ''}`}
          onClick={() => setView('mixer')}
        >
          Volume Mixer
        </button>
      </div>

      {view === 'mixer' ? (
        <MixerPane
          apps={mixer.apps}
          deviceName={mixer.deviceName}
          error={mixer.error}
          selectedIndex={mixer.selectedIndex}
          onSelect={selectMixerApp}
          onVolume={handleMixerVolume}
          onMute={handleMixerMute}
          onRefresh={loadMixer}
          onDragChange={(dragging) => { mixerDraggingRef.current = dragging; }}
        />
      ) : (
        /* Main Two-Column Layout */
        <main className="main-content">
          <KeypadPane
            profile={currentProfile}
            orderedKeyIds={orderedKeyIds}
            selectedKeyId={selectedKeyId}
            activePressedKey={activePressedKey}
            draggedKeyId={draggedKeyId}
            dragOverKeyId={dragOverKeyId}
            onSelectKey={setSelectedKeyId}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onAddKey={handleAddKey}
          />

          <KeyEditor
            selectedKeyId={selectedKeyId}
            currentProfile={currentProfile}
            currentKey={currentKey}
            saveStatus={saveStatus}
            isTesting={isTesting}
            testResult={testResult}
            onDeleteKey={handleDeleteKey}
            onFieldChange={handleKeyFieldChange}
            onTestAction={handleTestAction}
            onManualSave={handleManualSave}
            getActionHelperText={getActionHelperText}
          />
        </main>
      )}

      <ActivityBar statusMessage={statusMessage} lastEvent={lastEvent} />
    </div>
  );
}

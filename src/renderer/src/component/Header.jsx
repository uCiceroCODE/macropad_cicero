import React from 'react';

export default function Header({ apiType, ports, selectedPort, isConnected, saveStatus, onPortChange, onRefreshPorts, onConnectToggle, onManualSave }) {
    return (
        <header className="app-header">
            <div className="brand-title">
                <span className="brand-icon">⌨️</span>
                <span>Macro Pad Manager</span>
                <span style={{ fontSize: '0.72rem', opacity: 0.7, marginLeft: '6px' }}>
                    {apiType === 'electron' ? '🖥️ Desktop App' : '🌐 Web Browser (Bridge 5174)'}
                </span>
            </div>
            <div className="hardware-controls">
                <select className="port-select" value={selectedPort} onChange={(event) => onPortChange(event.target.value)} disabled={isConnected}>
                    {ports.length === 0 ? <option value="">Nessuna porta COM rilevata</option> : ports.map((port) => (
                        <option key={port.path} value={port.path}>
                            {port.path} {port.friendlyName && port.friendlyName !== port.path ? `(${port.friendlyName})` : ''}
                        </option>
                    ))}
                </select>
                <button className="btn" onClick={onRefreshPorts} title="Aggiorna porte">🔄</button>
                <button className={`btn ${isConnected ? 'btn-danger' : 'btn-success'}`} onClick={onConnectToggle}>
                    {isConnected ? 'Disconnetti' : 'Connetti Hardware'}
                </button>
                <div className={`status-badge ${isConnected ? 'connected' : 'disconnected'}`}>
                    <span className="status-dot"></span>
                    <span>{isConnected ? 'Connesso' : 'Disconnesso'}</span>
                </div>
                <button className="btn btn-primary" onClick={onManualSave} title="Salva la configurazione su disco">
                    💾 {saveStatus === 'saving' ? 'Salvataggio...' : saveStatus === 'saved' ? 'Salvato ✓' : 'Salva Config'}
                </button>
            </div>
        </header>
    );
}

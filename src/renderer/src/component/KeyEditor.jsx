import React from 'react';
import { COMMON_CHARS, COMMON_KEYS } from './actionConstants';

const ACTION_TYPES = [
  { id: 'KEY', icon: '⌨️', label: 'Tasto' },
  { id: 'TEXT', icon: '✍️', label: 'Testo' },
  { id: 'MACRO', icon: '⚙️', label: 'Macro' },
  { id: 'APP', icon: '🚀', label: 'App' },
  { id: 'POWERSHELL', icon: '⚡', label: 'PowerShell' },
  { id: 'URL', icon: '🌐', label: 'Web URL' }
];

export default function KeyEditor({ selectedKeyId, currentProfile, currentKey, saveStatus, isTesting, testResult, onDeleteKey, onFieldChange, onTestAction, onManualSave, getActionHelperText }) {
  const isEnabled = currentKey.enabled !== false;
  const isMultiline = currentKey.type === 'TEXT' || currentKey.type === 'MACRO';
  return (
    <div className="editor-pane">
      <div className="pane-title">
        <span>Configura Tasto <strong>#{selectedKeyId}</strong> [{currentProfile.name}]</span>
        {Object.keys(currentProfile.keys || {}).length > 1 && <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => onDeleteKey(selectedKeyId)}>Elimina Tasto</button>}
      </div>
      <div className="editor-card">
        <div className="enable-toggle-box">
          <div><strong>Abilitazione Tasto #{selectedKeyId}: </strong><span style={{ color: isEnabled ? 'var(--success)' : 'var(--danger)' }}>{isEnabled ? 'ATTIVO (Esegue l\'azione)' : 'DISABILITATO (Ignora la pressione)'}</span></div>
          <button type="button" className={`toggle-btn ${isEnabled ? 'enabled' : 'disabled'}`} onClick={() => onFieldChange('enabled', !isEnabled)}><span>{isEnabled ? '✓ Abilitato' : '✕ Disabilitato'}</span></button>
        </div>
        <div className="form-group">
          <label>Etichetta Descrittiva Tasto</label>
          <input type="text" className="form-control" value={currentKey.label || ''} placeholder="Es. Copia, Muto, Calcolatrice, Scrivi Email" onChange={(event) => onFieldChange('label', event.target.value)} />
        </div>
        <div className="form-group">
          <label>Tipo di Azione</label>
          <div className="action-type-selector">
            {ACTION_TYPES.map((type) => <button key={type.id} type="button" className={`type-btn ${currentKey.type === type.id ? 'active' : ''}`} onClick={() => onFieldChange('type', type.id)}><span>{type.icon}</span><span>{type.label}</span></button>)}
          </div>
          <div className="helper-text">{getActionHelperText(currentKey.type)}</div>
        </div>
        <div className="form-group">
          <label>{currentKey.type === 'KEY' ? 'Tasto o Scorciatoia da simulare' : currentKey.type === 'TEXT' ? 'Carattere custom o stringa da digitare' : currentKey.type === 'MACRO' ? 'Sequenza Macro (separata da ;)' : currentKey.type === 'APP' ? 'Percorso applicazione .exe' : currentKey.type === 'POWERSHELL' ? 'Comando PowerShell' : 'Indirizzo Web (URL)'}</label>
          {isMultiline ? <textarea rows={3} className="form-control" value={currentKey.value !== undefined ? currentKey.value : ''} placeholder={currentKey.type === 'TEXT' ? 'Es: ~ oppure mia.email@example.com oppure un messaggio preimpostato...' : 'Es: KEY:CTRL+A; DELAY:100; KEY:BACKSPACE; TEXT:Ciao Mondo!; KEY:ENTER'} onChange={(event) => onFieldChange('value', event.target.value)} /> : <input type="text" className="form-control" value={currentKey.value !== undefined ? currentKey.value : ''} placeholder={currentKey.type === 'KEY' ? 'Es: Ctrl+C, Win+D, Alt+Tab, Volume_Up, Enter...' : currentKey.type === 'APP' ? 'calc.exe oppure notepad.exe' : currentKey.type === 'POWERSHELL' ? 'Write-Host \"Test PowerShell\"' : 'https://github.com'} onChange={(event) => onFieldChange('value', event.target.value)} />}
          {currentKey.type === 'KEY' && <div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px' }}>Scorciatoie rapide (clicca per inserire):</div><div className="quick-chips">{COMMON_KEYS.map((key) => <button key={key} type="button" className="chip-btn" onClick={() => onFieldChange('value', key)}>{key}</button>)}</div></div>}
          {currentKey.type === 'TEXT' && <div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '6px' }}>Caratteri speciali rapidi:</div><div className="quick-chips">{COMMON_CHARS.map((character) => <button key={character} type="button" className="chip-btn" onClick={() => onFieldChange('value', (currentKey.value || '') + character)}>{character}</button>)}</div></div>}
        </div>
        <div className="editor-actions">
          <button className="btn btn-primary" onClick={onTestAction} disabled={isTesting}>▶️ {isTesting ? 'Esecuzione...' : 'Testa Azione Ora'}</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}><span style={{ fontSize: '0.8rem', color: saveStatus === 'error' ? 'var(--danger)' : 'var(--success)' }}>{saveStatus === 'saving' ? 'Salvataggio...' : saveStatus === 'saved' ? '✓ Salvato automaticamente' : '✗ Errore salvataggio'}</span><button className="btn btn-success" onClick={onManualSave}>💾 Salva Modifiche</button></div>
        </div>
        {testResult && <div className={`test-result-box ${testResult.success ? 'success' : 'error'}`}><strong>{testResult.success ? '✓ Risultato Esecuzione:' : '✗ Errore:'}</strong><div>{testResult.output || testResult.error || 'Azione eseguita con successo.'}</div></div>}
      </div>
    </div>
  );
}

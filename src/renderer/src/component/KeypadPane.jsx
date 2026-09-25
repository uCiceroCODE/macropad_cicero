import React from 'react';

export default function KeypadPane({ profile, orderedKeyIds, selectedKeyId, activePressedKey, draggedKeyId, dragOverKeyId, onSelectKey, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd, onAddKey }) {
  return (
    <div className="keypad-pane">
      <div className="pane-title">
        <span>Tasti ({profile.name})</span>
        <span className="drag-hint">↕ Trascina per riordinare</span>
      </div>
      <div className="keys-grid">
        {orderedKeyIds.map((id) => {
          const item = (profile.keys && profile.keys[id]) || {};
          const isSelected = selectedKeyId === id;
          const isPressed = activePressedKey === id;
          const isDragging = draggedKeyId === id;
          const isDragOver = dragOverKeyId === id;
          const isEnabled = item.enabled !== false;
          return (
            <div key={id} draggable={true} onDragStart={(event) => onDragStart(event, id)} onDragOver={(event) => onDragOver(event, id)} onDragLeave={(event) => onDragLeave(event, id)} onDrop={(event) => onDrop(event, id)} onDragEnd={onDragEnd} className={`key-card ${isSelected ? 'selected' : ''} ${isPressed ? 'pressed' : ''} ${isDragging ? 'dragging' : ''} ${isDragOver ? 'drag-over' : ''} ${!isEnabled ? 'disabled' : ''}`} onClick={() => onSelectKey(id)} title={!isEnabled ? 'Tasto DISABILITATO (clicca per configurare)' : 'Clicca per modificare o trascina'}>
              <span className="key-number">#{id}</span>
              <span className={`key-type-tag tag-${(item.type || 'app').toLowerCase()}`}>{item.type || 'APP'}</span>
              <div className="key-label">{item.label || `Tasto ${id}`}</div>
              {!isEnabled && <span className="disabled-badge">OFF</span>}
              <span className="drag-handle" title="Trascina">⠿</span>
            </div>
          );
        })}
      </div>
      <button className="add-key-btn" onClick={onAddKey}>➕ Aggiungi Tasto al Profilo</button>
    </div>
  );
}

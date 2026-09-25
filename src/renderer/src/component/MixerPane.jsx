function MixerPane({ apps, deviceName, error, selectedIndex, onSelect, onVolume, onMute, onRefresh, onDragChange }) {
  return (
    <div className="mixer-pane">
      <div className="mixer-toolbar">
        <div className="mixer-device">
          {error ? <span style={{ color: '#f85149' }}>{error}</span> : deviceName || 'Dispositivo di uscita'}
        </div>
        <button type="button" className="btn btn-sm" onClick={onRefresh}>Aggiorna</button>
      </div>

      {apps.length === 0 && !error && <div className="mixer-empty">Nessuna app audio attiva</div>}

      <div className="mixer-list">
        {apps.map((app) => (
          <div
            key={app.index}
            className={`mixer-row${selectedIndex === app.index ? ' selected' : ''}`}
            onClick={() => onSelect(app.index)}
          >
            <div className="mixer-row-head">
              <span className="mixer-label" title={app.label}>{app.label}</span>
              <span className="mixer-pct">{app.pct}%</span>
              <button
                type="button"
                className={`mute-btn${app.mute ? ' active' : ''}`}
                title={app.mute ? 'Riattiva audio' : 'Mute'}
                onClick={(e) => { e.stopPropagation(); onMute(app.index, !app.mute); }}
              >
                M
              </button>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={app.pct}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => { e.stopPropagation(); onDragChange(true); }}
              onPointerUp={() => onDragChange(false)}
              onPointerCancel={() => onDragChange(false)}
              onChange={(e) => onVolume(app.index, Number(e.target.value))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default MixerPane;

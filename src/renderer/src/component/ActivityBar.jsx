import React from 'react';

export default function ActivityBar({ statusMessage, lastEvent }) {
  return (
    <footer className="activity-bar">
      <div className="live-indicator"><span>📡 {statusMessage}</span></div>
      <div>{lastEvent ? <span style={{ color: 'var(--accent)' }}>{lastEvent}</span> : <span>In ascolto segnali hardware...</span>}</div>
    </footer>
  );
}

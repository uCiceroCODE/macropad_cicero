import React from 'react';

export default function ProfilesBar({ profiles, activeProfileId, onSelectProfile, onCreateProfile, onDuplicateProfile, onRenameProfile, onDeleteProfile }) {
  return (
    <div className="profiles-bar">
      <div className="profiles-left">
        <span className="profiles-label">📑 Profilo:</span>
        <div className="profiles-tabs">
          {profiles.map((profile) => (
            <button key={profile.id} type="button" className={`profile-tab ${profile.id === activeProfileId ? 'active' : ''}`} onClick={() => onSelectProfile(profile.id)}>
              <span>{profile.id === activeProfileId ? '●' : '○'}</span>
              <span>{profile.name || profile.id}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="profile-actions">
        <button className="btn" onClick={onCreateProfile} title="Crea un nuovo profilo">➕ Nuovo</button>
        <button className="btn" onClick={onDuplicateProfile} title="Duplica il profilo corrente">📋 Duplica</button>
        <button className="btn" onClick={onRenameProfile} title="Rinomina il profilo corrente">✏️ Rinomina</button>
        {profiles.length > 1 && <button className="btn btn-danger" onClick={onDeleteProfile} title="Elimina il profilo corrente">🗑️</button>}
      </div>
    </div>
  );
}

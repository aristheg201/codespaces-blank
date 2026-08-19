import type { LauncherSettings, LauncherSnapshot, UiProgressEvent } from '../../../shared/ipc';

interface Props {
  snapshot: LauncherSnapshot;
  settings: LauncherSettings;
  progress: UiProgressEvent | null;
  onUsername: (username: string) => void;
  onPlay: () => void | Promise<void>;
  onDiscord: () => void | Promise<void>;
  onSettings: () => void;
  onLibrary: () => void;
  onConsole: () => void;
  onAnnouncement: () => void;
}

export function Home({ snapshot, settings, progress, onUsername, onPlay, onDiscord, onSettings, onLibrary, onConsole, onAnnouncement }: Props) {
  const release = snapshot.release;
  const preview = release.announcementBody.split(/\r?\n/u).slice(0, 7).join('\n');
  const busy = snapshot.launching || (progress !== null && !['idle', 'running', 'error'].includes(progress.stage));
  return <main className="launcher-shell">
    <header className="launcher-topbar">
      <div className="brand"><img src="./logo.png" alt="Bestiary" /><div><strong>BESTIARY LAUNCHER</strong><span>5.1.0</span></div></div>
      <nav>
        <button onClick={onLibrary}>THƯ VIỆN</button>
        <button onClick={onSettings}>CÀI ĐẶT</button>
        <button onClick={onConsole}>CONSOLE</button>
      </nav>
    </header>

    <section className="hero-panel">
      <div className="server-block">
        <div className="eyebrow">{release.serverName || 'BESTIARY REBIRTH'}</div>
        <h1>{release.serverName || 'Bestiary Rebirth'}</h1>
        <p>{release.serverHost ? `${release.serverHost}:${release.serverPort}` : 'Máy chủ đang cập nhật địa chỉ.'}</p>
        <div className="profile-pill">CLIENT {settings.clientProfile ? settings.clientProfile.toUpperCase() : 'CHƯA CHỌN'}</div>
      </div>

      <aside className="announcement-card">
        <div className="eyebrow">SERVER ANNOUNCEMENT</div>
        <h3>{release.announcementTitle}</h3>
        <p className="announcement-preview">{preview}</p>
        <button className="secondary-button" onClick={onAnnouncement}>XEM ĐẦY ĐỦ</button>
      </aside>
    </section>

    <section className="play-panel">
      <label>TÊN NGƯỜI CHƠI<input value={settings.username} maxLength={16} onChange={(event) => onUsername(event.target.value)} /></label>
      <button className="play-button" disabled={busy} onClick={() => void onPlay()}>{snapshot.gameInstalled ? 'CHƠI' : 'CÀI CLIENT & CHƠI'}</button>
      <button className="discord-button" onClick={() => void onDiscord()}>DISCORD</button>
    </section>

    {progress && progress.stage !== 'idle' && <section className="progress-panel">
      <div><strong>{progress.title}</strong><span>{progress.detail}</span></div>
      <div className="progress-track"><i style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} /></div>
      <small>{progress.percent.toFixed(0)}%{progress.speedMBps > 0 ? ` · ${progress.speedMBps.toFixed(1)} MB/s` : ''}{progress.etaSeconds !== null ? ` · ${Math.ceil(progress.etaSeconds)}s` : ''}</small>
    </section>}
  </main>;
}

import type { LauncherSettings, LauncherSnapshot, UiProgressEvent } from '../../../shared/ipc';
import './Home.css';

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

const presetLabel = (value: string) => value ? value.toUpperCase() : 'BALANCED';

export function Home({ snapshot, settings, progress, onUsername, onPlay, onDiscord, onSettings, onLibrary, onConsole, onAnnouncement }: Props) {
  const release = snapshot.release;
  const preview = release.announcementBody.split(/\r?\n/u).filter(Boolean).slice(0, 4).join('\n');
  const busy = snapshot.launching || (progress !== null && !['idle', 'running', 'error'].includes(progress.stage));
  const profile = settings.clientProfile ? settings.clientProfile.toUpperCase() : 'CHƯA CÀI';
  const remoteVersion = release.version || '---';

  return <main className="bestiary-home">
    <header className="bestiary-titlebar">
      <div className="bestiary-titlebrand"><span className="title-dot" />BESTIARY LAUNCHER</div>
      <div className="bestiary-window-version">5.1.2</div>
    </header>

    <div className="bestiary-layout">
      <section className="bestiary-primary">
        <div className="bestiary-hero">
          <div className="bestiary-kicker">BESTIARY NETWORK</div>
          <img className="bestiary-logo" src="./logo.png" alt="Bestiary Rebirth" />
          <div className="bestiary-subtitle">Minecraft {release.minecraftVersion || '1.21.1'} · Fabric · Bestiary Client</div>
        </div>

        <div className="bestiary-statusbar">
          <div><span>REMOTE</span><strong>{remoteVersion}</strong></div>
          <i />
          <div><span>CLIENT</span><strong>{snapshot.gameInstalled ? profile : 'CHƯA CÀI'}</strong></div>
          <i />
          <div><span>RUNTIME</span><strong>JAVA 21</strong></div>
        </div>

        <div className="bestiary-playcard">
          <label className="bestiary-userfield">
            <span>TÊN NGƯỜI CHƠI</span>
            <input value={settings.username} maxLength={16} spellCheck={false} onChange={(event) => onUsername(event.target.value)} />
          </label>
          <button className="bestiary-play" disabled={busy} onClick={() => void onPlay()}>
            <span className="play-triangle">▶</span>
            {busy ? 'ĐANG CHUẨN BỊ...' : snapshot.gameInstalled ? 'CHƠI NGAY' : 'CÀI CLIENT & CHƠI'}
          </button>
        </div>

        {progress && progress.stage !== 'idle' && <section className="bestiary-progress">
          <div className="progress-copy"><strong>{progress.title}</strong><span>{progress.detail}</span></div>
          <div className="progress-track"><i style={{ width: `${Math.max(0, Math.min(100, progress.percent))}%` }} /></div>
          <small>{progress.percent.toFixed(0)}%{progress.speedMBps > 0 ? ` · ${progress.speedMBps.toFixed(1)} MB/s` : ''}{progress.etaSeconds !== null ? ` · ${Math.ceil(progress.etaSeconds)}s` : ''}</small>
        </section>}

        <div className="bestiary-actions">
          <button onClick={() => void onDiscord()}><b>◉</b><span><strong>Discord</strong><small>Cộng đồng Bestiary</small></span></button>
          <button onClick={onSettings}><b>⚙</b><span><strong>Cài đặt</strong><small>RAM · Runtime · Hiệu năng</small></span></button>
          <button onClick={onConsole}><b>▣</b><span><strong>Console</strong><small>Log game trực tiếp</small></span></button>
        </div>

        <button className="bestiary-library-link" onClick={onLibrary}>THƯ VIỆN CLIENT</button>
      </section>

      <aside className="bestiary-rail">
        <section className="bestiary-announcement">
          <header><span>SERVER ANNOUNCEMENT</span><i /></header>
          <div className="announcement-body">
            <h2>{release.announcementTitle || 'THÔNG BÁO MÁY CHỦ'}</h2>
            <p>{preview || 'Chưa có thông báo mới.'}</p>
          </div>
          <button onClick={onAnnouncement}>XEM ĐẦY ĐỦ</button>
          <footer><span>BESTIARY</span><span>{remoteVersion}</span></footer>
        </section>

        <section className="bestiary-system">
          <h3>SYSTEM</h3>
          <dl>
            <div><dt>RAM</dt><dd>{(snapshot.systemRamMb / 1024).toFixed(1)} GB</dd></div>
            <div><dt>PRESET</dt><dd>{presetLabel(settings.performancePreset)}</dd></div>
            <div><dt>DISPLAY</dt><dd>{settings.width}×{settings.height}</dd></div>
          </dl>
        </section>
      </aside>
    </div>
  </main>;
}

import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

type Settings = {
  username: string;
  minRamMb: number;
  maxRamMb: number;
  width: number;
  height: number;
  fullscreen: boolean;
  preset: 'low' | 'balanced' | 'performance' | 'custom';
  runtimeMode: 'managed' | 'system' | 'custom';
  customJavaPath: string;
  extraJvmArgs: string[];
};

type Remote = {
  brand: string;
  discordUrl: string;
  serverHost: string;
  announcements: Array<{ title?: string; body?: string; text?: string; date?: string; createdAt?: string }>;
  channelConnected: boolean;
  minecraftVersion: string;
  fabricLoader: string;
};

type Status = { installed: boolean; modCount: number; localVersion: string | null; remoteVersion: string | null };
type Progress = { phase?: string; percent?: number; currentFile?: string; speedMBps?: number; etaSeconds?: number | null; message?: string; completedFiles?: number; totalFiles?: number };

type Store = {
  ready: boolean; busy: boolean; settings: Settings | null; remote: Remote | null; status: Status | null; progress: Progress | null;
  error: string; gameState: string; logs: string[];
  hydrate(data: any): void; setBusy(value: boolean): void; setSettings(value: Settings): void; setProgress(value: Progress | null): void;
  setError(value: string): void; setGameState(value: string): void; addLog(value: string): void;
};

const useLauncher = create<Store>((set) => ({
  ready: false, busy: false, settings: null, remote: null, status: null, progress: null, error: '', gameState: 'idle', logs: [],
  hydrate: (data) => set({ ready: true, settings: data.settings, remote: data.remote, status: data.status, error: '' }),
  setBusy: (busy) => set({ busy }), setSettings: (settings) => set({ settings }), setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }), setGameState: (gameState) => set({ gameState }), addLog: (value) => set((s) => ({ logs: [...s.logs.slice(-249), value] }))
}));

function formatEta(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value < 60 ? `${Math.ceil(value)}s` : `${Math.ceil(value / 60)}m`;
}

function Titlebar() {
  return <header className="titlebar">
    <div className="title-brand"><span className="brand-mark" />BESTIARY LAUNCHER</div>
    <div className="window-controls">
      <button aria-label="Thu nhỏ" onClick={() => window.bestiary.minimize()}>−</button>
      <button aria-label="Phóng to" onClick={() => window.bestiary.maximize()}>□</button>
      <button className="close" aria-label="Đóng" onClick={() => window.bestiary.close()}>×</button>
    </div>
  </header>;
}

function SettingsModal({ close }: { close(): void }) {
  const current = useLauncher((s) => s.settings)!;
  const setSettings = useLauncher((s) => s.setSettings);
  const [draft, setDraft] = useState(current);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((s) => ({ ...s, [key]: value }));

  async function save() {
    setSaving(true);
    try { const saved = await window.bestiary.saveSettings(draft); setSettings(saved); close(); }
    finally { setSaving(false); }
  }

  return <div className="modal-layer" onMouseDown={(e) => e.currentTarget === e.target && close()}>
    <section className="settings-modal">
      <div className="modal-title"><div><span>CẤU HÌNH CLIENT</span><h2>Settings</h2></div><button onClick={close}>×</button></div>
      <article className="settings-card">
        <div className="setting-head"><span>RAM TỐI ĐA</span><strong>{(draft.maxRamMb / 1024).toFixed(1)} GB</strong></div>
        <input className="ram-range" type="range" min={2048} max={32768} step={512} value={draft.maxRamMb} onChange={(e) => set('maxRamMb', Number(e.target.value))} />
      </article>
      <article className="settings-card">
        <div className="setting-label">PERFORMANCE</div>
        <div className="preset-grid">
          {(['low','balanced','performance','custom'] as const).map((p) => <button key={p} className={draft.preset === p ? 'selected' : ''} onClick={() => set('preset', p)}>{p === 'low' ? 'NHẸ' : p === 'balanced' ? 'CÂN BẰNG' : p === 'performance' ? 'HIỆU NĂNG' : 'CUSTOM'}</button>)}
        </div>
        {draft.preset === 'custom' && <textarea value={draft.extraJvmArgs.join('\n')} onChange={(e) => set('extraJvmArgs', e.target.value.split(/\r?\n/).filter(Boolean))} placeholder="Mỗi JVM argument một dòng" />}
      </article>
      <div className="settings-columns">
        <article className="settings-card">
          <div className="setting-label">JAVA RUNTIME</div>
          <select value={draft.runtimeMode} onChange={(e) => set('runtimeMode', e.target.value as Settings['runtimeMode'])}>
            <option value="managed">Bestiary Managed</option><option value="system">Java hệ thống</option><option value="custom">Java custom</option>
          </select>
          {draft.runtimeMode === 'custom' && <input className="plain-input" placeholder="C:\\...\\java.exe" value={draft.customJavaPath} onChange={(e) => set('customJavaPath', e.target.value)} />}
        </article>
        <article className="settings-card">
          <div className="setting-label">ĐỘ PHÂN GIẢI</div>
          <div className="resolution"><input type="number" value={draft.width} onChange={(e) => set('width', Number(e.target.value))}/><span>×</span><input type="number" value={draft.height} onChange={(e) => set('height', Number(e.target.value))}/></div>
          <label className="checkbox"><input type="checkbox" checked={draft.fullscreen} onChange={(e) => set('fullscreen', e.target.checked)} />Toàn màn hình</label>
        </article>
      </div>
      <footer className="modal-actions"><button className="secondary" onClick={close}>HỦY</button><button className="primary" disabled={saving} onClick={save}>{saving ? 'ĐANG LƯU…' : 'LƯU THAY ĐỔI'}</button></footer>
    </section>
  </div>;
}

export default function App() {
  const state = useLauncher();
  const [showSettings, setShowSettings] = useState(false);
  const [showConsole, setShowConsole] = useState(false);

  useEffect(() => {
    let mounted = true;
    window.bestiary.bootstrap().then((data) => mounted && useLauncher.getState().hydrate(data)).catch((e) => mounted && useLauncher.getState().setError(e instanceof Error ? e.message : String(e)));
    const off = [
      window.bestiary.on('sync:progress', (p) => useLauncher.getState().setProgress(p)),
      window.bestiary.on('jre:progress', (p) => useLauncher.getState().setProgress(p)),
      window.bestiary.on('launcher:state', (p) => useLauncher.getState().setGameState(p?.state || 'idle')),
      window.bestiary.on('launcher:error', (p) => useLauncher.getState().setError(p?.message || 'Có lỗi xảy ra.')),
      window.bestiary.on('game:stdout', (p) => useLauncher.getState().addLog(String(p))),
      window.bestiary.on('game:stderr', (p) => useLauncher.getState().addLog(String(p))),
      window.bestiary.on('game:debug', (p) => useLauncher.getState().addLog(String(p)))
    ];
    return () => { mounted = false; off.forEach((fn) => fn()); };
  }, []);

  const playLabel = useMemo(() => {
    if (state.busy) return 'ĐANG CHUẨN BỊ…';
    if (!state.remote?.channelConnected) return 'CHƯA CÓ BẢN PHÁT HÀNH';
    if (!state.status?.installed) return 'CÀI CLIENT & CHƠI';
    if (state.status.remoteVersion && state.status.remoteVersion !== state.status.localVersion) return 'CẬP NHẬT & CHƠI';
    return 'CHƠI';
  }, [state.busy, state.remote, state.status]);

  async function start() {
    if (!state.settings || state.busy || !state.remote?.channelConnected) return;
    state.setBusy(true); state.setError(''); state.setProgress({ phase: 'starting', percent: 0, message: 'Đang chuẩn bị…' });
    try {
      const saved = await window.bestiary.saveSettings(state.settings); state.setSettings(saved);
      await window.bestiary.start();
      state.hydrate(await window.bestiary.bootstrap());
    } catch (e) { state.setError(e instanceof Error ? e.message : String(e)); }
    finally { state.setBusy(false); }
  }

  async function repair() {
    if (state.busy || !state.remote?.channelConnected) return;
    state.setBusy(true); state.setError('');
    try { await window.bestiary.repair(); state.hydrate(await window.bestiary.bootstrap()); }
    catch (e) { state.setError(e instanceof Error ? e.message : String(e)); }
    finally { state.setBusy(false); }
  }

  if (!state.ready) return <div className="loading"><div className="spinner" /><span>Đang khởi động Bestiary…</span></div>;
  const a = state.remote?.announcements?.[0];
  const p = state.progress;

  return <div className="app-shell">
    <Titlebar />
    <div className="glow glow-red"/><div className="glow glow-violet"/>
    <main className="content">
      <section className="home-card">
        <div className="home-toolbar">
          <div className="connection"><i className={state.remote?.channelConnected ? 'online' : ''}/>{state.remote?.channelConnected ? 'BESTIARY CLIENT ĐÃ KẾT NỐI' : 'CHƯA CÓ KÊNH PHÁT HÀNH'}</div>
          <button className="settings-button" onClick={() => setShowSettings(true)}>⚙ CÀI ĐẶT</button>
        </div>
        <div className="logo-zone"><img src="./logo.png" alt="Bestiary" /></div>
        <p className="stack-line">COBBLEMON RPG&nbsp;&nbsp;•&nbsp;&nbsp;MINECRAFT {state.remote?.minecraftVersion}&nbsp;&nbsp;•&nbsp;&nbsp;FABRIC {state.remote?.fabricLoader}</p>

        <div className="launch-panel">
          <div className="username-wrap"><label>TÊN NGƯỜI CHƠI</label><div className="username-box"><span>B</span><input maxLength={16} spellCheck={false} placeholder="Nhập tên người chơi" value={state.settings?.username || ''} onChange={(e) => state.settings && state.setSettings({ ...state.settings, username: e.target.value })}/></div></div>
          <button className="play" disabled={state.busy || !state.remote?.channelConnected} onClick={start}><b>▶</b>{playLabel}</button>
        </div>

        {p && (state.busy || p.phase !== 'complete') && <div className="sync-card">
          <div className="sync-row"><div><strong>{p.message || 'Đang đồng bộ client…'}</strong><small>{p.currentFile || 'Bestiary Client'}</small></div><b>{Math.round(p.percent || 0)}%</b></div>
          <div className="bar"><div style={{ width: `${Math.max(0, Math.min(100, p.percent || 0))}%` }}/></div>
          <div className="sync-meta"><span>{p.speedMBps ? `${p.speedMBps.toFixed(1)} MB/s` : 'Đang xử lý'}</span><span>{p.completedFiles != null && p.totalFiles != null ? `${p.completedFiles}/${p.totalFiles} file` : ''}</span><span>ETA {formatEta(p.etaSeconds)}</span></div>
        </div>}

        {state.error && <div className="error"><b>!</b><div><strong>Không thể tiếp tục</strong><p>{state.error}</p></div></div>}

        <div className="quick-actions">
          <button disabled={!state.remote?.discordUrl} onClick={() => state.remote?.discordUrl && window.bestiary.openExternal(state.remote.discordUrl)}><i className="discord">◈</i><span><strong>Discord</strong><small>{state.remote?.discordUrl ? 'Cộng đồng Bestiary' : 'Chưa cấu hình'}</small></span><em>↗</em></button>
          <button onClick={() => setShowSettings(true)}><i>⚙</i><span><strong>Performance</strong><small>{state.settings?.preset} • {(state.settings!.maxRamMb / 1024).toFixed(1)} GB</small></span><em>›</em></button>
          <button disabled={state.busy || !state.remote?.channelConnected} onClick={repair}><i>↻</i><span><strong>Kiểm tra file</strong><small>Hash & sửa client</small></span><em>›</em></button>
        </div>
      </section>

      <aside className="side-card">
        <div className="side-title"><span>SERVER ANNOUNCEMENT</span><b>LIVE</b></div>
        <div className="announcement">{a ? <><h2>{a.title || 'Thông báo máy chủ'}</h2><p>{a.body || a.text || ''}</p><small>{a.date || a.createdAt || ''}</small></> : <><h2>Bestiary</h2><p>Chưa có thông báo máy chủ mới.</p></>}</div>
        <div className="client-card"><span>CLIENT</span><div className="versions"><strong>{state.status?.localVersion || 'Chưa cài'}</strong><i>→</i><strong>{state.status?.remoteVersion || '—'}</strong></div><div className="metrics"><div><small>MODS</small><b>{state.status?.modCount || 0}</b></div><div><small>RUNTIME</small><b>{state.settings?.runtimeMode || 'managed'}</b></div></div></div>
        <button className="console-button" onClick={() => setShowConsole((v) => !v)}>{showConsole ? 'ẨN CONSOLE' : 'MỞ CONSOLE'}<span>⌘</span></button>
      </aside>
    </main>

    {showConsole && <div className="console"><header><span>BESTIARY / GAME LOG</span><button onClick={() => setShowConsole(false)}>×</button></header><pre>{state.logs.length ? state.logs.join('') : 'Chưa có log.'}</pre></div>}
    {showSettings && <SettingsModal close={() => setShowSettings(false)} />}
  </div>;
}

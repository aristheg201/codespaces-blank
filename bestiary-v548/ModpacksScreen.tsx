import { useEffect, useState } from 'react';
import type { LibraryItem, LibrarySnapshot, ModpackInfo } from '../../../shared/ipc';
import './ModpacksScreen.css';

const EMPTY: LibrarySnapshot = { mods: [], resourcepacks: [], shaderpacks: [] };
type Kind = keyof LibrarySnapshot;

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function ModpacksScreen({ onBack }: { onBack: () => void }) {
  const [packs, setPacks] = useState<ModpackInfo[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibrarySnapshot>(EMPTY);
  const [kind, setKind] = useState<Kind>('mods');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const active = packs.find((pack) => pack.id === selected) ?? null;

  async function refresh(target?: string | null) {
    const list = await window.bestiary.listModpacks();
    setPacks(list);
    const id = target === undefined ? selected : target;
    const next = id && list.some((item) => item.id === id) ? id : list[0]?.id ?? null;
    setSelected(next);
    setLibrary(next ? await window.bestiary.getModpackLibrary(next) : EMPTY);
  }

  useEffect(() => { void refresh().catch((error) => setError(errorText(error))); }, []);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try { await work(); } catch (error) { setError(errorText(error)); }
    finally { setBusy(false); }
  }

  function create() {
    const name = window.prompt('Tên modpack mới');
    if (!name) return;
    void run(async () => {
      const pack = await window.bestiary.createModpack(name);
      await refresh(pack.id);
      setMessage('Đã tạo modpack mới.');
    });
  }

  function rename() {
    if (!active) return;
    const name = window.prompt('Đổi tên modpack', active.name);
    if (!name) return;
    void run(async () => {
      await window.bestiary.renameModpack(active.id, name);
      await refresh(active.id);
    });
  }

  function duplicate() {
    if (!active) return;
    void run(async () => {
      const pack = await window.bestiary.duplicateModpack(active.id);
      await refresh(pack.id);
      setMessage('Đã nhân bản modpack, bao gồm cấu hình và world.');
    });
  }

  function remove() {
    if (!active || !window.confirm('Xóa vĩnh viễn modpack "' + active.name + '" và tất cả world của nó?')) return;
    void run(async () => {
      await window.bestiary.removeModpack(active.id);
      await refresh(null);
    });
  }

  function importZip() {
    void run(async () => {
      const pack = await window.bestiary.importModpackZip();
      if (pack) {
        await refresh(pack.id);
        setMessage('Đã nhập modpack từ ZIP.');
      }
    });
  }

  function exportZip() {
    if (!active) return;
    void run(async () => {
      const includeWorlds = window.confirm('Có xuất kèm world Singleplayer? Chọn Cancel để chỉ xuất modpack và config.');
      const saved = await window.bestiary.exportModpackZip(active.id, includeWorlds);
      if (saved) setMessage('Đã xuất: ' + saved);
    });
  }

  function installFiles() {
    if (!active) return;
    void run(async () => {
      const paths = await window.bestiary.chooseAnyContentFiles();
      if (!paths.length) return;
      const result = await window.bestiary.installModpackFiles(active.id, paths);
      setLibrary(result.snapshot);
      const report = result.skipped.map((item) => item.fileName + ': ' + item.reason);
      setMessage('Đã nhập ' + result.imported.length + ' file.');
      if (report.length) setError(report.join('\n'));
    });
  }

  function updateItem(item: LibraryItem, action: 'toggle' | 'remove') {
    if (!active) return;
    void run(async () => {
      const next = action === 'toggle'
        ? await window.bestiary.toggleModpackFile(active.id, item.path)
        : await window.bestiary.removeModpackFile(active.id, item.path);
      setLibrary(next);
    });
  }

  return <main className="modpacks-screen">
    <header className="modpacks-top">
      <div><button onClick={onBack}>← TRỞ VỀ</button><p>BESTIARY LAUNCHER</p><h1>My Modpacks</h1>
        <small>Modpack cá nhân độc lập với SVFrame. Minecraft 1.21.1 · Fabric 0.18.4 · Java 21</small>
      </div>
      <div className="modpacks-actions">
        <button disabled={busy} onClick={importZip}>IMPORT ZIP</button>
        <button disabled={busy} className="primary" onClick={create}>+ CREATE MODPACK</button>
      </div>
    </header>
    {error && <pre className="modpacks-error">{error}</pre>}
    {message && <div className="modpacks-message">{message}</div>}
    <div className="modpacks-columns">
      <aside className="modpacks-sidebar">
        <h3>MY MODPACKS ({packs.length})</h3>
        <div className="modpacks-server">
          <strong>SVFrame Official</strong><small>Server-managed · giữ nguyên trong launcher</small>
        </div>
        {packs.map((pack) => <button key={pack.id} onClick={() => void run(async () => { setSelected(pack.id); setLibrary(await window.bestiary.getModpackLibrary(pack.id)); })}
          className={'modpacks-choice' + (selected === pack.id ? ' active' : '')}>
          <strong>{pack.name}</strong>
          <small>{pack.minecraftVersion} · {pack.loader} {pack.fabricLoader}</small>
        </button>)}
      </aside>
      <section className="modpacks-main">
        {!active ? <div className="modpacks-empty"><h2>Chưa có modpack cá nhân</h2><p>Tạo một profile riêng hoặc nhập từ ZIP để bắt đầu.</p></div> : <>
          <div className="modpacks-heading">
            <div><small>PERSONAL MODPACK</small><h2>{active.name}</h2>
              <p>Minecraft {active.minecraftVersion} · Fabric {active.fabricLoader}</p>
            </div>
            <div className="modpacks-actions">
              <button disabled={busy} onClick={rename}>RENAME</button>
              <button disabled={busy} onClick={duplicate}>DUPLICATE</button>
              <button disabled={busy} onClick={exportZip}>EXPORT ZIP</button>
              <button disabled={busy} onClick={remove}>DELETE</button>
            </div>
          </div>
          <div className="modpacks-tabs">
            {(['mods', 'resourcepacks', 'shaderpacks'] as const).map((tab) =>
              <button key={tab} className={kind === tab ? 'active' : ''} onClick={() => setKind(tab)}>
                {tab.toUpperCase()} · {library[tab].length}
              </button>)}
            <button disabled={busy} className="primary" onClick={installFiles}>+ ADD FILES</button>
          </div>
          <div className="modpacks-files">
            {library[kind].map((item) => <div key={item.id} className="modpacks-file">
              <div><strong>{item.displayName}</strong><small>{item.modId ?? item.fileName} {item.version || ''}</small></div>
              <div className="modpacks-file-actions">
                {item.kind === 'mods' && <button disabled={busy} onClick={() => updateItem(item, 'toggle')}>{item.enabled ? 'DISABLE' : 'ENABLE'}</button>}
                <button disabled={busy} onClick={() => updateItem(item, 'remove')}>REMOVE</button>
              </div>
            </div>)}
            {!library[kind].length && <div className="modpacks-empty">Không có file nào. Chọn ADD FILES để cài nội dung cho modpack này.</div>}
          </div>
          <div className="modpacks-note">Mỗi modpack có thư mục mods, config, resourcepacks, shaderpacks và saves riêng. Import CurseForge có projectID/fileID cần bộ tải CurseForge API; launcher hiện sẽ báo rõ thay vì tạo pack thiếu mod.</div>
        </>}
      </section>
    </div>
  </main>;
}

import { useEffect, useState } from 'react';
import type { LibraryItem, LibrarySnapshot, ModpackInfo } from '../../../shared/ipc';
import './ModpacksScreen.css';

const EMPTY: LibrarySnapshot = { mods: [], resourcepacks: [], shaderpacks: [] };
type Kind = keyof LibrarySnapshot;
type ModpackDialog =
  | { kind: 'create'; name: string }
  | { kind: 'rename'; packId: string; name: string }
  | { kind: 'delete'; packId: string; name: string }
  | { kind: 'export'; packId: string; name: string; includeWorlds: boolean };

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
  const [dialog, setDialog] = useState<ModpackDialog | null>(null);
  const active = packs.find((pack) => pack.id === selected) ?? null;

  async function refresh(target?: string | null) {
    const list = await window.bestiary.listModpacks();
    setPacks(list);
    const id = target === undefined ? selected : target;
    const next = id && list.some((item) => item.id === id) ? id : list[0]?.id ?? null;
    setSelected(next);
    setLibrary(next ? await window.bestiary.getModpackLibrary(next) : EMPTY);
  }

  useEffect(() => {
    void refresh().catch((cause) => setError(errorText(cause)));
  }, []);

  async function run(work: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await work();
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setError('');
    setDialog({ kind: 'create', name: '' });
  }

  function openRename() {
    if (!active) return;
    setError('');
    setDialog({ kind: 'rename', packId: active.id, name: active.name });
  }

  function openDelete() {
    if (!active) return;
    setError('');
    setDialog({ kind: 'delete', packId: active.id, name: active.name });
  }

  function openExport() {
    if (!active) return;
    setError('');
    setDialog({ kind: 'export', packId: active.id, name: active.name, includeWorlds: false });
  }

  async function submitDialog() {
    const current = dialog;
    if (!current || busy) return;

    if (current.kind === 'create' || current.kind === 'rename') {
      const name = current.name.trim();
      if (name.length < 2 || name.length > 64 || /[\x00-\x1f]/u.test(name)) {
        setError('Tên modpack phải có 2–64 ký tự hợp lệ.');
        return;
      }
      const success = await run(async () => {
        if (current.kind === 'create') {
          const pack = await window.bestiary.createModpack(name);
          await refresh(pack.id);
          setMessage('Đã tạo modpack: ' + pack.name);
        } else {
          const pack = await window.bestiary.renameModpack(current.packId, name);
          await refresh(pack.id);
          setMessage('Đã đổi tên modpack.');
        }
      });
      if (success) setDialog(null);
      return;
    }

    if (current.kind === 'delete') {
      const success = await run(async () => {
        await window.bestiary.removeModpack(current.packId);
        await refresh(null);
        setMessage('Đã xóa modpack ' + current.name + '.');
      });
      if (success) setDialog(null);
      return;
    }

    if (current.kind === 'export') {
      const success = await run(async () => {
        const saved = await window.bestiary.exportModpackZip(current.packId, current.includeWorlds);
        if (saved) setMessage('Đã xuất: ' + saved);
      });
      if (success) setDialog(null);
    }
  }

  function duplicate() {
    if (!active) return;
    void run(async () => {
      const pack = await window.bestiary.duplicateModpack(active.id);
      await refresh(pack.id);
      setMessage('Đã nhân bản modpack, bao gồm cấu hình và world.');
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

  const isNameDialog = dialog?.kind === 'create' || dialog?.kind === 'rename';
  const dialogTitle = dialog?.kind === 'create' ? 'Tạo Modpack'
    : dialog?.kind === 'rename' ? 'Đổi tên Modpack'
      : dialog?.kind === 'delete' ? 'Xóa Modpack' : 'Xuất Modpack';

  return <main className="modpacks-screen">
    <header className="modpacks-top">
      <div><button onClick={onBack}>← TRỞ VỀ</button><p>BESTIARY LAUNCHER</p><h1>My Modpacks</h1>
        <small>Modpack cá nhân độc lập với SVFrame. Minecraft 1.21.1 · Fabric 0.18.4 · Java 21</small>
      </div>
      <div className="modpacks-actions">
        <button disabled={busy || dialog !== null} onClick={importZip}>IMPORT ZIP</button>
        <button disabled={busy || dialog !== null} className="primary" onClick={openCreate}>+ CREATE MODPACK</button>
      </div>
    </header>
    {error && <pre className="modpacks-error" role="alert">{error}</pre>}
    {message && <div className="modpacks-message" role="status">{message}</div>}
    <div className="modpacks-columns">
      <aside className="modpacks-sidebar">
        <h3>MY MODPACKS ({packs.length})</h3>
        <div className="modpacks-server">
          <strong>SVFrame Official</strong><small>Server-managed · giữ nguyên trong launcher</small>
        </div>
        {packs.map((pack) => <button key={pack.id} disabled={busy || dialog !== null}
          onClick={() => void run(async () => { setSelected(pack.id); setLibrary(await window.bestiary.getModpackLibrary(pack.id)); })}
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
              <button disabled={busy || dialog !== null} onClick={openRename}>RENAME</button>
              <button disabled={busy || dialog !== null} onClick={duplicate}>DUPLICATE</button>
              <button disabled={busy || dialog !== null} onClick={openExport}>EXPORT ZIP</button>
              <button disabled={busy || dialog !== null} onClick={openDelete}>DELETE</button>
            </div>
          </div>
          <div className="modpacks-tabs">
            {(['mods', 'resourcepacks', 'shaderpacks'] as const).map((tab) =>
              <button key={tab} className={kind === tab ? 'active' : ''} onClick={() => setKind(tab)}>
                {tab.toUpperCase()} · {library[tab].length}
              </button>)}
            <button disabled={busy || dialog !== null} className="primary" onClick={installFiles}>+ ADD FILES</button>
          </div>
          <div className="modpacks-files">
            {library[kind].map((item) => <div key={item.id} className="modpacks-file">
              <div><strong>{item.displayName}</strong><small>{item.modId ?? item.fileName} {item.version || ''}</small></div>
              <div className="modpacks-file-actions">
                {item.kind === 'mods' && <button disabled={busy || dialog !== null} onClick={() => updateItem(item, 'toggle')}>{item.enabled ? 'DISABLE' : 'ENABLE'}</button>}
                <button disabled={busy || dialog !== null} onClick={() => updateItem(item, 'remove')}>REMOVE</button>
              </div>
            </div>)}
            {!library[kind].length && <div className="modpacks-empty">Không có file nào. Chọn ADD FILES để cài nội dung cho modpack này.</div>}
          </div>
          <div className="modpacks-note">Mỗi modpack có thư mục mods, config, resourcepacks, shaderpacks và saves riêng. Import CurseForge có projectID/fileID cần bộ tải CurseForge API; launcher hiện sẽ báo rõ thay vì tạo pack thiếu mod.</div>
        </>}
      </section>
    </div>

    {dialog && <div className="modpacks-dialog-backdrop">
      <div className="modpacks-dialog" role="dialog" aria-modal="true" aria-labelledby="modpacks-dialog-title"
        onKeyDown={(event) => { if (event.key === 'Escape' && !busy) setDialog(null); }}>
        <form onSubmit={(event) => { event.preventDefault(); void submitDialog(); }}>
          <h2 id="modpacks-dialog-title">{dialogTitle}</h2>
          {isNameDialog && <label className="modpacks-field" htmlFor="modpack-name">
            <span>TÊN MODPACK</span>
            <input id="modpack-name" autoFocus required minLength={2} maxLength={64}
              value={dialog.name} disabled={busy} placeholder="Ví dụ: Survival RPG"
              onChange={(event) => setDialog({ ...dialog, name: event.target.value })} />
            <small>Minecraft 1.21.1 · Fabric 0.18.4 · Java 21</small>
          </label>}
          {dialog.kind === 'delete' && <p className="modpacks-danger-text">Xóa vĩnh viễn <strong>{dialog.name}</strong>, bao gồm mods, config và tất cả world Singleplayer trong pack này. Không thể hoàn tác.</p>}
          {dialog.kind === 'export' && <>
            <p>Xuất modpack <strong>{dialog.name}</strong> thành ZIP.</p>
            <label className="modpacks-checkbox">
              <input type="checkbox" checked={dialog.includeWorlds} disabled={busy}
                onChange={(event) => setDialog({ ...dialog, includeWorlds: event.target.checked })} />
              Bao gồm world Singleplayer (saves)
            </label>
          </>}
          <div className="modpacks-dialog-actions">
            <button type="button" disabled={busy} onClick={() => setDialog(null)}>HỦY</button>
            <button type="submit" disabled={busy || (isNameDialog && dialog.name.trim().length < 2)}
              className={dialog.kind === 'delete' ? 'danger' : 'primary'}>
              {busy ? 'ĐANG XỬ LÝ...' : dialog.kind === 'create' ? 'TẠO MODPACK'
                : dialog.kind === 'rename' ? 'LƯU TÊN' : dialog.kind === 'delete' ? 'XÓA VĨNH VIỄN' : 'XUẤT ZIP'}
            </button>
          </div>
        </form>
      </div>
    </div>}
  </main>;
}

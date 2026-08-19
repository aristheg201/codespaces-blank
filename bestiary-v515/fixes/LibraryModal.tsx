import { useEffect, useMemo, useState } from 'react';
import type { LibraryImportResult, LibraryItem, LibraryKind, LibrarySnapshot } from '../../../shared/ipc';
import './LibraryUx.css';

interface Props { open: boolean; onClose: () => void; }
const EMPTY: LibrarySnapshot = { mods: [], resourcepacks: [], shaderpacks: [] };
const TABS: Array<{ id: LibraryKind; label: string; helper: string }> = [
  { id: 'mods', label: 'Mods', helper: 'Fabric .jar' },
  { id: 'resourcepacks', label: 'Resource Packs', helper: 'Minecraft .zip' },
  { id: 'shaderpacks', label: 'Shaders', helper: 'Shader .zip' },
];
function fmt(bytes: number): string { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function kindLabel(kind: LibraryKind) { return kind === 'mods' ? 'MOD' : kind === 'shaderpacks' ? 'SHADER' : 'RESOURCE PACK'; }

export function LibraryModal({ open, onClose }: Props) {
  const [tab, setTab] = useState<LibraryKind>('mods');
  const [data, setData] = useState<LibrarySnapshot>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const items = useMemo(() => data[tab], [data, tab]);
  const totals = useMemo(() => ({ mods: data.mods.length, resourcepacks: data.resourcepacks.length, shaderpacks: data.shaderpacks.length }), [data]);

  const refresh = async () => setData(await window.bestiary.getLibrary());
  useEffect(() => { if (open) void refresh().catch((e) => setError(String(e))); }, [open]);
  if (!open) return null;

  const run = async (fn: () => Promise<LibrarySnapshot | void>) => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await fn(); if (result) setData(result); else await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const summarizeImport = (result: LibraryImportResult) => {
    setData(result.snapshot);
    const good = result.imported.length ? `Đã cài ${result.imported.length} file` : '';
    const bad = result.skipped.length ? `${result.skipped.length} file bỏ qua` : '';
    setNotice([good, bad].filter(Boolean).join(' · ') || 'Không có thay đổi.');
    if (result.skipped.length) setError(result.skipped.map((item) => `${item.fileName}: ${item.reason}`).join('\n'));
  };

  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    setBusy(true); setError(''); setNotice('');
    try { summarizeImport(await window.bestiary.importLibraryFiles(paths)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setDragging(false); }
  };

  const pickAuto = async () => importPaths(await window.bestiary.chooseAnyContentFiles());
  const installTyped = () => run(async () => {
    const paths = await window.bestiary.chooseLibraryFiles(tab);
    return paths.length ? window.bestiary.installLibraryFiles(tab, paths) : data;
  });
  const toggle = (item: LibraryItem) => run(() => window.bestiary.toggleLibraryItem(item.path));
  const remove = (item: LibraryItem) => run(() => window.bestiary.removeLibraryItem(item.path));
  const drop = async (event: React.DragEvent) => {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files).map((file) => window.bestiary.getPathForFile(file)).filter(Boolean);
    await importPaths(paths);
  };

  return <div className="modal-backdrop library-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="library-v2" role="dialog" aria-modal="true" aria-label="Thư viện client">
      <header className="library-v2-header">
        <div><div className="library-kicker">CLIENT LIBRARY</div><h2>Nội dung cá nhân</h2><p>Tải từ Modrinth / CurseForge web rồi kéo thả vào đây. Launcher tự nhận mod, resource pack hay shader và đặt đúng chỗ.</p></div>
        <button className="library-close" onClick={onClose}>×</button>
      </header>

      <div className="library-v2-tabs">{TABS.map((item) => <button className={tab === item.id ? 'active' : ''} key={item.id} onClick={() => setTab(item.id)}><strong>{item.label}</strong><span>{totals[item.id]} · {item.helper}</span></button>)}</div>

      <div className="library-v2-body">
        <section className={`library-dropzone${dragging ? ' is-dragging' : ''}`} onDragEnter={(e) => { e.preventDefault(); setDragging(true); }} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }} onDrop={(e) => void drop(e)}>
          <div className="drop-icon">↓</div>
          <div><strong>KÉO MOD / RESOURCE PACK / SHADER VÀO ĐÂY</strong><span>Hỗ trợ Fabric .jar và .zip. Không cần tự tìm thư mục mods/resourcepacks/shaderpacks.</span></div>
          <button disabled={busy} onClick={() => void pickAuto()}>{busy ? 'ĐANG ĐỌC...' : 'CHỌN FILE'}</button>
        </section>

        <div className="library-toolbar-v2">
          <div><strong>{TABS.find((item) => item.id === tab)?.label}</strong><span>{items.length} file · Bestiary managed và nội dung cá nhân được tách riêng</span></div>
          <div><button disabled={busy} onClick={() => void installTyped()}>+ CÀI {kindLabel(tab)}</button><button className="ghost" onClick={() => void window.bestiary.openLibraryFolder(tab)}>MỞ THƯ MỤC</button></div>
        </div>

        {notice && <div className="library-notice">{notice}</div>}
        {error && <pre className="library-error-v2">{error}</pre>}

        <div className="library-table">
          <div className="library-table-head"><span>NỘI DUNG</span><span>DUNG LƯỢNG</span><span>NGUỒN</span><span>TRẠNG THÁI</span><span>THAO TÁC</span></div>
          <div className="library-table-scroll">
            {items.map((item) => <div className="library-row-v2" key={item.id}>
              <div className="library-item-main"><div className={`library-item-icon ${item.kind}`}>{item.kind === 'mods' ? 'M' : item.kind === 'shaderpacks' ? 'S' : 'R'}</div><div><strong>{item.displayName}</strong><span>{item.modId ? `${item.modId}${item.version ? ` · ${item.version}` : ''}` : item.fileName}</span></div></div>
              <div className="library-cell muted">{fmt(item.size)}</div>
              <div className="library-cell"><span className={item.managed ? 'owner-managed' : 'owner-personal'}>{item.managed ? 'BESTIARY' : 'CÁ NHÂN'}</span></div>
              <div className="library-cell"><span className={`state-pill ${item.status || ''}`}>{item.managed ? 'SERVER QUẢN LÝ' : tab === 'mods' ? (item.enabled ? 'ĐANG BẬT' : 'ĐÃ TẮT') : 'ĐÃ CÀI'}</span></div>
              <div className="library-row-actions">{tab === 'mods' && !item.managed && <button disabled={busy} onClick={() => void toggle(item)}>{item.enabled ? 'TẮT' : 'BẬT'}</button>}{!item.managed && <button disabled={busy} className="danger" onClick={() => void remove(item)}>GỠ</button>}{item.managed && <span>Khóa</span>}</div>
            </div>)}
            {!items.length && <div className="library-empty-v2"><strong>Chưa có {TABS.find((item) => item.id === tab)?.label.toLowerCase()}</strong><span>Kéo file vào vùng phía trên để cài.</span></div>}
          </div>
        </div>
      </div>
      <footer className="library-footer-v2"><span>Bestiary sync chỉ đụng file server quản lý. Nội dung cá nhân không bị xóa khi update hoặc đổi Full/Lite.</span><b>Không tự sửa options.txt</b></footer>
    </section>
  </div>;
}

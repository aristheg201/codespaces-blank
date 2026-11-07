import { useEffect, useMemo, useState } from 'react';
import type { LibraryImportResult, LibraryItem, LibraryKind, LibrarySnapshot } from '../../../shared/ipc';
import './ContentScreen.css';

interface Props { onBack: () => void; }
const EMPTY: LibrarySnapshot = { mods: [], resourcepacks: [], shaderpacks: [] };
const TABS: Array<{ id: LibraryKind; label: string; hint: string }> = [
  { id: 'mods', label: 'MODS', hint: 'Fabric .jar' },
  { id: 'resourcepacks', label: 'RESOURCE PACKS', hint: 'Minecraft .zip' },
  { id: 'shaderpacks', label: 'SHADERS', hint: 'Shader .zip' },
];
const fmt = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function ContentScreen({ onBack }: Props) {
  const [data, setData] = useState<LibrarySnapshot>(EMPTY);
  const [tab, setTab] = useState<LibraryKind>('mods');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'managed' | 'personal' | 'disabled'>('all');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => setData(await window.bestiary.getLibrary());
  useEffect(() => { void refresh().catch((e) => setError(String(e))); }, []);

  const current = data[tab];
  const visible = useMemo(() => current.filter((item) => {
    const haystack = `${item.displayName} ${item.fileName} ${item.modId ?? ''} ${item.version ?? ''}`.toLowerCase();
    if (query && !haystack.includes(query.toLowerCase())) return false;
    if (filter === 'managed' && !item.managed) return false;
    if (filter === 'personal' && item.managed) return false;
    if (filter === 'disabled' && (item.kind !== 'mods' || item.enabled)) return false;
    return true;
  }), [current, query, filter]);

  const run = async (fn: () => Promise<LibrarySnapshot>) => {
    setBusy(true); setError(''); setMessage('');
    try { setData(await fn()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const summarize = (result: LibraryImportResult) => {
    setData(result.snapshot);
    const a = result.imported.length;
    const b = result.skipped.length;
    setMessage(a ? `Đã cài ${a} nội dung.` : 'Không có file mới để cài.');
    if (b) setError(result.skipped.map((x) => `${x.fileName}: ${x.reason}`).join('\n'));
  };
  const importPaths = async (paths: string[]) => {
    if (!paths.length) return;
    setBusy(true); setError(''); setMessage('');
    try { summarize(await window.bestiary.importLibraryFiles(paths)); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); setDragging(false); }
  };
  const drop = async (event: React.DragEvent) => {
    event.preventDefault();
    const paths = Array.from(event.dataTransfer.files).map((f) => window.bestiary.getPathForFile(f)).filter(Boolean);
    await importPaths(paths);
  };

  return <main className="content-screen" onDragOver={(e) => e.preventDefault()} onDrop={(e) => void drop(e)}>
    <header className="content-topbar">
      <button className="content-back" onClick={onBack}>← TRỞ VỀ</button>
      <div><span>BESTIARY CLIENT</span><h1>Content Manager</h1><p>Mods, resource packs và shaders trong một chỗ. Kéo file vào, Launcher tự phân loại.</p></div>
      <button className="content-add" disabled={busy} onClick={() => void window.bestiary.chooseAnyContentFiles().then(importPaths)}>+ THÊM NỘI DUNG</button>
    </header>

    <section className={`content-drop${dragging ? ' active' : ''}`} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)}>
      <b>↓ KÉO THẢ FILE VÀO ĐÂY</b><span>Fabric mod .jar · Resource pack .zip · Shader .zip</span>
    </section>

    <nav className="content-tabs">{TABS.map((t) => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><strong>{t.label}</strong><small>{data[t.id].length} · {t.hint}</small></button>)}</nav>

    <section className="content-toolbar">
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên, mod ID hoặc version..." />
      <div className="content-filters">{(['all','managed','personal','disabled'] as const).map((f) => <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'TẤT CẢ' : f === 'managed' ? 'BESTIARY' : f === 'personal' ? 'CÁ NHÂN' : 'ĐÃ TẮT'}</button>)}</div>
      <button className="folder" onClick={() => void window.bestiary.openLibraryFolder(tab)}>MỞ THƯ MỤC</button>
    </section>

    {message && <div className="content-message">{message}</div>}
    {error && <pre className="content-error">{error}</pre>}

    <section className="content-list">
      <div className="content-head"><span>NỘI DUNG</span><span>VERSION</span><span>DUNG LƯỢNG</span><span>NGUỒN</span><span>TRẠNG THÁI</span><span>THAO TÁC</span></div>
      <div className="content-scroll">{visible.map((item: LibraryItem) => <div className="content-row" key={item.id}>
        <div className="content-name"><i>{item.kind === 'mods' ? 'M' : item.kind === 'resourcepacks' ? 'R' : 'S'}</i><div><strong>{item.displayName}</strong><small>{item.modId || item.fileName}</small></div></div>
        <span>{item.version || '—'}</span><span>{fmt(item.size)}</span>
        <span><b className={item.managed ? 'managed' : 'personal'}>{item.managed ? 'BESTIARY' : 'CÁ NHÂN'}</b></span>
        <span><b className={`content-state ${item.managed ? 'locked' : item.enabled ? 'on' : 'off'}`}>{item.managed ? 'SERVER QUẢN LÝ' : item.kind === 'mods' ? item.enabled ? 'ĐANG BẬT' : 'ĐÃ TẮT' : 'ĐÃ CÀI'}</b></span>
        <div className="content-actions">{item.kind === 'mods' && !item.managed && <button disabled={busy} onClick={() => void run(() => window.bestiary.toggleLibraryItem(item.path))}>{item.enabled ? 'TẮT' : 'BẬT'}</button>}{!item.managed && <button className="danger" disabled={busy} onClick={() => void run(() => window.bestiary.removeLibraryItem(item.path))}>GỠ</button>}{item.managed && <span>🔒</span>}</div>
      </div>)}{!visible.length && <div className="content-empty"><strong>Không có nội dung phù hợp</strong><span>Kéo file vào phía trên hoặc đổi bộ lọc.</span></div>}</div>
    </section>
  </main>;
}

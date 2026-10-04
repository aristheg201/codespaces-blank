import { useEffect, useMemo, useState } from 'react';
import type { KeybindEntry } from '../../../shared/ipc';
import './KeybindPanel.css';

function keyName(value: string): string {
  return value
    .replace(/^key\.keyboard\./u, '')
    .replace(/^key\.mouse\./u, 'MOUSE ')
    .replace(/^scancode\./u, 'SCAN ')
    .replace(/[._-]+/gu, ' ')
    .toUpperCase();
}

function minecraftKey(code: string): string | null {
  if (/^Key[A-Z]$/u.test(code)) return 'key.keyboard.' + code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/u.test(code)) return 'key.keyboard.' + code.slice(5);
  if (/^F(?:[1-9]|1[0-2])$/u.test(code)) return 'key.keyboard.' + code.toLowerCase();
  const names: Record<string, string> = {
    Space: 'space', Enter: 'enter', Tab: 'tab', Backspace: 'backspace',
    Delete: 'delete', Insert: 'insert', Home: 'home', End: 'end',
    PageUp: 'page.up', PageDown: 'page.down',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    ShiftLeft: 'left.shift', ShiftRight: 'right.shift',
    ControlLeft: 'left.control', ControlRight: 'right.control',
    AltLeft: 'left.alt', AltRight: 'right.alt',
    CapsLock: 'caps.lock', NumLock: 'num.lock',
    Minus: 'minus', Equal: 'equal', BracketLeft: 'left.bracket',
    BracketRight: 'right.bracket', Backslash: 'backslash',
    Semicolon: 'semicolon', Quote: 'apostrophe', Comma: 'comma',
    Period: 'period', Slash: 'slash', Backquote: 'grave.accent',
  };
  return names[code] ? 'key.keyboard.' + names[code] : null;
}

export function KeybindPanel() {
  const [entries, setEntries] = useState<KeybindEntry[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [captureId, setCaptureId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await window.bestiary.getKeybinds();
      setEntries(snapshot.entries);
      setDraft(Object.fromEntries(snapshot.entries.map((entry) => [entry.id, entry.key])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!captureId) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.code === 'Escape') {
        setCaptureId(null);
        return;
      }
      const key = minecraftKey(event.code);
      if (!key) return;
      setDraft((current) => ({ ...current, [captureId]: key }));
      setCaptureId(null);
    };
    const onMouse = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button < 0 || event.button > 7) return;
      setDraft((current) => ({ ...current, [captureId]: 'key.mouse.' + String(event.button + 1) }));
      setCaptureId(null);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onMouse, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onMouse, true);
    };
  }, [captureId]);

  const conflicts = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const entry of entries) {
      const value = draft[entry.id] ?? entry.key;
      if (!value || value === 'key.keyboard.unknown') continue;
      const ids = groups.get(value) ?? [];
      ids.push(entry.id);
      groups.set(value, ids);
    }
    const result = new Map<string, string[]>();
    for (const ids of groups.values()) {
      if (ids.length < 2) continue;
      for (const id of ids) result.set(id, ids.filter((other) => other !== id));
    }
    return result;
  }, [entries, draft]);

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter((entry) => (
      entry.label.toLowerCase().includes(query)
      || entry.category.toLowerCase().includes(query)
      || entry.id.toLowerCase().includes(query)
      || keyName(draft[entry.id] ?? entry.key).toLowerCase().includes(query)
    ));
  }, [entries, draft, search]);

  const dirty = entries.some((entry) => !entry.locked && (draft[entry.id] ?? entry.key) !== entry.key);

  const save = async () => {
    const changes = entries
      .filter((entry) => !entry.locked && draft[entry.id] && draft[entry.id] !== entry.key)
      .map((entry) => ({ id: entry.id, key: draft[entry.id] }));
    if (!changes.length) return;
    setSaving(true);
    setError('');
    try {
      const snapshot = await window.bestiary.saveKeybinds(changes);
      setEntries(snapshot.entries);
      setDraft(Object.fromEntries(snapshot.entries.map((entry) => [entry.id, entry.key])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return <section className="ux-settings-section">
    <div className="ux-section-title">
      <span>ĐIỀU KHIỂN</span>
      <h3>Keybind Minecraft</h3>
      <p>Đọc và ghi trực tiếp options.txt. Keybind của mod mới tự xuất hiện sau khi Minecraft đã đăng ký nó.</p>
    </div>

    <div className="keybind-toolbar">
      <input placeholder="Tìm keybind..." value={search} onChange={(event)=>setSearch(event.target.value)} />
      <button disabled={loading} onClick={()=>void load()}>{loading ? 'ĐANG ĐỌC...' : 'LÀM MỚI'}</button>
    </div>

    {!loading && entries.length === 0 && <div className="ux-error">Chưa có keybind để hiển thị. Hãy chạy Minecraft ít nhất một lần để tạo options.txt.</div>}

    <div className="keybind-list">
      {visible.map((entry) => {
        const conflictIds = conflicts.get(entry.id) ?? [];
        return <div className={'keybind-row ' + (entry.locked ? 'locked ' : '') + (conflictIds.length ? 'conflict' : '')} key={entry.id}>
          <div className="keybind-meta">
            <span>{entry.category}</span>
            <strong>{entry.label}</strong>
            <small>{entry.id}</small>
          </div>
          <div className="keybind-value">
            {conflictIds.length > 0 && <small className="keybind-warning">⚠ Xung đột với {conflictIds.map((id)=>entries.find((item)=>item.id===id)?.label ?? id).join(', ')}</small>}
            <button disabled={entry.locked} className={captureId===entry.id?'capturing':''} onClick={()=>setCaptureId(entry.id)}>
              {captureId===entry.id ? 'NHẤN PHÍM...' : keyName(draft[entry.id] ?? entry.key)}
            </button>
            {!entry.locked && <button className="keybind-clear" onClick={()=>setDraft((current)=>({...current,[entry.id]:'key.keyboard.unknown'}))}>BỎ GÁN</button>}
            {entry.locked && <small className="keybind-locked">SERVER LOCKED</small>}
          </div>
        </div>;
      })}
    </div>

    {error && <div className="ux-error">{error}</div>}

    <div className="keybind-actions">
      <button onClick={()=>{setDraft(Object.fromEntries(entries.map((entry)=>[entry.id,entry.key])));setCaptureId(null);}}>HOÀN TÁC</button>
      <button className="ux-button-primary" disabled={!dirty || saving} onClick={()=>void save()}>{saving ? 'ĐANG LƯU...' : 'LƯU KEYBIND'}</button>
    </div>
  </section>;
}

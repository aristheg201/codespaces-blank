import { useEffect, useState, type FormEvent } from 'react';
import type { ModpackLoader, ModpackSelection } from '../../../shared/ipc';

type Props = {
  busy: boolean;
  onCancel: () => void;
  onCreate: (name: string, selection: ModpackSelection) => Promise<void>;
};

const LOADERS: Array<{ id: ModpackLoader; label: string }> = [
  { id: 'neoforge', label: 'NeoForge' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'forge', label: 'Forge' },
  { id: 'quilt', label: 'Quilt' },
  { id: 'vanilla', label: 'Vanilla (không mod loader)' },
];
function describe(err: unknown): string { return err instanceof Error ? err.message : String(err); }

export function CreateModpackDialog({ busy, onCancel, onCreate }: Props) {
  const [name, setName] = useState('');
  const [mcVersions, setMcVersions] = useState<string[]>([]);
  const [mcVersion, setMcVersion] = useState('1.21.1');
  const [loader, setLoader] = useState<ModpackLoader>('neoforge');
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderVersion, setLoaderVersion] = useState('');
  const [minecraftLoading, setMinecraftLoading] = useState(true);
  const [loaderLoading, setLoaderLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void window.bestiary.getModpackMinecraftVersions().then((items) => {
      if (!live) return;
      if (!items.length) throw new Error('Mojang không trả về danh sách Minecraft release.');
      setMcVersions(items);
      setMcVersion((value) => items.includes(value) ? value : items[0]);
    }).catch((cause) => {
      if (live) setError('Không tải được danh sách Minecraft version: ' + describe(cause));
    }).finally(() => { if (live) setMinecraftLoading(false); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    setLoaderVersions([]);
    setLoaderVersion('');
    if (loader === 'vanilla') {
      setLoaderLoading(false);
      return () => { live = false; };
    }
    setLoaderLoading(true);
    setError('');
    void window.bestiary.getModpackLoaderVersions(mcVersion, loader).then((versions) => {
      if (!live) return;
      setLoaderVersions(versions);
      setLoaderVersion(versions[0] ?? '');
      if (!versions.length) setError('Không có ' + loader + ' tương thích Minecraft ' + mcVersion + '. Hãy chọn Minecraft version khác.');
    }).catch((cause) => {
      if (live) setError('Không tải được loader versions: ' + describe(cause));
    }).finally(() => { if (live) setLoaderLoading(false); });
    return () => { live = false; };
  }, [mcVersion, loader]);

  const ready = !busy && !minecraftLoading && !loaderLoading && !!mcVersions.length &&
    name.trim().length >= 2 && name.trim().length <= 64 &&
    (loader === 'vanilla' || (loaderVersion !== '' && loaderVersions.includes(loaderVersion)));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setError('');
    void onCreate(name.trim(), { minecraftVersion: mcVersion, loader,
      loaderVersion: loader === 'vanilla' ? null : loaderVersion }).catch((cause) => setError(describe(cause)));
  }

  return <div className="modpacks-dialog-backdrop">
    <div className="modpacks-dialog modpacks-create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-modpack-title"
      onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onCancel(); }}>
      <form onSubmit={submit}>
        <h2 id="create-modpack-title">Tạo Modpack</h2>
        <p>Mỗi modpack có Minecraft, loader, mods, config và worlds độc lập. Không đụng tới SVFrame Official.</p>
        <label className="modpacks-field" htmlFor="create-pack-name">
          <span>TÊN MODPACK</span>
          <input id="create-pack-name" autoFocus value={name} minLength={2} maxLength={64}
            required disabled={busy} placeholder="Ví dụ: NeoForge RPG"
            onChange={(event) => setName(event.target.value)}/>
        </label>
        <label className="modpacks-field" htmlFor="create-minecraft-version">
          <span>MINECRAFT VERSION</span>
          <select id="create-minecraft-version" value={mcVersion} disabled={busy || minecraftLoading || !mcVersions.length}
            onChange={(event) => setMcVersion(event.target.value)}>
            {!mcVersions.length && <option value={mcVersion}>{minecraftLoading ? 'Đang tải Mojang versions...' : 'Không có dữ liệu'}</option>}
            {mcVersions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="modpacks-field" htmlFor="create-loader">
          <span>MOD LOADER</span>
          <select id="create-loader" value={loader} disabled={busy} onChange={(event) => setLoader(event.target.value as ModpackLoader)}>
            {LOADERS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </select>
        </label>
        <label className="modpacks-field" htmlFor="create-loader-version">
          <span>LOADER VERSION</span>
          <select id="create-loader-version" disabled={busy || loaderLoading || loader === 'vanilla' || !loaderVersions.length}
            value={loader === 'vanilla' ? '' : loaderVersion}
            onChange={(event) => setLoaderVersion(event.target.value)}>
            {loader === 'vanilla' ? <option value="">Không cần (Vanilla)</option>
              : loaderLoading ? <option value="">Đang tải loader versions...</option>
                : !loaderVersions.length ? <option value="">Không có bản tương thích</option>
                  : loaderVersions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        {error && <p className="modpacks-create-error" role="alert">{error}</p>}
        <small className="modpacks-create-note">Loader được lấy từ nguồn chính thức: Mojang, Fabric, Quilt, MinecraftForge và NeoForged. Bản beta sẽ được xếp sau bản ổn định.</small>
        <div className="modpacks-dialog-actions">
          <button type="button" disabled={busy} onClick={onCancel}>HỦY</button>
          <button type="submit" className="primary" disabled={!ready}>{busy ? 'ĐANG TẠO...' : 'TẠO MODPACK'}</button>
        </div>
      </form>
    </div>
  </div>;
}

import { useEffect, useState, type FormEvent } from 'react';
import type { ModpackRuntimeSettings } from '../../../shared/ipc';

interface Props {
  packId: string;
  onClose: () => void;
}
const DEFAULTS: ModpackRuntimeSettings = {
  schema: 1, javaMajor: null, minRamMb: null, maxRamMb: null,
};

function fmt(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
function parseRam(value: string): number | null {
  return value.trim() === '' ? null : Number(value);
}

/**
 * Personal-only per-instance settings. Opening this dialog does not access
 * SVFrame Official settings or Manager's keybind policy.
 */
export function PersonalRuntimeSettingsDialog({ packId, onClose }: Props) {
  const [settings, setSettings] = useState<ModpackRuntimeSettings>(DEFAULTS);
  const [minRam, setMinRam] = useState('');
  const [maxRam, setMaxRam] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    void window.bestiary.getModpackRuntimeSettings(packId).then((data) => {
      if (!active) return;
      setSettings(data);
      setMinRam(data.minRamMb === null ? '' : String(data.minRamMb));
      setMaxRam(data.maxRamMb === null ? '' : String(data.maxRamMb));
      setLoaded(true);
      setError('');
    }).catch((cause) => {
      if (active) setError(fmt(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [packId]);

  const minValue = parseRam(minRam);
  const maxValue = parseRam(maxRam);
  const validNumber = (value: number | null): boolean =>
    value === null || (Number.isInteger(value) && value >= 512 && value <= 32768);
  const valid = validNumber(minValue) && validNumber(maxValue) &&
    (minValue === null || maxValue === null || minValue <= maxValue);
  const changed: ModpackRuntimeSettings = {
    ...settings, minRamMb: minValue, maxRamMb: maxValue,
  };

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || loading || !loaded || !valid) return;
    setSaving(true);
    setError('');
    try {
      await window.bestiary.saveModpackRuntimeSettings(packId, changed);
      onClose();
    } catch (cause) {
      setError(fmt(cause));
    } finally {
      setSaving(false);
    }
  }

  return <div className="modpacks-dialog-backdrop">
    <div className="modpacks-dialog" role="dialog" aria-modal="true" aria-labelledby="personal-runtime-title"
      onKeyDown={(event) => { if (event.key === 'Escape' && !saving) onClose(); }}>
      <form onSubmit={(event) => { void save(event); }}>
        <h2 id="personal-runtime-title">Minecraft Runtime — Java & RAM</h2>
        <p>Chỉ áp dụng cho modpack cá nhân đang chọn. Không ảnh hưởng SVFrame Official, keybind, mods hoặc world.</p>
        <label className="modpacks-field" htmlFor="runtime-java">
          <span>JAVA VERSION</span>
          <select id="runtime-java" disabled={loading || saving || !loaded}
            value={settings.javaMajor === null ? 'auto' : String(settings.javaMajor)}
            onChange={(event) => {
              const value = event.target.value;
              setSettings((old) => ({
                ...old, javaMajor: value === 'auto'
                  ? null : Number(value) as 8 | 17 | 21 | 25,
              }));
            }}>
            <option value="auto">AUTO — từ Mojang metadata (khuyên dùng)</option>
            <option value="8">Java 8</option>
            <option value="17">Java 17</option>
            <option value="21">Java 21</option>
            <option value="25">Java 25</option>
          </select>
        </label>
        <label className="modpacks-field" htmlFor="runtime-xms">
          <span>RAM MIN (MB)</span>
          <input id="runtime-xms" inputMode="numeric" type="number" min={512} max={32768}
            disabled={loading || saving || !loaded} placeholder="AUTO"
            value={minRam} onChange={(event) => setMinRam(event.target.value)}/>
        </label>
        <label className="modpacks-field" htmlFor="runtime-xmx">
          <span>RAM MAX (MB)</span>
          <input id="runtime-xmx" inputMode="numeric" type="number" min={512} max={32768}
            disabled={loading || saving || !loaded} placeholder="AUTO"
            value={maxRam} onChange={(event) => setMaxRam(event.target.value)}/>
        </label>
        <small>Java được kiểm tra tương thích theo Minecraft version. RAM vẫn bị giới hạn an toàn theo RAM vật lý, tránh làm Windows và iGPU thiếu bộ nhớ.</small>
        {!valid && <p role="alert">RAM phải là số nguyên 512–32768 MB và MIN không lớn hơn MAX.</p>}
        {error && <p className="modpacks-create-error" role="alert">{error}</p>}
        <div className="modpacks-dialog-actions">
          <button type="button" disabled={saving} onClick={onClose}>HỦY</button>
          <button className="primary" type="submit" disabled={loading || saving || !loaded || !valid}>
            {saving ? 'ĐANG LƯU...' : 'LƯU JAVA & RAM'}
          </button>
        </div>
      </form>
    </div>
  </div>;
}

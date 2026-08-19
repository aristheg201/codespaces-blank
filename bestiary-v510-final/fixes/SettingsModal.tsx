import { useState } from 'react';
import type { LauncherSettings, LauncherSnapshot, PerformancePreset } from '../../../shared/ipc';

interface Props {
  open: boolean;
  settings: LauncherSettings;
  snapshot: LauncherSnapshot;
  onChange: (patch: Partial<LauncherSettings>) => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onOpenFolder: () => void | Promise<void>;
}

const PRESETS: Array<{ id: PerformancePreset; label: string }> = [
  { id: 'quality', label: 'Lite' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'performance', label: 'Performance' },
  { id: 'custom', label: 'Custom' },
];

export function SettingsModal({ open, settings, snapshot, onChange, onClose, onSave, onOpenFolder }: Props) {
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  if (!open) return null;

  const generate = async () => {
    setGenerating(true);
    setGenerationError('');
    try {
      const next = await window.bestiary.generateJvmFlags(settings);
      onChange({ generatedJvmArgs: next.settings.generatedJvmArgs });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : String(error));
    } finally {
      setGenerating(false);
    }
  };

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="settings-modal">
      <header className="settings-header">
        <div><div className="eyebrow">CÀI ĐẶT</div><h2>Launcher</h2></div>
        <button className="icon-button" onClick={onClose}>×</button>
      </header>

      <div className="settings-body">
        <label>Tên người chơi<input value={settings.username} maxLength={16} onChange={(e) => onChange({ username: e.target.value })} /></label>
        <div className="settings-grid">
          <label>RAM tối thiểu (MB)<input type="number" value={settings.minRamMb} onChange={(e) => onChange({ minRamMb: Number(e.target.value) })} /></label>
          <label>RAM tối đa (MB)<input type="number" value={settings.maxRamMb} onChange={(e) => onChange({ maxRamMb: Number(e.target.value) })} /></label>
        </div>
        <div className="settings-grid">
          <label>Chiều rộng<input type="number" value={settings.width} onChange={(e) => onChange({ width: Number(e.target.value) })} /></label>
          <label>Chiều cao<input type="number" value={settings.height} onChange={(e) => onChange({ height: Number(e.target.value) })} /></label>
        </div>
        <label className="check-row"><input type="checkbox" checked={settings.fullscreen} onChange={(e) => onChange({ fullscreen: e.target.checked })} /> Toàn màn hình</label>

        <div className="settings-section">
          <div className="eyebrow">CLIENT</div>
          <div className="preset-row">
            <button className={settings.clientProfile === 'full' ? 'active' : ''} onClick={() => onChange({ clientProfile: 'full' })}>FULL</button>
            <button className={settings.clientProfile === 'lite' ? 'active' : ''} onClick={() => onChange({ clientProfile: 'lite' })}>LITE</button>
          </div>
        </div>

        <div className="settings-section">
          <div className="eyebrow">HIỆU NĂNG</div>
          <div className="preset-row">{PRESETS.map((preset) => <button key={preset.id} className={settings.performancePreset === preset.id ? 'active' : ''} onClick={() => onChange({ performancePreset: preset.id })}>{preset.label}</button>)}</div>
          {settings.performancePreset === 'custom' && <label>Additional JVM flags<textarea value={settings.customJvmArgs} onChange={(e) => onChange({ customJvmArgs: e.target.value })} /></label>}
          <div className="hardware-line">Máy: {(snapshot.systemRamMb / 1024).toFixed(1)} GB RAM · {snapshot.cpuThreads} luồng CPU</div>
          <button className="secondary-button" disabled={generating} onClick={() => void generate()}>{generating ? 'ĐANG GENERATE...' : 'GENERATE JVM FLAGS'}</button>
          <div className="jvm-preview">{settings.generatedJvmArgs.length ? settings.generatedJvmArgs.join('\n') : 'Chưa có JVM flags đã generate. Launcher sẽ không tự generate khi mở hoặc khi chạy game.'}</div>
          {generationError && <div className="library-error">{generationError}</div>}
        </div>
      </div>

      <footer className="settings-footer">
        <button className="secondary-button" onClick={() => void onOpenFolder()}>MỞ THƯ MỤC GAME</button>
        <button className="save-button" onClick={() => void onSave()}>LƯU</button>
      </footer>
    </section>
  </div>;
}

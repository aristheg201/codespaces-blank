import { useMemo, useState } from 'react';
import type { LauncherSettings, LauncherSnapshot, PerformancePreset } from '../../../shared/ipc';
import './UxPanels.css';

interface Props {
  open: boolean;
  settings: LauncherSettings;
  snapshot: LauncherSnapshot;
  onChange: (patch: Partial<LauncherSettings>) => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  onOpenFolder: () => void | Promise<void>;
}

const PRESETS: Array<{ id: PerformancePreset; label: string; detail: string; badge?: string }> = [
  { id: 'quality', label: 'Lite', detail: 'Giảm tải JVM, ưu tiên máy yếu.' },
  { id: 'balanced', label: 'Balanced', detail: 'Khuyên dùng cho đa số máy.', badge: 'KHUYÊN DÙNG' },
  { id: 'performance', label: 'Performance', detail: 'Ưu tiên FPS và phản hồi.' },
  { id: 'custom', label: 'Custom', detail: 'Tự quản lý JVM flags.' },
];

export function SettingsModal({ open, settings, snapshot, onChange, onClose, onSave, onOpenFolder }: Props) {
  const [tab, setTab] = useState<'client'|'performance'|'display'|'advanced'>('client');
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const maxSafeRamMb = useMemo(() => Math.max(4096, Math.floor(snapshot.systemRamMb * 0.7 / 512) * 512), [snapshot.systemRamMb]);
  if (!open) return null;

  const generate = async () => {
    setGenerating(true);
    setGenerationError('');
    try {
      const next = await window.bestiary.generateJvmFlags(settings);
      onChange({ generatedJvmArgs: next.settings.generatedJvmArgs });
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : String(error));
    } finally { setGenerating(false); }
  };

  return <div className="modal-backdrop ux-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="ux-dialog ux-settings-dialog" role="dialog" aria-modal="true" aria-label="Cài đặt launcher">
      <header className="ux-dialog-header compact">
        <div><div className="ux-kicker">BESTIARY SETTINGS</div><h2>Cài đặt Launcher</h2><p>Những mục thường dùng ở trước. Phần kỹ thuật nằm riêng để khỏi biến Settings thành bảng điều khiển tàu vũ trụ.</p></div>
        <button className="ux-close" onClick={onClose}>×</button>
      </header>

      <div className="ux-settings-layout">
        <nav className="ux-settings-nav">
          <button className={tab==='client'?'active':''} onClick={()=>setTab('client')}><b>01</b><span><strong>Client</strong><small>Full / Lite, username</small></span></button>
          <button className={tab==='performance'?'active':''} onClick={()=>setTab('performance')}><b>02</b><span><strong>Hiệu năng</strong><small>RAM và preset</small></span></button>
          <button className={tab==='display'?'active':''} onClick={()=>setTab('display')}><b>03</b><span><strong>Hiển thị</strong><small>Độ phân giải</small></span></button>
          <button className={tab==='advanced'?'active':''} onClick={()=>setTab('advanced')}><b>04</b><span><strong>Nâng cao</strong><small>JVM và thư mục game</small></span></button>
        </nav>

        <div className="ux-settings-content">
          {tab === 'client' && <section className="ux-settings-section">
            <div className="ux-section-title"><span>CLIENT</span><h3>Thông tin chơi game</h3><p>Đây là các lựa chọn tác động trực tiếp đến bộ client được cài.</p></div>
            <label className="ux-field"><span>TÊN NGƯỜI CHƠI</span><input value={settings.username} maxLength={16} onChange={(e)=>onChange({username:e.target.value.replace(/[^A-Za-z0-9_]/gu,'')})}/><small>3–16 ký tự, chỉ chữ, số và dấu gạch dưới.</small></label>
            <div className="ux-choice-grid two">
              <button className={settings.clientProfile==='full'?'selected':''} onClick={()=>onChange({clientProfile:'full'})}><span>FULL</span><strong>Đầy đủ trải nghiệm</strong><small>Toàn bộ mod/tài nguyên của Bestiary.</small><i>{settings.clientProfile==='full'?'ĐANG CHỌN':'CHỌN FULL'}</i></button>
              <button className={settings.clientProfile==='lite'?'selected':''} onClick={()=>onChange({clientProfile:'lite'})}><span>LITE</span><strong>Nhẹ và ưu tiên FPS</strong><small>Dành cho máy yếu hoặc cần tải nhanh.</small><i>{settings.clientProfile==='lite'?'ĐANG CHỌN':'CHỌN LITE'}</i></button>
            </div>
          </section>}

          {tab === 'performance' && <section className="ux-settings-section">
            <div className="ux-section-title"><span>HIỆU NĂNG</span><h3>RAM và preset</h3><p>Launcher không tự generate JVM flags. Chỉ nút ở phần Nâng cao mới làm việc đó.</p></div>
            <div className="ux-ram-card"><div><span>RAM TỐI ĐA</span><strong>{(settings.maxRamMb/1024).toFixed(1)} GB</strong><small>Máy có {(snapshot.systemRamMb/1024).toFixed(1)} GB RAM • giới hạn an toàn khoảng {(maxSafeRamMb/1024).toFixed(1)} GB</small></div><input type="range" min={4096} max={Math.max(4096,maxSafeRamMb)} step={512} value={Math.min(settings.maxRamMb,maxSafeRamMb)} onChange={(e)=>onChange({maxRamMb:Number(e.target.value)})}/></div>
            <div className="ux-choice-grid presets">{PRESETS.map((preset)=><button key={preset.id} className={settings.performancePreset===preset.id?'selected':''} onClick={()=>onChange({performancePreset:preset.id})}>{preset.badge&&<em>{preset.badge}</em>}<strong>{preset.label}</strong><small>{preset.detail}</small><i>{settings.performancePreset===preset.id?'ĐANG DÙNG':'CHỌN'}</i></button>)}</div>
          </section>}

          {tab === 'display' && <section className="ux-settings-section">
            <div className="ux-section-title"><span>HIỂN THỊ</span><h3>Cửa sổ Minecraft</h3><p>Chọn kích thước nhanh hoặc nhập thủ công.</p></div>
            <div className="ux-resolution-presets">
              {[[1280,720],[1600,900],[1920,1080]].map(([w,h])=><button key={w} className={!settings.fullscreen&&settings.width===w&&settings.height===h?'selected':''} onClick={()=>onChange({width:w,height:h,fullscreen:false})}><strong>{w} × {h}</strong><small>{w===1920?'Full HD':w===1600?'Cân bằng':'Nhẹ'}</small></button>)}
              <button className={settings.fullscreen?'selected':''} onClick={()=>onChange({fullscreen:true})}><strong>TOÀN MÀN HÌNH</strong><small>Dùng độ phân giải màn hình</small></button>
            </div>
            <div className="ux-inline-fields"><label className="ux-field"><span>CHIỀU RỘNG</span><input type="number" value={settings.width} onChange={(e)=>onChange({width:Number(e.target.value),fullscreen:false})}/></label><label className="ux-field"><span>CHIỀU CAO</span><input type="number" value={settings.height} onChange={(e)=>onChange({height:Number(e.target.value),fullscreen:false})}/></label></div>
          </section>}

          {tab === 'advanced' && <section className="ux-settings-section">
            <div className="ux-section-title"><span>NÂNG CAO</span><h3>JVM và file game</h3><p>Chỉ cần vào đây khi muốn kiểm soát sâu. Java runtime của pack hiện được pin ở Java 21.</p></div>
            {settings.performancePreset==='custom' && <label className="ux-field"><span>JVM FLAGS THỦ CÔNG</span><textarea rows={4} value={settings.customJvmArgs} onChange={(e)=>onChange({customJvmArgs:e.target.value})}/></label>}
            <div className="ux-advanced-actions"><button disabled={generating} onClick={()=>void generate()}><strong>{generating?'ĐANG GENERATE...':'GENERATE JVM FLAGS'}</strong><small>Đọc cấu hình máy và lưu bộ flags mới. Không chạy tự động.</small></button><button onClick={()=>void onOpenFolder()}><strong>MỞ THƯ MỤC GAME</strong><small>Mở thư mục Bestiary client đang sử dụng.</small></button></div>
            <div className="ux-jvm-preview"><span>JVM FLAGS ĐÃ LƯU</span><pre>{settings.generatedJvmArgs.length?settings.generatedJvmArgs.join('\n'):'Chưa có flags đã generate.'}</pre></div>
            {generationError&&<div className="ux-error">{generationError}</div>}
          </section>}
        </div>
      </div>

      <footer className="ux-settings-footer"><span>Mọi thay đổi chỉ có hiệu lực sau khi bấm Lưu.</span><div><button className="ux-button-secondary" onClick={onClose}>HỦY</button><button className="ux-button-primary" onClick={()=>void onSave()}>LƯU CÀI ĐẶT</button></div></footer>
    </section>
  </div>;
}

import type { ClientProfileId, ClientProfileInfo } from '../../../shared/ipc';
import './UxPanels.css';

interface Props {
  open: boolean;
  profiles: ClientProfileInfo[];
  systemRamMb: number;
  onChoose: (profile: ClientProfileId) => void;
  onClose: () => void;
}

function formatRam(mb: number): string {
  return `${Math.max(1, Math.round(mb / 1024))} GB`;
}

function profileCopy(profile: ClientProfileInfo) {
  if (profile.id === 'lite') {
    return {
      eyebrow: 'NHẸ • ƯU TIÊN FPS',
      title: 'LITE',
      summary: profile.description || 'Ít mod hình ảnh hơn, tải nhanh hơn và nhẹ RAM hơn.',
      bullets: ['Máy yếu hoặc laptop', 'Ưu tiên FPS ổn định', 'Thời gian tải client ngắn hơn'],
      action: 'CHỌN LITE & TIẾP TỤC',
    };
  }
  return {
    eyebrow: 'ĐẦY ĐỦ • TRẢI NGHIỆM TỐI ĐA',
    title: 'FULL',
    summary: profile.description || 'Đầy đủ nội dung, hiệu ứng và tài nguyên của Bestiary.',
    bullets: ['Đầy đủ mod và tài nguyên', 'Hình ảnh / hiệu ứng tốt nhất', 'Dành cho máy có RAM dư dả'],
    action: 'CHỌN FULL & TIẾP TỤC',
  };
}

export function ProfileChooser({ open, profiles, systemRamMb, onChoose, onClose }: Props) {
  if (!open) return null;
  const recommendedId = profiles
    .filter((profile) => systemRamMb >= profile.recommendedRamMb * 2)
    .sort((a, b) => b.recommendedRamMb - a.recommendedRamMb)[0]?.id ?? 'lite';

  return <div className="modal-backdrop ux-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="ux-dialog ux-profile-dialog" role="dialog" aria-modal="true" aria-label="Chọn phiên bản client">
      <header className="ux-dialog-header">
        <div>
          <div className="ux-kicker">BƯỚC 1 / 1 • CHỌN CLIENT</div>
          <h2>Máy này nên cài bản nào?</h2>
          <p>Chọn một thẻ bên dưới. Launcher sẽ tự cài đúng bộ mod, không cần nhớ Full khác Lite ở đâu.</p>
        </div>
        <button className="ux-close" onClick={onClose} aria-label="Đóng">×</button>
      </header>

      <div className="ux-device-summary">
        <span>MÁY HIỆN TẠI</span>
        <strong>{(systemRamMb / 1024).toFixed(1)} GB RAM</strong>
        <small>Bản có nhãn “Khuyên dùng” là lựa chọn an toàn nhất cho máy này.</small>
      </div>

      <div className="ux-profile-grid">
        {profiles.map((profile) => {
          const copy = profileCopy(profile);
          const recommended = profile.id === recommendedId;
          return <button className={`ux-profile-card ux-profile-${profile.id}${recommended ? ' is-recommended' : ''}`} key={profile.id} onClick={() => onChoose(profile.id)}>
            <div className="ux-profile-topline">
              <span>{copy.eyebrow}</span>
              {recommended && <em>KHUYÊN DÙNG</em>}
            </div>
            <div className="ux-profile-title-row">
              <strong>{copy.title}</strong>
              <span>{formatRam(profile.recommendedRamMb)} RAM đề nghị</span>
            </div>
            <p>{copy.summary}</p>
            <ul>{copy.bullets.map((bullet) => <li key={bullet}><i>✓</i>{bullet}</li>)}</ul>
            {profile.fileCount !== undefined && <div className="ux-profile-meta"><span>{profile.fileCount.toLocaleString()} file được quản lý</span></div>}
            <div className="ux-profile-action">{copy.action}<b>→</b></div>
          </button>;
        })}
      </div>

      <footer className="ux-hint">Có thể đổi Full / Lite lại trong Cài đặt. File cá nhân của người chơi không bị xóa khi chuyển profile.</footer>
    </section>
  </div>;
}

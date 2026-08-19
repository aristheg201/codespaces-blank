import type { ClientProfileId, ClientProfileInfo } from '../../../shared/ipc';

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

export function ProfileChooser({ open, profiles, systemRamMb, onChoose, onClose }: Props) {
  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="profile-chooser">
      <header className="settings-header">
        <div><div className="eyebrow">CHỌN PHIÊN BẢN CLIENT</div><h2>Full hay Lite</h2></div>
        <button className="icon-button" onClick={onClose}>×</button>
      </header>
      <div className="profile-grid">
        {profiles.map((profile) => {
          const recommended = systemRamMb >= profile.recommendedRamMb * 2;
          return <button className="profile-card" key={profile.id} onClick={() => onChoose(profile.id)}>
            <strong>{profile.name.toUpperCase()}</strong>
            <span>{profile.description}</span>
            <small>RAM Minecraft đề nghị: {formatRam(profile.recommendedRamMb)}</small>
            {profile.fileCount !== undefined && <small>{profile.fileCount.toLocaleString()} file</small>}
            {recommended && <em>PHÙ HỢP VỚI MÁY NÀY</em>}
          </button>;
        })}
      </div>
    </section>
  </div>;
}

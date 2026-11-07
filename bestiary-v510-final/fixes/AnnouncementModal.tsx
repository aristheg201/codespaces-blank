import { DiscordText } from './DiscordText';
import './UxPanels.css';

interface Props { open: boolean; title: string; body: string; onClose: () => void; }

export function AnnouncementModal({ open, title, body, onClose }: Props) {
  if (!open) return null;
  return <div className="modal-backdrop ux-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="ux-dialog ux-announcement-dialog" role="dialog" aria-modal="true">
      <header className="ux-dialog-header compact"><div><div className="ux-kicker">SERVER ANNOUNCEMENT</div><h2>{title || 'Thông báo máy chủ'}</h2><p>Hiển thị theo format Discord để nội dung trên launcher không biến thành một cục text khác hẳn bài đăng gốc.</p></div><button className="ux-close" onClick={onClose}>×</button></header>
      <div className="ux-discord-message"><div className="ux-discord-avatar">B</div><div className="ux-discord-content"><div className="ux-discord-author"><strong>Bestiary Rebirth</strong><span>SERVER</span></div><DiscordText text={body}/></div></div>
      <footer className="ux-announcement-footer"><span>Hỗ trợ Markdown kiểu Discord: tiêu đề, bold, italic, underline, strike, quote, list, code, link.</span><button className="ux-button-primary" onClick={onClose}>ĐÃ ĐỌC</button></footer>
    </section>
  </div>;
}

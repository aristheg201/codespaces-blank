import { useEffect, useState } from 'react';
import type { AccountMode, AccountSnapshot, AuthStatusEvent, SkinVariant } from '../../../shared/ipc';
import './AccountScreen.css';

const EMPTY_AUTH: AuthStatusEvent = { stage: 'idle', message: '' };

export function AccountScreen({ onBack }: { onBack: () => void }) {
  const [state, setState] = useState<AccountSnapshot | null>(null);
  const [auth, setAuth] = useState<AuthStatusEvent>(EMPTY_AUTH);
  const [busy, setBusy] = useState(false);
  const [variant, setVariant] = useState<SkinVariant>('classic');
  const [skinPath, setSkinPath] = useState('');
  const [error, setError] = useState('');

  const refresh = async () => setState(await window.bestiary.getAccounts());
  useEffect(() => {
    void refresh();
    const off = window.bestiary.onAuthStatus((event) => setAuth(event));
    return off;
  }, []);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await work(); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const mode = async (value: AccountMode) => run(() => window.bestiary.setAccountMode(value));
  const chooseSkin = async () => { const selected = await window.bestiary.chooseSkinFile(); if (selected) setSkinPath(selected); };
  const applySkin = async () => {
    if (!skinPath) { setError('Chọn file PNG trước.'); return; }
    await run(() => window.bestiary.setSkin({ path: skinPath, variant }));
  };

  if (!state) return <main className="account-screen"><div className="account-loading">ĐANG ĐỌC TÀI KHOẢN...</div></main>;
  const ms = state.microsoft;
  const activeName = state.mode === 'microsoft' && ms ? ms.username : state.offline.username;

  return <main className="account-screen">
    <header className="account-header">
      <button className="account-back" onClick={onBack}>← TRỞ LẠI</button>
      <div><span>BESTIARY IDENTITY</span><h1>TÀI KHOẢN & SKIN</h1><p>Chọn cách đăng nhập trước khi chơi. Token Microsoft không được đưa xuống renderer.</p></div>
      <div className={`account-active ${state.mode}`}><small>ĐANG DÙNG</small><strong>{activeName || 'CHƯA CHỌN'}</strong><em>{state.mode === 'microsoft' ? 'MICROSOFT · ONLINE' : 'OFFLINE / CRACK'}</em></div>
    </header>

    <section className="account-grid">
      <article className={`login-card ${state.mode === 'offline' ? 'selected' : ''}`}>
        <div className="login-icon">◌</div><div className="login-tag">OFFLINE / CRACK</div>
        <h2>{state.offline.username || 'Username local'}</h2>
        <p>Dùng UUID offline ổn định. Phù hợp tài khoản crack và hệ EasyAuth hiện tại của server.</p>
        <button disabled={busy || state.mode === 'offline'} onClick={() => void mode('offline')}>{state.mode === 'offline' ? 'ĐANG SỬ DỤNG' : 'DÙNG TÀI KHOẢN OFFLINE'}</button>
      </article>

      <article className={`login-card microsoft ${state.mode === 'microsoft' ? 'selected' : ''}`}>
        <div className="login-icon">M</div><div className="login-tag">MICROSOFT</div>
        {ms ? <><h2>{ms.username}</h2><p>{ms.email || 'Minecraft Java chính chủ'}<br/><code>{ms.uuid}</code></p></> : <><h2>Minecraft chính chủ</h2><p>Đăng nhập Microsoft bằng mã thiết bị. Launcher không nhận mật khẩu Microsoft.</p></>}
        {!state.microsoftConfigured && <div className="account-warning">Admin chưa cấu hình Microsoft Client ID trong distribution.</div>}
        <div className="login-actions">
          {!ms && <button disabled={busy || !state.microsoftConfigured} onClick={() => void run(() => window.bestiary.loginMicrosoft())}>ĐĂNG NHẬP MICROSOFT</button>}
          {ms && state.mode !== 'microsoft' && <button disabled={busy} onClick={() => void mode('microsoft')}>DÙNG {ms.username.toUpperCase()}</button>}
          {ms && <button className="secondary" disabled={busy} onClick={() => void run(() => window.bestiary.logoutMicrosoft())}>ĐĂNG XUẤT</button>}
        </div>
      </article>
    </section>

    {auth.stage !== 'idle' && auth.stage !== 'success' && <section className="auth-progress">
      <div><span>MICROSOFT LOGIN</span><strong>{auth.message}</strong></div>
      {auth.userCode && <button onClick={() => navigator.clipboard.writeText(auth.userCode!)}><small>MÃ ĐÃ COPY</small><b>{auth.userCode}</b></button>}
    </section>}

    <section className="skin-panel">
      <div className="skin-title"><span>PLAYER SKIN</span><h2>Quản lý skin</h2><p>{state.mode === 'microsoft' ? 'Skin sẽ được cập nhật trên tài khoản Minecraft chính chủ và đồng bộ vào Bestiary.' : 'Skin crack được lưu local và Bestiary Skin Bridge áp dụng khi bạn vào server.'}</p></div>
      <div className="skin-current">
        {state.mode === 'microsoft' && ms?.skinUrl ? <img src={ms.skinUrl} alt="Current skin" /> : <div className="skin-placeholder">64×64<br/>PNG</div>}
        <div><small>MODEL</small><div className="skin-variant"><button className={variant === 'classic' ? 'active' : ''} onClick={() => setVariant('classic')}>CLASSIC</button><button className={variant === 'slim' ? 'active' : ''} onClick={() => setVariant('slim')}>SLIM</button></div></div>
      </div>
      <div className="skin-file"><button onClick={() => void chooseSkin()}>CHỌN SKIN PNG</button><span>{skinPath || 'Chưa chọn file · 64×64 hoặc 64×32 · tối đa 1 MB'}</span></div>
      <div className="skin-actions"><button disabled={busy || !skinPath} onClick={() => void applySkin()}>ÁP DỤNG SKIN</button><button className="danger" disabled={busy} onClick={() => void run(() => window.bestiary.resetSkin())}>RESET SKIN</button></div>
    </section>

    {error && <div className="account-error">{error}</div>}
  </main>;
}

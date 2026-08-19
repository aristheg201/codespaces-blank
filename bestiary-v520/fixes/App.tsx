import { useEffect, useState } from 'react';
import { Home } from './components/Home';
import { SettingsModal } from './components/SettingsModal';
import { ConsolePanel } from './components/ConsolePanel';
import { ProfileChooser } from './components/ProfileChooser';
import { AnnouncementModal } from './components/AnnouncementModal';
import { ContentScreen } from './components/ContentScreen';
import { useLauncherStore } from './store/launcherStore';
import type { AppUpdateState, ClientProfileId, LauncherSettings } from '../../shared/ipc';
import './components/LauncherUx.css';
import './components/AppUpdate.css';

type Screen = 'home' | 'content';
const INITIAL_UPDATE: AppUpdateState = { currentVersion: '5.2.0', latestVersion: null, status: 'idle', progress: 0, message: 'Chưa kiểm tra cập nhật.' };

export function App() {
  const store = useLauncherStore();
  const [screen, setScreen] = useState<Screen>('home');
  const [profileOpen, setProfileOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [update, setUpdate] = useState<AppUpdateState>(INITIAL_UPDATE);

  useEffect(() => {
    let mounted = true;
    void window.bestiary.getSnapshot().then((snapshot) => {
      if (!mounted) return;
      store.setSnapshot(snapshot);
      store.setLoading(false);
    }).catch((error) => {
      store.addLog({ level: 'error', message: String(error) });
      store.setLoading(false);
    });
    void window.bestiary.getAppUpdate().then((state) => mounted && setUpdate(state));
    const timer = window.setTimeout(() => { void window.bestiary.checkAppUpdate().then((state) => mounted && setUpdate(state)); }, 1600);
    const offUpdate = window.bestiary.onAppUpdate((state) => mounted && setUpdate(state));
    const offProgress = window.bestiary.onProgress(store.setProgress);
    const offLog = window.bestiary.onGameLog(store.addLog);
    return () => { mounted = false; window.clearTimeout(timer); offUpdate(); offProgress(); offLog(); };
  }, []);

  if (store.loading || !store.snapshot || !store.settings) {
    return <div className="loading-screen"><img src="./logo.png" alt="Bestiary" /><div className="loading-pulse"><i /><i /><i /></div></div>;
  }

  const saveSettings = async () => {
    if (!store.settings) return;
    const snapshot = await window.bestiary.saveSettings(store.settings);
    store.setSnapshot(snapshot);
    store.setSettingsOpen(false);
  };
  const runGame = async (settings: LauncherSettings) => {
    const result = await window.bestiary.startGame(settings);
    if (!result.ok && result.message) store.addLog({ level: 'error', message: result.message });
    store.setSnapshot(await window.bestiary.getSnapshot());
  };
  const play = async () => {
    if (!store.settings) return;
    if (!store.settings.clientProfile) { setProfileOpen(true); return; }
    await runGame(store.settings);
  };
  const chooseProfile = async (profile: ClientProfileId) => {
    const currentSnapshot = store.snapshot;
    if (!store.settings || !currentSnapshot) return;
    const descriptor = currentSnapshot.release.profiles.find((item) => item.id === profile);
    const next: LauncherSettings = { ...store.settings, clientProfile: profile, maxRamMb: descriptor ? Math.min(descriptor.recommendedRamMb, Math.floor(currentSnapshot.systemRamMb * 0.7)) : store.settings.maxRamMb };
    store.patchSettings(next);
    const saved = await window.bestiary.saveSettings(next);
    store.setSnapshot(saved);
    setProfileOpen(false);
    await runGame(saved.settings);
  };

  if (screen === 'content') return <><ContentScreen onBack={() => setScreen('home')} />{update.status === 'ready' && <UpdateBar state={update} />}</>;

  return <>
    <Home snapshot={store.snapshot} settings={store.settings} progress={store.progress} onUsername={(username) => store.patchSettings({ username })} onPlay={play} onDiscord={() => window.bestiary.openDiscord()} onSettings={() => store.setSettingsOpen(true)} onLibrary={() => setScreen('content')} onConsole={() => store.setConsoleOpen(true)} onAnnouncement={() => setAnnouncementOpen(true)} />
    <UpdateBar state={update} />
    <SettingsModal open={store.settingsOpen} settings={store.settings} snapshot={store.snapshot} onChange={store.patchSettings} onClose={() => store.setSettingsOpen(false)} onSave={saveSettings} onOpenFolder={() => window.bestiary.openGameFolder()} />
    <ProfileChooser open={profileOpen} profiles={store.snapshot.release.profiles} systemRamMb={store.snapshot.systemRamMb} onChoose={(profile) => void chooseProfile(profile)} onClose={() => setProfileOpen(false)} />
    <AnnouncementModal open={announcementOpen} title={store.snapshot.release.announcementTitle} body={store.snapshot.release.announcementBody} onClose={() => setAnnouncementOpen(false)} />
    <ConsolePanel open={store.consoleOpen} logs={store.logs} onClose={() => store.setConsoleOpen(false)} />
  </>;
}

function UpdateBar({ state }: { state: AppUpdateState }) {
  if (state.status === 'idle' || state.status === 'up_to_date') return null;
  const actionable = state.status === 'ready';
  return <aside className={`app-update-bar ${state.status}`}>
    <div><strong>{state.status === 'checking' ? 'ĐANG KIỂM TRA CẬP NHẬT' : state.status === 'downloading' ? `ĐANG TẢI ${state.latestVersion ?? ''}` : state.status === 'ready' ? `BESTIARY LAUNCHER ${state.latestVersion} SẴN SÀNG` : state.status === 'error' ? 'KHÔNG THỂ CẬP NHẬT' : 'CÓ BẢN MỚI'}</strong><span>{state.message}</span></div>
    {(state.status === 'downloading' || state.status === 'available') && <div className="app-update-progress"><i style={{ width: `${state.progress}%` }} /></div>}
    {actionable && <button onClick={() => void window.bestiary.installAppUpdate()}>CẬP NHẬT & KHỞI ĐỘNG LẠI</button>}
    {state.status === 'error' && <button onClick={() => void window.bestiary.checkAppUpdate()}>THỬ LẠI</button>}
  </aside>;
}

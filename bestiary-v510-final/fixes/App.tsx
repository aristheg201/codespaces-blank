import { useEffect, useState } from 'react';
import { Home } from './components/Home';
import { SettingsModal } from './components/SettingsModal';
import { ConsolePanel } from './components/ConsolePanel';
import { LibraryModal } from './components/LibraryModal';
import { ProfileChooser } from './components/ProfileChooser';
import { AnnouncementModal } from './components/AnnouncementModal';
import { useLauncherStore } from './store/launcherStore';
import type { ClientProfileId, LauncherSettings } from '../../shared/ipc';

export function App() {
  const store = useLauncherStore();
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [announcementOpen, setAnnouncementOpen] = useState(false);

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
    const offProgress = window.bestiary.onProgress(store.setProgress);
    const offLog = window.bestiary.onGameLog(store.addLog);
    return () => { mounted = false; offProgress(); offLog(); };
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
    const refreshed = await window.bestiary.getSnapshot();
    store.setSnapshot(refreshed);
  };

  const play = async () => {
    if (!store.settings) return;
    if (!store.settings.clientProfile) {
      setProfileOpen(true);
      return;
    }
    await runGame(store.settings);
  };

  const chooseProfile = async (profile: ClientProfileId) => {
    const currentSnapshot = store.snapshot;
    if (!store.settings || !currentSnapshot) return;
    const descriptor = currentSnapshot.release.profiles.find((item) => item.id === profile);
    const next: LauncherSettings = {
      ...store.settings,
      clientProfile: profile,
      maxRamMb: descriptor ? Math.min(descriptor.recommendedRamMb, Math.floor(currentSnapshot.systemRamMb * 0.7)) : store.settings.maxRamMb,
    };
    store.patchSettings(next);
    const saved = await window.bestiary.saveSettings(next);
    store.setSnapshot(saved);
    setProfileOpen(false);
    await runGame(saved.settings);
  };

  return <>
    <Home
      snapshot={store.snapshot}
      settings={store.settings}
      progress={store.progress}
      onUsername={(username) => store.patchSettings({ username })}
      onPlay={play}
      onDiscord={() => window.bestiary.openDiscord()}
      onSettings={() => store.setSettingsOpen(true)}
      onLibrary={() => setLibraryOpen(true)}
      onConsole={() => store.setConsoleOpen(true)}
      onAnnouncement={() => setAnnouncementOpen(true)}
    />
    <SettingsModal open={store.settingsOpen} settings={store.settings} snapshot={store.snapshot} onChange={store.patchSettings} onClose={() => store.setSettingsOpen(false)} onSave={saveSettings} onOpenFolder={() => window.bestiary.openGameFolder()} />
    <LibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    <ProfileChooser open={profileOpen} profiles={store.snapshot.release.profiles} systemRamMb={store.snapshot.systemRamMb} onChoose={(profile) => void chooseProfile(profile)} onClose={() => setProfileOpen(false)} />
    <AnnouncementModal open={announcementOpen} title={store.snapshot.release.announcementTitle} body={store.snapshot.release.announcementBody} onClose={() => setAnnouncementOpen(false)} />
    <ConsolePanel open={store.consoleOpen} logs={store.logs} onClose={() => store.setConsoleOpen(false)} />
  </>;
}

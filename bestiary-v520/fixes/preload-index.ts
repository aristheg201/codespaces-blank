import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppUpdateState, GameLogEvent, LauncherSettings, LibraryKind, RendererApi, UiProgressEvent } from '../shared/ipc';

const api: RendererApi = {
  getSnapshot: () => ipcRenderer.invoke('bestiary:get-snapshot'),
  saveSettings: (settings: LauncherSettings) => ipcRenderer.invoke('bestiary:save-settings', settings),
  generateJvmFlags: (settings: LauncherSettings) => ipcRenderer.invoke('bestiary:generate-jvm', settings),
  startGame: (settings: LauncherSettings) => ipcRenderer.invoke('bestiary:start-game', settings),
  cancelSync: () => ipcRenderer.invoke('bestiary:cancel-sync'),
  openDiscord: () => ipcRenderer.invoke('bestiary:open-discord'),
  openGameFolder: () => ipcRenderer.invoke('bestiary:open-game-folder'),
  getLibrary: () => ipcRenderer.invoke('bestiary:library-get'),
  chooseLibraryFiles: (kind: LibraryKind) => ipcRenderer.invoke('bestiary:library-choose', kind),
  chooseAnyContentFiles: () => ipcRenderer.invoke('bestiary:library-choose-auto'),
  importLibraryFiles: (paths: string[]) => ipcRenderer.invoke('bestiary:library-import-auto', paths),
  installLibraryFiles: (kind: LibraryKind, paths: string[]) => ipcRenderer.invoke('bestiary:library-install', kind, paths),
  toggleLibraryItem: (itemPath: string) => ipcRenderer.invoke('bestiary:library-toggle', itemPath),
  removeLibraryItem: (itemPath: string) => ipcRenderer.invoke('bestiary:library-remove', itemPath),
  openLibraryFolder: (kind: LibraryKind) => ipcRenderer.invoke('bestiary:library-open-folder', kind),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getAppUpdate: () => ipcRenderer.invoke('bestiary:app-update-get'),
  checkAppUpdate: () => ipcRenderer.invoke('bestiary:app-update-check'),
  installAppUpdate: () => ipcRenderer.invoke('bestiary:app-update-install'),
  onAppUpdate: (listener: (state: AppUpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: AppUpdateState) => listener(payload);
    ipcRenderer.on('bestiary:app-update', handler);
    return () => ipcRenderer.removeListener('bestiary:app-update', handler);
  },
  onProgress: (listener: (event: UiProgressEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: UiProgressEvent) => listener(payload);
    ipcRenderer.on('bestiary:progress', handler);
    return () => ipcRenderer.removeListener('bestiary:progress', handler);
  },
  onGameLog: (listener: (event: GameLogEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: GameLogEvent) => listener(payload);
    ipcRenderer.on('bestiary:game-log', handler);
    return () => ipcRenderer.removeListener('bestiary:game-log', handler);
  },
};

contextBridge.exposeInMainWorld('bestiary', api);

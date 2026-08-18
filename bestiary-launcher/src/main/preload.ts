import { contextBridge, ipcRenderer } from 'electron';

type Unsubscribe = () => void;

const eventChannels = new Set([
  'sync:progress', 'jre:progress', 'game:stdout', 'game:stderr', 'game:debug',
  'game:progress', 'launcher:state', 'launcher:error'
]);

const api = {
  bootstrap: () => ipcRenderer.invoke('app:bootstrap'),
  saveSettings: (settings: unknown) => ipcRenderer.invoke('settings:save', settings),
  start: () => ipcRenderer.invoke('launcher:start'),
  repair: () => ipcRenderer.invoke('launcher:repair'),
  openExternal: (url: string) => ipcRenderer.invoke('external:open', url),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  on: (channel: string, listener: (payload: unknown) => void): Unsubscribe => {
    if (!eventChannels.has(channel)) throw new Error(`IPC event is not allowed: ${channel}`);
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  }
};

contextBridge.exposeInMainWorld('bestiary', api);

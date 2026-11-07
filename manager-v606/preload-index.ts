import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DistributionSettings, ManagerApi, ProgressState, PublishRequest } from '../shared/types';

const api: ManagerApi = {
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspace: (root: string) => ipcRenderer.invoke('workspace:open', root),
  rescanWorkspace: () => ipcRenderer.invoke('workspace:rescan'),
  getSnapshot: () => ipcRenderer.invoke('workspace:snapshot'),
  chooseJarFiles: () => ipcRenderer.invoke('jars:choose'),
  choosePackageFiles: () => ipcRenderer.invoke('packages:choose'),
  stageJarFiles: (paths: string[]) => ipcRenderer.invoke('stage:jars', paths),
  importModPackages: (paths: string[]) => ipcRenderer.invoke('stage:packages', paths),
  unstage: (id: string) => ipcRenderer.invoke('stage:unstage', id),
  clearStaging: () => ipcRenderer.invoke('stage:clear'),
  applyStaging: () => ipcRenderer.invoke('stage:apply'),
  stageRemove: (relativePath: string) => ipcRenderer.invoke('stage:remove', relativePath),
  revealPath: (target: string) => ipcRenderer.invoke('path:reveal', target),
  openWorkspaceFolder: () => ipcRenderer.invoke('workspace:open-folder'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveDistributionSettings: (settings: DistributionSettings) => ipcRenderer.invoke('settings:distribution', settings),
  connectGithub: () => ipcRenderer.invoke('distribution:connect'),
  cancelGithubAuth: () => ipcRenderer.invoke('distribution:cancel-auth'),
  openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
  getDistributionStatus: () => ipcRenderer.invoke('distribution:status'),
  ensureDistributionRepository: (preferred?: string) => ipcRenderer.invoke('distribution:ensure-repo', preferred),
  publish: (request: PublishRequest) => ipcRenderer.invoke('release:publish', request),
  listReleases: () => ipcRenderer.invoke('release:list'),
  promoteStable: (version: string) => ipcRenderer.invoke('release:promote', version),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onProgress: (listener: (progress: ProgressState) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, progress: ProgressState) => listener(progress);
    ipcRenderer.on('manager:progress', wrapped);
    return () => ipcRenderer.removeListener('manager:progress', wrapped);
  },
};
contextBridge.exposeInMainWorld('bestiary', api);

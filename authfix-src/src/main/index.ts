import path from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { DistributionSettings, ProgressState, PublishRequest } from '../shared/types';
import { SettingsService } from './services/SettingsService';
import { WorkspaceService } from './services/WorkspaceService';
import { GithubDistributionService } from './services/GithubDistributionService';

let mainWindow: BrowserWindow | null = null;
let settingsService: SettingsService;
let workspaceService: WorkspaceService;
let distributionService: GithubDistributionService;

function sendProgress(progress: ProgressState): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('manager:progress', progress);
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#09090b',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(process.resourcesPath, 'resources', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  await mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function bindIpc(): void {
  ipcMain.handle('workspace:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'], title: 'Chọn thư mục Bestiary Client hiện tại' });
    if (result.canceled || !result.filePaths[0]) return null;
    await settingsService.setWorkspaceRoot(result.filePaths[0]);
    distributionService.setWorkspaceRoot(result.filePaths[0]);
    await workspaceService.open(result.filePaths[0]);
    return result.filePaths[0];
  });

  ipcMain.handle('workspace:open', async (_event, root: string) => {
    await settingsService.setWorkspaceRoot(root);
    distributionService.setWorkspaceRoot(root);
    return workspaceService.open(root);
  });
  ipcMain.handle('workspace:rescan', () => workspaceService.rescan());
  ipcMain.handle('workspace:snapshot', () => workspaceService.snapshot());
  ipcMain.handle('workspace:open-folder', async () => {
    const root = workspaceService.getRoot();
    if (root) await shell.openPath(root);
  });

  ipcMain.handle('jars:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Minecraft mods', extensions: ['jar'] }],
      title: 'Chọn một hoặc nhiều mod JAR',
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('stage:jars', (_event, paths: string[]) => workspaceService.stageJarFiles(paths));
  ipcMain.handle('stage:unstage', (_event, id: string) => workspaceService.unstage(id));
  ipcMain.handle('stage:clear', () => workspaceService.clearStaging());
  ipcMain.handle('stage:apply', () => workspaceService.applyStaging());
  ipcMain.handle('stage:remove', (_event, relativePath: string) => workspaceService.stageRemove(relativePath));

  ipcMain.handle('path:reveal', async (_event, target: string) => {
    const root = workspaceService.getRoot();
    if (!root) return;
    shell.showItemInFolder(path.resolve(root, ...target.split('/')));
  });

  ipcMain.handle('settings:get', () => settingsService.get());
  ipcMain.handle('settings:distribution', async (_event, settings: DistributionSettings) => {
    const next = await settingsService.setDistribution(settings);
    distributionService.setSettings(next.distribution);
    return next;
  });

  ipcMain.handle('distribution:status', () => distributionService.status());
  ipcMain.handle('distribution:connect', () => distributionService.connectGithub());
  ipcMain.handle('distribution:cancel-auth', () => distributionService.cancelGithubAuth());
  ipcMain.handle('system:open-external', async (_event, url: string) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') throw new Error('URL không hợp lệ.');
    await shell.openExternal(parsed.toString());
  });
  ipcMain.handle('distribution:ensure-repo', async (_event, preferred?: string) => {
    const status = await distributionService.ensureRepository(preferred);
    if (status.repository) {
      const current = settingsService.get().distribution;
      const next = await settingsService.setDistribution({ ...current, repository: status.repository });
      distributionService.setSettings(next.distribution);
    }
    return status;
  });

  ipcMain.handle('release:publish', async (_event, request: PublishRequest) => {
    const snapshot = workspaceService.snapshot();
    return distributionService.publish(snapshot.files, snapshot.staged.length, request);
  });
  ipcMain.handle('release:list', () => distributionService.listLocalReleases());
  ipcMain.handle('release:promote', (_event, version: string) => distributionService.promoteStable(version));
}

app.whenReady().then(async () => {
  settingsService = new SettingsService(app.getPath('userData'));
  const settings = await settingsService.load();
  workspaceService = new WorkspaceService(sendProgress);
  distributionService = new GithubDistributionService(app.getPath('userData'), settings.distribution, sendProgress);
  bindIpc();
  if (settings.workspaceRoot) {
    try {
      distributionService.setWorkspaceRoot(settings.workspaceRoot);
      await workspaceService.open(settings.workspaceRoot);
    } catch {
      await settingsService.setWorkspaceRoot(undefined);
    }
  }
  await createWindow();
}).catch((error) => {
  dialog.showErrorBox('Bestiary Pack Manager', error instanceof Error ? error.stack || error.message : String(error));
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

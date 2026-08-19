from pathlib import Path
p=Path('source/src/main/index.ts')
s=p.read_text(encoding='utf-8')
s=s.replace("import { ContentManager } from './core/ContentManager';", "import { ContentManager } from './core/ContentManager';\nimport { AppUpdater } from './core/AppUpdater';")
s=s.replace("let mainWindow: BrowserWindow | null = null;", "let mainWindow: BrowserWindow | null = null;\nlet appUpdater: AppUpdater | null = null;")
marker="  ipcMain.handle('bestiary:window-minimize', () => mainWindow?.minimize());"
insert="""  ipcMain.handle('bestiary:app-update-get', () => appUpdater?.snapshot() ?? { currentVersion: app.getVersion(), latestVersion: null, status: 'idle', progress: 0, message: 'Updater chưa sẵn sàng.' });\n  ipcMain.handle('bestiary:app-update-check', () => appUpdater?.checkAndDownload());\n  ipcMain.handle('bestiary:app-update-install', () => appUpdater?.installReady() ?? false);\n"""
if marker not in s: raise SystemExit('window IPC marker missing')
s=s.replace(marker,insert+marker)
old="""    await fs.ensureDir(dataRoot);\n    await fs.ensureDir(gameDirectory);\n    registerIpc();\n    createWindow();"""
new="""    await fs.ensureDir(dataRoot);\n    await fs.ensureDir(gameDirectory);\n    appUpdater = new AppUpdater('launcher', dataRoot, (state) => {\n      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bestiary:app-update', state);\n    });\n    registerIpc();\n    createWindow();"""
if old not in s: raise SystemExit('whenReady marker missing')
s=s.replace(old,new)
p.write_text(s,encoding='utf-8')

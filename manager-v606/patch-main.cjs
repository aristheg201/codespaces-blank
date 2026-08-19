const fs = require('node:fs');

const mainPath = 'manager/src/main/index.ts';
let s = fs.readFileSync(mainPath, 'utf8').replace(/\r\n/g, '\n');
const chooser = `  ipcMain.handle('jars:choose', async () => {\n    const result = await dialog.showOpenDialog(mainWindow!, {\n      properties: ['openFile', 'multiSelections'],\n      filters: [{ name: 'Minecraft mods', extensions: ['jar'] }],\n      title: 'Chọn một hoặc nhiều mod JAR',\n    });\n    return result.canceled ? [] : result.filePaths;\n  });`;
if (!s.includes(chooser)) throw new Error('jars:choose marker missing');
s = s.replace(chooser, chooser + `\n  ipcMain.handle('packages:choose', async () => {\n    const result = await dialog.showOpenDialog(mainWindow!, {\n      properties: ['openFile', 'multiSelections'],\n      filters: [{ name: 'Bestiary mod packages', extensions: ['zip'] }],\n      title: 'Chọn mods-full / mods-pc-lite / mods-android ZIP',\n    });\n    return result.canceled ? [] : result.filePaths;\n  });`);
const stage = "  ipcMain.handle('stage:jars', (_event, paths: string[]) => workspaceService.stageJarFiles(paths));";
if (!s.includes(stage)) throw new Error('stage:jars marker missing');
s = s.replace(stage, stage + "\n  ipcMain.handle('stage:packages', (_event, paths: string[]) => workspaceService.stagePackageArchives(paths));");
fs.writeFileSync(mainPath, s);

const appPath = 'manager/src/renderer/src/App.tsx';
let app = fs.readFileSync(appPath, 'utf8').replace(/\r\n/g, '\n');
if (!app.includes('export function App()')) throw new Error('App named export marker missing');
app = app.replace('export function App()', 'function App()');
app = `${app.trimEnd()}\n\nexport default App;\n`;
fs.writeFileSync(appPath, app);

console.log('Manager 6.0.6 package IPC and renderer export patched.');

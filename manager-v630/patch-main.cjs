const fs = require('node:fs');
const p = 'manager/src/main/index.ts';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const req = (ok, msg) => { if (!ok) throw new Error(msg); };

req(s.includes('let mainWindow: BrowserWindow | null = null;'), 'mainWindow declaration missing');
if (!s.includes('app.requestSingleInstanceLock()')) {
  s = s.replace(
    'let mainWindow: BrowserWindow | null = null;',
    `let mainWindow: BrowserWindow | null = null;\nconst gotSingleInstanceLock = app.requestSingleInstanceLock();\nif (!gotSingleInstanceLock) app.quit();`,
  );
}

if (!s.includes('function restoreManagerWindow(): void')) {
  const marker = 'function bindIpc(): void {';
  req(s.includes(marker), 'bindIpc marker missing');
  s = s.replace(marker, `function restoreManagerWindow(): void {\n  if (!app.isReady()) return;\n  if (!mainWindow || mainWindow.isDestroyed()) { void createWindow(); return; }\n  if (mainWindow.isMinimized()) mainWindow.restore();\n  if (!mainWindow.isVisible()) mainWindow.show();\n  mainWindow.focus();\n}\n\n${marker}`);
}

const removeMarker = "  ipcMain.handle('stage:remove', (_event, relativePath: string) => workspaceService.stageRemove(relativePath));";
req(s.includes(removeMarker), 'stage remove IPC marker missing');
if (!s.includes("ipcMain.handle('mod-policy:set'")) {
  s = s.replace(removeMarker, removeMarker + `\n  ipcMain.handle('mod-policy:set', (_event, relativePath: string, patch) => workspaceService.setModPolicy(relativePath, patch));\n  ipcMain.handle('mod-audit:redetect', (_event, relativePath?: string) => workspaceService.redetectMod(relativePath));`);
}

if (!s.includes("app.on('second-instance'")) {
  const marker = "app.on('window-all-closed', () => {";
  req(s.includes(marker), 'window-all-closed marker missing');
  s = s.replace(marker, `app.on('second-instance', () => {\n  restoreManagerWindow();\n});\n\n${marker}`);
}

const activateOld = `app.on('activate', () => {\n  if (BrowserWindow.getAllWindows().length === 0) void createWindow();\n});`;
if (s.includes(activateOld)) {
  s = s.replace(activateOld, `app.on('activate', () => {\n  restoreManagerWindow();\n});`);
}

req(s.includes('app.requestSingleInstanceLock()'), 'single-instance lock missing');
req(s.includes("app.on('second-instance'"), 'second-instance handler missing');
req(s.includes('mainWindow.isDestroyed()') && s.includes('mainWindow.restore()') && s.includes('mainWindow.show()') && s.includes('mainWindow.focus()'), 'window restore contract missing');
req(s.includes("app.on('window-all-closed'"), 'window-all-closed handler missing');
req(s.includes("ipcMain.handle('mod-policy:set'"), 'mod policy IPC missing');
req(s.includes("ipcMain.handle('mod-audit:redetect'"), 'mod audit IPC missing');

fs.writeFileSync(p, s);
console.log('Manager 6.3 lifecycle and mod-audit IPC patched.');

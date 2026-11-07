from pathlib import Path
import re

root = Path('source')
main_path = root / 'src/main/index.ts'
app_path = root / 'src/renderer/src/App.tsx'
home_path = root / 'src/renderer/src/components/Home.tsx'


def req(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(message)


s = main_path.read_text(encoding='utf-8')
req('let mainWindow: BrowserWindow | null = null;' in s, 'mainWindow declaration missing')

if 'const gotSingleInstanceLock = app.requestSingleInstanceLock();' not in s:
    marker = 'let mainWindow: BrowserWindow | null = null;'
    replacement = marker + '''
let isQuitting = false;
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}
'''
    s = s.replace(marker, replacement, 1)
elif 'let isQuitting = false;' not in s:
    s = s.replace('let mainWindow: BrowserWindow | null = null;', 'let mainWindow: BrowserWindow | null = null;\nlet isQuitting = false;', 1)

if 'function restoreBestiaryWindow(): void {' not in s:
    marker = 'function registerIpc(): void {'
    req(marker in s, 'registerIpc marker missing')
    helper = '''function restoreBestiaryWindow(): void {
  if (!app.isReady()) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

'''
    s = s.replace(marker, helper + marker, 1)

s = re.sub(
    r"ipcMain\.handle\('bestiary:window-close',\s*\(\)\s*=>\s*mainWindow\?\.(?:hide|close)\(\)\);",
    "ipcMain.handle('bestiary:window-close', () => { isQuitting = true; app.quit(); });",
    s,
)
close_handler = re.compile(
    r"ipcMain\.handle\('bestiary:window-close',\s*\(\)\s*=>\s*\{(?P<body>.*?)\}\);",
    re.S,
)
match = close_handler.search(s)
if match and ('mainWindow?.hide()' in match.group('body') or 'mainWindow.hide()' in match.group('body')):
    s = s[:match.start()] + "ipcMain.handle('bestiary:window-close', () => { isQuitting = true; app.quit(); });" + s[match.end():]

window_close = re.compile(
    r"\s*mainWindow\.on\('close',\s*\((?P<event>[A-Za-z_$][A-Za-z0-9_$]*)\)\s*=>\s*\{(?P<body>.*?)\}\);",
    re.S,
)
for m in list(window_close.finditer(s)):
    body = m.group('body')
    if 'preventDefault()' in body and ('.hide()' in body or 'hide();' in body):
        s = s[:m.start()] + "\n  mainWindow.on('close', () => { isQuitting = true; });" + s[m.end():]
        break

lifecycle = '''
app.on('before-quit', () => {
  isQuitting = true;
});

app.on('second-instance', () => {
  restoreBestiaryWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  restoreBestiaryWindow();
});

'''
if "app.on('second-instance'" not in s or "app.on('window-all-closed'" not in s:
    ready = re.search(r"app\.whenReady\(\)\.then\(", s)
    req(ready is not None, 'app.whenReady marker missing')
    s = s[:ready.start()] + lifecycle + s[ready.start():]
elif "app.on('before-quit'" not in s:
    ready = re.search(r"app\.whenReady\(\)\.then\(", s)
    req(ready is not None, 'app.whenReady marker missing')
    s = s[:ready.start()] + "app.on('before-quit', () => { isQuitting = true; });\n\n" + s[ready.start():]

for m in window_close.finditer(s):
    body = m.group('body')
    req(not ('preventDefault()' in body and ('.hide()' in body or 'hide();' in body)), 'close-to-hide BrowserWindow handler still present')

req('app.requestSingleInstanceLock()' in s, 'single-instance lock missing')
req("app.on('second-instance'" in s, 'second-instance restore handler missing')
req("app.on('window-all-closed'" in s and "process.platform !== 'darwin'" in s, 'Windows window-all-closed quit handler missing')
req('mainWindow.isDestroyed()' in s, 'destroyed window recovery missing')
req('mainWindow.isMinimized()' in s and 'mainWindow.restore()' in s, 'minimized window recovery missing')
req('mainWindow.isVisible()' in s and 'mainWindow.show()' in s and 'mainWindow.focus()' in s, 'hidden window focus recovery missing')
main_path.write_text(s, encoding='utf-8')

for path in (app_path, home_path):
    text = path.read_text(encoding='utf-8')
    text = text.replace('5.3.5', '5.3.6')
    path.write_text(text, encoding='utf-8')

print('Bestiary Launcher 5.3.6 lifecycle hotfix applied.')

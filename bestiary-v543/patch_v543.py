from pathlib import Path
import re

root = Path('source')
main_path = root / 'src/main/index.ts'
app_path = root / 'src/renderer/src/App.tsx'
home_path = root / 'src/renderer/src/components/Home.tsx'
account_path = root / 'src/main/core/AccountService.ts'
remote_path = root / 'src/main/core/RemoteService.ts'


def req(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(message)


main = main_path.read_text(encoding='utf-8')

# 5.4.2 accidentally acquired Electron's single-instance lock twice. Keep one
# authoritative acquisition and exit immediately when another instance owns it.
first = """const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}
"""
req(first in main, 'Primary single-instance block missing')
main = main.replace(
    first,
    """const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.exit(0);
}
""",
    1,
)

duplicate = """const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0);
}
"""
req(duplicate in main, 'Duplicate single-instance block missing')
main = main.replace(duplicate, '', 1)

# The shipped source already had a correct restore helper, but second-instance
# bypassed it and returned when mainWindow was gone. That left a live Electron
# process with no visible UI. Route every restore path through the helper.
old_second = """  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
"""
req(old_second in main, '5.4.2 second-instance handler missing')
main = main.replace(
    old_second,
    """  app.on('second-instance', () => {
    restoreBestiaryWindow();
  });
""",
    1,
)

old_activate = """  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
"""
req(old_activate in main, '5.4.2 activate handler missing')
main = main.replace(
    old_activate,
    """  app.on('activate', () => {
    restoreBestiaryWindow();
  });
""",
    1,
)

# Windows/Linux launcher has no tray mode. Closing the final window must end the
# Electron main process, not leave an invisible single-instance owner behind.
old_all_closed = """  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
"""
req(old_all_closed in main, 'window-all-closed handler missing')
main = main.replace(
    old_all_closed,
    """  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      isQuitting = true;
      app.exit(0);
    }
  });
""",
    1,
)

# The custom close button should use the same deterministic Windows/Linux exit.
old_custom_close = "ipcMain.handle('bestiary:window-close', () => { isQuitting = true; app.quit(); });"
req(old_custom_close in main, 'Custom window-close IPC handler missing')
main = main.replace(
    old_custom_close,
    """ipcMain.handle('bestiary:window-close', () => {
    isQuitting = true;
    if (process.platform === 'darwin') app.quit();
    else app.exit(0);
  });""",
    1,
)

# Defensive close handling for the native title-bar X. The default close still
# destroys the BrowserWindow; window-all-closed performs the process exit.
closed_marker = """  mainWindow.on('closed', () => {
    mainWindow = null;
  });
"""
req(closed_marker in main, 'BrowserWindow closed handler missing')
main = main.replace(
    closed_marker,
    """  mainWindow.on('closed', () => {
    mainWindow = null;
  });
""",
    1,
)

# Version metadata.
main_path.write_text(main, encoding='utf-8')

for path in (account_path, remote_path):
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'BestiaryLauncher/5\.4\.2', 'BestiaryLauncher/5.4.3', text)
    path.write_text(text, encoding='utf-8')

app = app_path.read_text(encoding='utf-8')
app = re.sub(r"currentVersion:\s*'5\.4\.2'", "currentVersion: '5.4.3'", app, count=1)
req("currentVersion: '5.4.3'" in app, 'Unable to bump renderer version to 5.4.3')
app_path.write_text(app, encoding='utf-8')

home = home_path.read_text(encoding='utf-8')
home = home.replace('5.4.2', '5.4.3')
home_path.write_text(home, encoding='utf-8')

# Source-level lifecycle contracts.
check = main_path.read_text(encoding='utf-8')
req(check.count('app.requestSingleInstanceLock()') == 1,
    'Single-instance lock must be acquired exactly once')
req("app.on('second-instance', () => {\n    restoreBestiaryWindow();\n  });" in check,
    'Second instance does not restore/recreate the launcher window')
req("app.on('activate', () => {\n    restoreBestiaryWindow();\n  });" in check,
    'Activate does not restore/recreate the launcher window')
req("if (!mainWindow || mainWindow.isDestroyed()) {\n    createWindow();" in check,
    'Restore helper cannot recreate a destroyed launcher window')
req("if (!mainWindow.isVisible()) mainWindow.show();" in check,
    'Restore helper cannot show a hidden launcher window')
req("app.on('window-all-closed', () => {\n    if (process.platform !== 'darwin') {\n      isQuitting = true;\n      app.exit(0);" in check,
    'Windows/Linux last-window close is not a deterministic process exit')
req('gotSingleInstanceLock' not in check,
    'Duplicate 5.4.2 single-instance state survived patch')

print('Bestiary Launcher 5.4.3 lifecycle patch applied.')

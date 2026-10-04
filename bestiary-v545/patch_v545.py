from pathlib import Path
import re

root = Path('source')


def req(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(message)


# Shared IPC
ipc_path = root / 'src/shared/ipc.ts'
ipc = ipc_path.read_text(encoding='utf-8')
skin_marker = """export interface SkinSetRequest {
  path: string;
  variant: SkinVariant;
}
"""
req(skin_marker in ipc, 'SkinSetRequest marker missing')
if 'export interface KeybindEntry {' not in ipc:
    ipc = ipc.replace(skin_marker, skin_marker + """
export interface KeybindEntry {
  id: string;
  key: string;
  label: string;
  category: string;
  locked: boolean;
  conflictIds: string[];
}

export interface KeybindSnapshot {
  optionsExists: boolean;
  entries: KeybindEntry[];
}

export interface KeybindChange {
  id: string;
  key: string;
}

""", 1)
renderer_marker = "  resetSkin(): Promise<AccountSnapshot>;\n"
req(renderer_marker in ipc, 'RendererApi skin marker missing')
if 'getKeybinds(): Promise<KeybindSnapshot>;' not in ipc:
    ipc = ipc.replace(renderer_marker, renderer_marker + """  getKeybinds(): Promise<KeybindSnapshot>;
  saveKeybinds(changes: KeybindChange[]): Promise<KeybindSnapshot>;
""", 1)
ipc_path.write_text(ipc, encoding='utf-8')


# Preload
preload_path = root / 'src/preload/index.ts'
preload = preload_path.read_text(encoding='utf-8')
old_import = "import type { AccountMode, AppUpdateState, AuthStatusEvent, GameLogEvent, LauncherSettings, LibraryKind, RendererApi, SkinSetRequest, UiProgressEvent } from '../shared/ipc';"
req(old_import in preload or 'KeybindChange' in preload, 'preload IPC import marker missing')
if 'KeybindChange' not in preload.split('\n', 2)[1]:
    preload = preload.replace(
        old_import,
        "import type { AccountMode, AppUpdateState, AuthStatusEvent, GameLogEvent, KeybindChange, LauncherSettings, LibraryKind, RendererApi, SkinSetRequest, UiProgressEvent } from '../shared/ipc';",
        1,
    )
preload_marker = "  resetSkin: () => ipcRenderer.invoke('bestiary:skin-reset'),\n"
req(preload_marker in preload, 'preload skin-reset marker missing')
if "bestiary:keybind-get" not in preload:
    preload = preload.replace(preload_marker, preload_marker + """  getKeybinds: () => ipcRenderer.invoke('bestiary:keybind-get'),
  saveKeybinds: (changes: KeybindChange[]) => ipcRenderer.invoke('bestiary:keybind-save', changes),
""", 1)
preload_path.write_text(preload, encoding='utf-8')


# Main process
main_path = root / 'src/main/index.ts'
main = main_path.read_text(encoding='utf-8')
content_import = "import { ContentManager } from './core/ContentManager';"
req(content_import in main, 'ContentManager import marker missing')
if "import { KeybindSettingsService } from './core/KeybindSettingsService';" not in main:
    main = main.replace(content_import, content_import + "\nimport { KeybindSettingsService } from './core/KeybindSettingsService';", 1)

instance_marker = "const contentManager = new ContentManager(gameDirectory, ownershipFilePath);"
req(instance_marker in main, 'ContentManager instance marker missing')
if 'const keybindSettingsService = new KeybindSettingsService(gameDirectory);' not in main:
    main = main.replace(instance_marker, instance_marker + "\nconst keybindSettingsService = new KeybindSettingsService(gameDirectory);", 1)

main_window_marker = 'let mainWindow: BrowserWindow | null = null;'
req(main_window_marker in main, 'mainWindow declaration missing')
if 'let minecraftSessionActive = false;' not in main:
    main = main.replace(main_window_marker, main_window_marker + "\nlet minecraftSessionActive = false;", 1)

start_ipc = "  ipcMain.handle('bestiary:start-game', async (_event, settings: LauncherSettings) => startGame(settings));"
req(start_ipc in main, 'start-game IPC marker missing')
if "bestiary:keybind-get" not in main:
    main = main.replace(start_ipc, """  ipcMain.handle('bestiary:keybind-get', async () => keybindSettingsService.snapshot());
  ipcMain.handle('bestiary:keybind-save', async (_event, changes) => {
    if (minecraftSessionActive) {
      throw new Error('Không thể sửa keybind khi Minecraft đang chạy. Hãy thoát game trước.');
    }
    return keybindSettingsService.save(changes);
  });
""" + start_ipc, 1)

event_marker = "minecraftLauncher.onEvent((event) => {\n"
req(event_marker in main, 'Minecraft launcher event marker missing')
if "event.state === 'running'" not in main:
    main = main.replace(event_marker, event_marker + """  if (event.type === 'state' && event.state === 'running') {
    minecraftSessionActive = true;
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      mainWindow.hide();
    }
  }
""", 1)

stopped_marker = "  if (event.type === 'state' && event.state === 'stopped') {\n"
req(stopped_marker in main, 'Minecraft stopped lifecycle marker missing')
stopped_block = main[main.index(stopped_marker):main.index(stopped_marker) + 600]
if 'minecraftSessionActive = false;' not in stopped_block:
    main = main.replace(stopped_marker, stopped_marker + """    minecraftSessionActive = false;
    restoreBestiaryWindow();
""", 1)

main_path.write_text(main, encoding='utf-8')


# Settings UI
settings_path = root / 'src/renderer/src/components/SettingsModal.tsx'
settings = settings_path.read_text(encoding='utf-8')
ux_import = "import './UxPanels.css';"
req(ux_import in settings, 'UxPanels import missing')
if "import { KeybindPanel } from './KeybindPanel';" not in settings:
    settings = settings.replace(ux_import, "import { KeybindPanel } from './KeybindPanel';\n" + ux_import, 1)

old_tab = "  const [tab, setTab] = useState<'client'|'performance'|'display'|'advanced'>('client');"
req(old_tab in settings or "'controls'" in settings, 'Settings tab state marker missing')
if "'controls'" not in settings.split('useState', 2)[1]:
    settings = settings.replace(
        old_tab,
        "  const [tab, setTab] = useState<'client'|'performance'|'display'|'controls'|'advanced'>('client');",
        1,
    )

old_nav = """          <button className={tab==='display'?'active':''} onClick={()=>setTab('display')}><b>03</b><span><strong>Hiển thị</strong><small>Độ phân giải</small></span></button>
          <button className={tab==='advanced'?'active':''} onClick={()=>setTab('advanced')}><b>04</b><span><strong>Nâng cao</strong><small>JVM và thư mục game</small></span></button>"""
req(old_nav in settings or "setTab('controls')" in settings, 'Settings nav marker missing')
if "setTab('controls')" not in settings:
    settings = settings.replace(
        old_nav,
        """          <button className={tab==='display'?'active':''} onClick={()=>setTab('display')}><b>03</b><span><strong>Hiển thị</strong><small>Độ phân giải</small></span></button>
          <button className={tab==='controls'?'active':''} onClick={()=>setTab('controls')}><b>04</b><span><strong>Điều khiển</strong><small>Keybind Minecraft</small></span></button>
          <button className={tab==='advanced'?'active':''} onClick={()=>setTab('advanced')}><b>05</b><span><strong>Nâng cao</strong><small>JVM và thư mục game</small></span></button>""",
        1,
    )

advanced_marker = "          {tab === 'advanced' && <section className=\"ux-settings-section\">"
req(advanced_marker in settings, 'Advanced settings section marker missing')
if "{tab === 'controls' && <KeybindPanel />}" not in settings:
    settings = settings.replace(advanced_marker, "          {tab === 'controls' && <KeybindPanel />}\n\n" + advanced_marker, 1)
settings_path.write_text(settings, encoding='utf-8')


# Version metadata
app_path = root / 'src/renderer/src/App.tsx'
app = app_path.read_text(encoding='utf-8')
app = re.sub(r"currentVersion:\s*'5\.4\.4'", "currentVersion: '5.4.5'", app, count=1)
req("currentVersion: '5.4.5'" in app, 'Unable to bump renderer version to 5.4.5')
app_path.write_text(app, encoding='utf-8')

for rel in ['src/main/core/AccountService.ts', 'src/main/core/RemoteService.ts']:
    p = root / rel
    text = p.read_text(encoding='utf-8').replace('BestiaryLauncher/5.4.4', 'BestiaryLauncher/5.4.5')
    req('BestiaryLauncher/5.4.5' in text, 'Unable to bump ' + rel)
    p.write_text(text, encoding='utf-8')

home_path = root / 'src/renderer/src/components/Home.tsx'
home = home_path.read_text(encoding='utf-8').replace('5.4.4', '5.4.5')
home_path.write_text(home, encoding='utf-8')


# Contracts
main_check = main_path.read_text(encoding='utf-8')
settings_check = settings_path.read_text(encoding='utf-8')
ipc_check = ipc_path.read_text(encoding='utf-8')
preload_check = preload_path.read_text(encoding='utf-8')

req("event.type === 'state' && event.state === 'running'" in main_check and 'mainWindow.hide();' in main_check,
    'Auto-hide-on-running contract missing')
req("event.type === 'state' && event.state === 'stopped'" in main_check and 'restoreBestiaryWindow();' in main_check,
    'Restore-on-stop contract missing')
req('minecraftSessionActive' in main_check and "bestiary:keybind-save" in main_check,
    'Active-game keybind write guard missing')
req('getKeybinds(): Promise<KeybindSnapshot>;' in ipc_check,
    'Keybind renderer IPC type missing')
req("bestiary:keybind-get" in preload_check and "bestiary:keybind-save" in preload_check,
    'Keybind preload bridge missing')
req("setTab('controls')" in settings_check and "<KeybindPanel />" in settings_check,
    'Controls tab missing')

print('Bestiary Launcher 5.4.5 auto-hide and keybind settings patch applied.')

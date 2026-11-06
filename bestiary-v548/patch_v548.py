from pathlib import Path
import shutil

root = Path('source')

def edit(rel, fn):
    path = root / rel
    data = path.read_text(encoding='utf-8')
    updated = fn(data)
    if updated == data:
        raise SystemExit('Patch made no changes: ' + rel)
    path.write_text(updated, encoding='utf-8')

def replace_once(source, old, new):
    if source.count(old) != 1:
        raise SystemExit('Expected exactly one marker, got ' + str(source.count(old)) + ': ' + old[:120])
    return source.replace(old, new, 1)

for rel, source in [
    ('src/main/core/ModpackManager.ts', 'bestiary-v548/ModpackManager.ts'),
    ('src/renderer/src/components/ModpacksScreen.tsx', 'bestiary-v548/ModpacksScreen.tsx'),
    ('src/renderer/src/components/ModpacksScreen.css', 'bestiary-v548/ModpacksScreen.css'),
]:
    target = root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)

def ipc_patch(s):
    marker = 'export interface LauncherSnapshot {'
    types = """export interface ModpackInfo {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: 'fabric';
  fabricLoader: string;
  createdAt: string;
  updatedAt: string;
}

"""
    s = replace_once(s, marker, types + marker)
    marker = '  getLibrary(): Promise<LibrarySnapshot>;'
    methods = """  listModpacks(): Promise<ModpackInfo[]>;
  createModpack(name: string): Promise<ModpackInfo>;
  renameModpack(id: string, name: string): Promise<ModpackInfo>;
  duplicateModpack(id: string): Promise<ModpackInfo>;
  removeModpack(id: string): Promise<void>;
  getModpackLibrary(id: string): Promise<LibrarySnapshot>;
  installModpackFiles(id: string, paths: string[]): Promise<LibraryImportResult>;
  toggleModpackFile(id: string, relative: string): Promise<LibrarySnapshot>;
  removeModpackFile(id: string, relative: string): Promise<LibrarySnapshot>;
  importModpackZip(): Promise<ModpackInfo | null>;
  exportModpackZip(id: string, includeWorlds: boolean): Promise<string | null>;
"""
    return replace_once(s, marker, methods + marker)
edit('src/shared/ipc.ts', ipc_patch)

def preload_patch(s):
    marker = "  getLibrary: () => ipcRenderer.invoke('bestiary:library-get'),"
    methods = """  listModpacks: () => ipcRenderer.invoke('bestiary:modpacks-list'),
  createModpack: (name: string) => ipcRenderer.invoke('bestiary:modpacks-create', name),
  renameModpack: (id: string, name: string) => ipcRenderer.invoke('bestiary:modpacks-rename', id, name),
  duplicateModpack: (id: string) => ipcRenderer.invoke('bestiary:modpacks-duplicate', id),
  removeModpack: (id: string) => ipcRenderer.invoke('bestiary:modpacks-remove', id),
  getModpackLibrary: (id: string) => ipcRenderer.invoke('bestiary:modpacks-library', id),
  installModpackFiles: (id: string, paths: string[]) => ipcRenderer.invoke('bestiary:modpacks-install', id, paths),
  toggleModpackFile: (id: string, relative: string) => ipcRenderer.invoke('bestiary:modpacks-toggle', id, relative),
  removeModpackFile: (id: string, relative: string) => ipcRenderer.invoke('bestiary:modpacks-remove-file', id, relative),
  importModpackZip: () => ipcRenderer.invoke('bestiary:modpacks-import'),
  exportModpackZip: (id: string, includeWorlds: boolean) => ipcRenderer.invoke('bestiary:modpacks-export', id, includeWorlds),
"""
    return replace_once(s, marker, methods + marker)
edit('src/preload/index.ts', preload_patch)

def main_patch(s):
    marker = "import { ContentManager } from './core/ContentManager';"
    s = replace_once(s, marker, marker + "\nimport { ModpackManager } from './core/ModpackManager';")
    marker = 'const contentManager = new ContentManager(gameDirectory, ownershipFilePath);'
    s = replace_once(s, marker, marker + '\nconst modpackManager = new ModpackManager(dataRoot);')
    marker = "  ipcMain.handle('bestiary:start-game', async (_event, settings: LauncherSettings) => startGame(settings));"
    handlers = """  ipcMain.handle('bestiary:modpacks-list', () => modpackManager.list());
  ipcMain.handle('bestiary:modpacks-create', (_event, name: string) => modpackManager.create(name));
  ipcMain.handle('bestiary:modpacks-rename', (_event, id: string, name: string) => modpackManager.rename(id, name));
  ipcMain.handle('bestiary:modpacks-duplicate', (_event, id: string) => modpackManager.duplicate(id));
  ipcMain.handle('bestiary:modpacks-remove', async (_event, id: string) => {
    if (minecraftSessionActive) throw new Error('Hãy thoát Minecraft trước khi xóa modpack.');
    await modpackManager.remove(id);
  });
  ipcMain.handle('bestiary:modpacks-library', (_event, id: string) => modpackManager.snapshot(id));
  ipcMain.handle('bestiary:modpacks-install', async (_event, id: string, paths: string[]) => {
    if (minecraftSessionActive) throw new Error('Hãy thoát Minecraft trước khi cài mod.');
    return modpackManager.installFiles(id, paths);
  });
  ipcMain.handle('bestiary:modpacks-toggle', async (_event, id: string, relative: string) => {
    if (minecraftSessionActive) throw new Error('Hãy thoát Minecraft trước khi bật/tắt mod.');
    return modpackManager.toggleFile(id, relative);
  });
  ipcMain.handle('bestiary:modpacks-remove-file', async (_event, id: string, relative: string) => {
    if (minecraftSessionActive) throw new Error('Hãy thoát Minecraft trước khi gỡ mod.');
    return modpackManager.removeFile(id, relative);
  });
  ipcMain.handle('bestiary:modpacks-import', async () => {
    if (minecraftSessionActive) throw new Error('Hãy thoát Minecraft trước khi import modpack.');
    const selection = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Modpack ZIP', extensions: ['zip'] }] });
    return selection.canceled || !selection.filePaths[0] ? null : modpackManager.importZip(selection.filePaths[0]);
  });
  ipcMain.handle('bestiary:modpacks-export', async (_event, id: string, includeWorlds: boolean) => {
    const pack = await modpackManager.read(id);
    const safeName = pack.name.replace(/[^a-zA-Z0-9_-]/gu, '_');
    const selection = await dialog.showSaveDialog({
      defaultPath: safeName + '.zip', filters: [{ name: 'Modpack ZIP', extensions: ['zip'] }],
    });
    if (selection.canceled || !selection.filePath) return null;
    await modpackManager.exportZip(id, selection.filePath, includeWorlds === true);
    return selection.filePath;
  });
"""
    return replace_once(s, marker, handlers + marker)
edit('src/main/index.ts', main_patch)

def app_patch(s):
    marker = "import { ContentScreen } from './components/ContentScreen';"
    s = replace_once(s, marker, marker + "\nimport { ModpacksScreen } from './components/ModpacksScreen';")
    marker = "type Screen = 'home' | 'content' | 'account';"
    s = replace_once(s, marker, "type Screen = 'home' | 'content' | 'account' | 'modpacks';")
    marker = "  if (screen === 'content') return <><ContentScreen onBack={() => setScreen('home')} />"
    s = replace_once(s, marker, "  if (screen === 'modpacks') return <><ModpacksScreen onBack={() => setScreen('home')} />{update.status === 'ready' && <UpdateBar state={update} />}</>;\n" + marker)
    marker = "onLibrary={() => setScreen('content')} onAccount="
    s = replace_once(s, marker, "onLibrary={() => setScreen('content')} onModpacks={() => setScreen('modpacks')} onAccount=")
    return s
edit('src/renderer/src/App.tsx', app_patch)

def home_patch(s):
    marker = '  onLibrary: () => void;'
    s = replace_once(s, marker, marker + '\n  onModpacks: () => void;')
    marker = 'onLibrary, onAccount, account,'
    s = replace_once(s, marker, 'onLibrary, onModpacks, onAccount, account,')
    marker = '<button onClick={onLibrary}>'
    if marker not in s:
        raise SystemExit('Could not find Home Library button')
    s = replace_once(s, marker, '<button onClick={onModpacks}><b>▦</b><span><strong>My Modpacks</strong><small>Tạo, import, quản lý profile cá nhân</small></span></button>\n          ' + marker)
    return s
edit('src/renderer/src/components/Home.tsx', home_patch)
print('Applied 5.4.8 Modpack Manager backend/UI IPC patch.')

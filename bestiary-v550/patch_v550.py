from pathlib import Path
import re
import shutil

root = Path('source')

def replace_one(path, old, new):
    target = root / path
    source = target.read_text(encoding='utf-8')
    if source.count(old) != 1:
        raise SystemExit(f'{path} expected exactly one marker (found {source.count(old)}): {old[:140]}')
    target.write_text(source.replace(old, new, 1), encoding='utf-8')

for rel, source in [
    ('src/main/core/LoaderCatalog.ts', 'bestiary-v550/LoaderCatalog.ts'),
    ('src/main/core/PersonalRuntimeInstaller.ts', 'bestiary-v550/PersonalRuntimeInstaller.ts'),
    ('src/main/core/ContentManager.ts', 'bestiary-v550/ContentManager.ts'),
    ('src/main/core/ModpackManager.ts', 'bestiary-v550/ModpackManager.ts'),
    ('src/renderer/src/components/CreateModpackDialog.tsx', 'bestiary-v550/CreateModpackDialog.tsx'),
    ('src/renderer/src/components/ModpacksScreen.tsx', 'bestiary-v550/ModpacksScreen.tsx'),
    ('src/renderer/src/components/ModpacksScreen.css', 'bestiary-v550/ModpacksScreen.css'),
]:
    target = root / rel
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)

replace_one('src/shared/ipc.ts',
'''export interface ModpackInfo {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: 'fabric';
  fabricLoader: string;
  createdAt: string;
  updatedAt: string;
}''',
'''export type ModpackLoader = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge';
export interface ModpackSelection {
  minecraftVersion: string;
  loader: ModpackLoader;
  loaderVersion: string | null;
}
export interface ModpackInfo extends ModpackSelection {
  id: string;
  name: string;
  /** Migration support for existing Fabric-only packs created by 5.4.8/5.4.9. */
  fabricLoader?: string;
  createdAt: string;
  updatedAt: string;
}''')
replace_one('src/shared/ipc.ts',
'''  listModpacks(): Promise<ModpackInfo[]>;
  createModpack(name: string): Promise<ModpackInfo>;''',
'''  listModpacks(): Promise<ModpackInfo[]>;
  getModpackMinecraftVersions(): Promise<string[]>;
  getModpackLoaderVersions(minecraftVersion: string, loader: ModpackLoader): Promise<string[]>;
  createModpack(name: string, selection?: ModpackSelection): Promise<ModpackInfo>;
  playModpack(id: string): Promise<LaunchResponse>;''')

replace_one('src/preload/index.ts',
"import type { AccountMode, AppUpdateState, AuthStatusEvent, GameLogEvent, LauncherSettings, LibraryKind, RendererApi, SkinSetRequest, UiProgressEvent } from '../shared/ipc';",
"import type { AccountMode, AppUpdateState, AuthStatusEvent, GameLogEvent, LauncherSettings, LibraryKind, ModpackLoader, ModpackSelection, RendererApi, SkinSetRequest, UiProgressEvent } from '../shared/ipc';")
replace_one('src/preload/index.ts',
'''  listModpacks: () => ipcRenderer.invoke('bestiary:modpacks-list'),
  createModpack: (name: string) => ipcRenderer.invoke('bestiary:modpacks-create', name),''',
'''  listModpacks: () => ipcRenderer.invoke('bestiary:modpacks-list'),
  getModpackMinecraftVersions: () => ipcRenderer.invoke('bestiary:modpacks-minecraft-versions'),
  getModpackLoaderVersions: (minecraftVersion: string, loader: ModpackLoader) =>
    ipcRenderer.invoke('bestiary:modpacks-loader-versions', minecraftVersion, loader),
  createModpack: (name: string, selection?: ModpackSelection) => ipcRenderer.invoke('bestiary:modpacks-create', name, selection),
  playModpack: (id: string) => ipcRenderer.invoke('bestiary:modpacks-play', id),''')

replace_one('src/main/index.ts',
"import { ModpackManager } from './core/ModpackManager';",
"import { ModpackManager } from './core/ModpackManager';\nimport { LoaderCatalog, validateModpackSelection } from './core/LoaderCatalog';\nimport { PersonalRuntimeInstaller } from './core/PersonalRuntimeInstaller';")

replace_one('src/main/index.ts',
"  ipcMain.handle('bestiary:modpacks-create', (_event, name: string) => modpackManager.create(name));",
"""  ipcMain.handle('bestiary:modpacks-minecraft-versions', () => LoaderCatalog.minecraftVersions());
  ipcMain.handle('bestiary:modpacks-loader-versions', (_event, mc: string, loader: import('../shared/ipc').ModpackLoader) =>
    LoaderCatalog.loaderVersions(mc, loader));
  ipcMain.handle('bestiary:modpacks-create', (_event, name: string, selection?: import('../shared/ipc').ModpackSelection) =>
    modpackManager.create(name, selection));
  ipcMain.handle('bestiary:modpacks-play', (_event, id: string) => startPersonalModpack(id));""")

new_function = """async function startPersonalModpack(id: string): Promise<{ ok: boolean; message?: string }> {
  if (launchBusy || minecraftSessionActive || minecraftLauncher.isRunning()) {
    return { ok: false, message: 'Minecraft đang chạy hoặc launcher đang xử lý.' };
  }
  launchBusy = true;
  try {
    const pack = await modpackManager.read(id);
    validateModpackSelection(pack);
    const settings = await settingsStore.load();
    const directory = modpackManager.instanceDirectory(id);
    await fs.ensureDir(directory);

    sendProgress({
      stage: 'java', percent: 12, title: 'Chuẩn bị Java', detail: pack.minecraftVersion,
      speedMBps: 0, etaSeconds: null,
    });
    const javaPath = await jreManager.ensureJavaForMinecraft(pack.minecraftVersion);

    sendProgress({
      stage: 'fabric', percent: 35, title: 'Chuẩn bị ' + pack.loader,
      detail: pack.loaderVersion || pack.minecraftVersion, speedMBps: 0, etaSeconds: null,
    });
    const profileId = await PersonalRuntimeInstaller.ensure(pack, directory, javaPath, (detail) => {
      sendProgress({ stage: 'fabric', percent: 40, title: 'Đang cài ' + pack.loader,
        detail, speedMBps: 0, etaSeconds: null });
    });

    // Personal packs run directly with their own game directory. Never inherit
    // the official SVFrame manifest, Full/Lite mod list, server autoconnect or world.
    if (accountService.shouldUseOfficialLauncher()) {
      throw new Error('Chế độ Microsoft hiện đang yêu cầu Minecraft Launcher chính thức. Chuyển sang direct launch hoặc Local account cho modpack cá nhân.');
    }
    const authorization = await accountService.getLaunchAuthorization(settings.username);
    sendProgress({ stage: 'launching', percent: 90, title: 'Đang mở Minecraft ' + pack.minecraftVersion,
      detail: pack.loader.toUpperCase() + ' ' + (pack.loaderVersion || ''),
      speedMBps: 0, etaSeconds: null });

    await minecraftLauncher.launch({
      username: authorization?.name ?? settings.username,
      authorization: authorization ?? undefined,
      gameDirectory: directory,
      javaPath,
      minecraftVersion: pack.minecraftVersion,
      customVersionId: profileId === pack.minecraftVersion ? undefined : profileId,
      fabricLoader: pack.loader === 'fabric' ? pack.loaderVersion || undefined : undefined,
      memory: { minMb: settings.minRamMb, maxMb: settings.maxRamMb },
      window: { width: settings.width, height: settings.height, fullscreen: settings.fullscreen },
      extraJvmArgs: settings.generatedJvmArgs,
      timeoutMs: 120_000,
    });
    sendProgress({ stage: 'running', percent: 100, title: 'Minecraft đang chạy',
      detail: pack.name + ' (' + pack.loader + ')', speedMBps: 0, etaSeconds: null });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendProgress({ stage: 'error', percent: 0, title: 'Không thể chạy modpack',
      detail: message, speedMBps: 0, etaSeconds: null });
    sendLog({ level: 'error', message });
    return { ok: false, message };
  } finally {
    launchBusy = false;
  }
}

"""
replace_one('src/main/index.ts', 'async function accountSnapshot() {', new_function + 'async function accountSnapshot() {')

jre_path = root / 'src/main/core/JreManager.ts'
jre = jre_path.read_text(encoding='utf-8')
pat = r'(getRequiredJavaVersion\(minecraftVersion: string\): number \{\s*const parsed = parseMinecraftVersion\(minecraftVersion\);)([\s\S]*?)(\n  \})'
m = re.search(pat, jre)
if not m:
    raise SystemExit('Unable to find exact JreManager.getRequiredJavaVersion implementation.')
newbody = """
    if (compareVersion(parsed, [26, 0, 0]) >= 0) return 25;
    if (compareVersion(parsed, [1, 20, 5]) >= 0) return 21;
    if (compareVersion(parsed, [1, 18, 0]) >= 0) return 17;
    if (compareVersion(parsed, [1, 17, 0]) >= 0) return 16;
    return 8;"""
jre = jre[:m.start()] + m.group(1) + newbody + m.group(3) + jre[m.end():]
jre_path.write_text(jre, encoding='utf-8')

replace_one('src/renderer/src/App.tsx', "currentVersion: '5.4.9'", "currentVersion: '5.5.0'")
home = root / 'src/renderer/src/components/Home.tsx'
home.write_text(home.read_text(encoding='utf-8').replace('5.4.9', '5.5.0'), encoding='utf-8')
for rel in ('src/main/core/AccountService.ts', 'src/main/core/RemoteService.ts'):
    target=root / rel
    target.write_text(target.read_text(encoding='utf-8').replace('BestiaryLauncher/5.4.9', 'BestiaryLauncher/5.5.0'), encoding='utf-8')

print('Applied 5.5.0: per-pack Minecraft / loader / loader version selection and isolated runtime install+launch.')

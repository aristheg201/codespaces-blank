from pathlib import Path
import shutil

root = Path('source')
def patch_once(rel, old, new):
    p = root / rel
    s = p.read_text(encoding='utf-8')
    if s.count(old) != 1:
        raise SystemExit(f'[V560] {rel}: expected one marker, found {s.count(old)} for {old[:100]!r}')
    p.write_text(s.replace(old, new, 1), encoding='utf-8')

core = root / 'src/main/core/PersonalInstanceRuntimeService.ts'
core.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile('bestiary-v560/PersonalInstanceRuntimeService.ts', core)

patch_once('src/shared/ipc.ts',
'''export interface ModpackInfo extends ModpackSelection {''',
'''export interface ModpackRuntimeSettings {
  schema: 1;
  javaMajor: 8 | 17 | 21 | 25 | null;
  minRamMb: number | null;
  maxRamMb: number | null;
}
export interface ModpackInfo extends ModpackSelection {''')

patch_once('src/shared/ipc.ts',
'''  playModpack(id: string): Promise<LaunchResponse>;''',
'''  playModpack(id: string): Promise<LaunchResponse>;
  getModpackRuntimeSettings(id: string): Promise<ModpackRuntimeSettings>;
  saveModpackRuntimeSettings(id: string, settings: ModpackRuntimeSettings): Promise<ModpackRuntimeSettings>;''')

patch_once('src/preload/index.ts',
'''import type { ModpackLoader, ModpackSelection } from '../shared/ipc';''',
'''import type { ModpackLoader, ModpackSelection, ModpackRuntimeSettings } from '../shared/ipc';''')

patch_once('src/preload/index.ts',
'''  playModpack: (id: string) => ipcRenderer.invoke('bestiary:modpacks-play', id),''',
'''  playModpack: (id: string) => ipcRenderer.invoke('bestiary:modpacks-play', id),
  getModpackRuntimeSettings: (id: string) =>
    ipcRenderer.invoke('bestiary:modpacks-runtime-get', id),
  saveModpackRuntimeSettings: (id: string, settings: ModpackRuntimeSettings) =>
    ipcRenderer.invoke('bestiary:modpacks-runtime-save', id, settings),''')

patch_once('src/main/index.ts',
'''import { planPersonalMemory } from './core/PersonalMemory';''',
'''import { PersonalInstanceRuntimeService } from './core/PersonalInstanceRuntimeService';''')

patch_once('src/main/index.ts',
'''  ipcMain.handle('bestiary:modpacks-play', (_event, id: string) => startPersonalModpack(id));''',
'''  ipcMain.handle('bestiary:modpacks-play', (_event, id: string) => startPersonalModpack(id));
  ipcMain.handle('bestiary:modpacks-runtime-get', async (_event, id: string) => {
    await modpackManager.read(id);
    return new PersonalInstanceRuntimeService(modpackManager.instanceDirectory(id)).snapshot();
  });
  ipcMain.handle('bestiary:modpacks-runtime-save', async (
    _event, id: string, runtime: import('../shared/ipc').ModpackRuntimeSettings,
  ) => {
    if (launchBusy || minecraftLauncher.isRunning()) throw new Error('Không thể sửa runtime khi Minecraft đang chạy.');
    await modpackManager.read(id);
    return new PersonalInstanceRuntimeService(modpackManager.instanceDirectory(id)).save(runtime);
  });''')

main_file = root / 'src/main/index.ts'
main = main_file.read_text(encoding='utf-8')
start = main.index('async function startPersonalModpack(')
end = main.index('async function accountSnapshot() {', start)
personal = main[start:end]
old_memory = '''    const personalMemory = planPersonalMemory(settings);'''
if personal.count(old_memory) != 1:
    raise SystemExit('Personal memory marker mismatch')
personal = personal.replace(old_memory,
'''    const personalRuntime = await new PersonalInstanceRuntimeService(directory).prepare(pack, settings);''', 1)

# The original version arithmetic is error-prone for legacy Java and
# future releases. Mojang's javaVersion.majorVersion now owns the decision.
before = '''    const mcParts = pack.minecraftVersion.split('.').map((segment) => Number.parseInt(segment, 10));'''
after = '''    const javaPath = await jreManager.ensureJava(personalRuntime.javaMajor);'''
p = personal.index(before)
q = personal.index('    const javaPath = await jreManager.ensureJava(javaMajor);', p)
personal = personal[:p] + after + personal[q + len('    const javaPath = await jreManager.ensureJava(javaMajor);'):]

old = 'memory: { minMb: personalMemory.minMb, maxMb: personalMemory.maxMb },'
if personal.count(old) != 1:
    raise SystemExit('Old memory assignment missing')
personal = personal.replace(old, 'memory: personalRuntime.memory,', 1)
old = 'await withLoaderJvmArgs(pack.loader, settings.generatedJvmArgs, directory, profileId)'
if personal.count(old) != 1:
    raise SystemExit('Personal JVM argument handoff missing')
personal = personal.replace(old,
    'await withLoaderJvmArgs(pack.loader, personalRuntime.jvmArgs, directory, profileId)', 1)

for forbidden in ('keybindPolicyService', 'officialLowEndOptionsService', 'bestiary-keybinds.json',
                  'settings.generatedJvmArgs', 'planPersonalMemory(settings)'):
    if forbidden in personal:
        raise SystemExit('Personal runtime inherited Official component: ' + forbidden)
main = main[:start] + personal + main[end:]
main_file.write_text(main, encoding='utf-8')

ui_file = root / 'src/renderer/src/components/ModpacksScreen.tsx'
ui = ui_file.read_text(encoding='utf-8')
marker = "import { CreateModpackDialog } from './CreateModpackDialog';"
assert ui.count(marker) == 1, 'UI import marker mismatch'
ui = ui.replace(marker, marker + "\nimport { PersonalRuntimeSettingsDialog } from './PersonalRuntimeSettingsDialog';", 1)
marker = "  const [dialog, setDialog] = useState<ModpackDialog | null>(null);"
assert ui.count(marker) == 1, 'UI dialog marker mismatch'
ui = ui.replace(marker, marker + "\n  const [runtimeTarget, setRuntimeTarget] = useState<string | null>(null);", 1)
marker = '<button disabled={busy || dialog !== null} onClick={openRename}>RENAME</button>'
assert ui.count(marker) == 1, 'UI runtime button marker mismatch'
ui = ui.replace(marker, '<button disabled={busy || dialog !== null} onClick={() => setRuntimeTarget(active.id)}>JAVA & RAM</button>\n              ' + marker, 1)
marker = "    {dialog?.kind === 'create' ? <CreateModpackDialog"
assert ui.count(marker) == 1, 'UI end marker mismatch'
ui = ui.replace(marker,
    "    {runtimeTarget && <PersonalRuntimeSettingsDialog packId={runtimeTarget} onClose={() => setRuntimeTarget(null)} />}\n\n" + marker,
    1)
ui_file.write_text(ui, encoding='utf-8')

renderer = root / 'src/renderer/src/components/PersonalRuntimeSettingsDialog.tsx'
shutil.copyfile('bestiary-v560/PersonalRuntimeSettingsDialog.tsx', renderer)

final = main_file.read_text(encoding='utf-8')
assert 'personalRuntime.javaMajor' in final
assert 'memory: personalRuntime.memory,' in final
assert 'getModpackRuntimeSettings' in (root / 'src/shared/ipc.ts').read_text(encoding='utf-8')
print('V560 runtime integration: independent per-instance Java/RAM, service IPC, editor, no Official leakage.')

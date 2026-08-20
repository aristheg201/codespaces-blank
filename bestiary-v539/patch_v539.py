from pathlib import Path
import re

root = Path('source')


def req(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(message)


generator_path = root / 'src/main/core/JvmProfileGenerator.ts'
req(generator_path.exists(), 'JvmProfileGenerator.ts missing')
generator = generator_path.read_text(encoding='utf-8')
req("GENERATOR_REVISION_ARG = '-Dbestiary.jvm.profile=539'" in generator, '5.3.9 generator revision missing')
req("tier: 'low_memory'" in generator and 'hardMaxMb: 2048' in generator, 'Low-memory heap policy missing')

# Make Generate atomic: RAM recommendation + JVM flags are one hardware profile.
main_path = root / 'src/main/index.ts'
main = main_path.read_text(encoding='utf-8')
old = """  ipcMain.handle('bestiary:generate-jvm', async (_event, input: LauncherSettings) => {
    const remote = currentRemote ?? (await getRemote());
    const generated = generateJvmProfile(input, remote);
    await settingsStore.save({ ...input, generatedJvmArgs: generated.args });
    return snapshot();
  });"""
req(old in main, 'generate-jvm handler marker missing')
main = main.replace(
    old,
    """  ipcMain.handle('bestiary:generate-jvm', async (_event, input: LauncherSettings) => {
    const remote = currentRemote ?? (await getRemote());
    const generated = generateJvmProfile(input, remote);
    await settingsStore.save({
      ...input,
      minRamMb: generated.recommendedMinRamMb,
      maxRamMb: generated.recommendedMaxRamMb,
      generatedJvmArgs: generated.args,
    });
    return snapshot();
  });""",
    1,
)

old = "    const settings = await settingsStore.save(input);"
req(old in main, 'startGame settings save marker missing')
main = main.replace(old, "    let settings = await settingsStore.save(input);", 1)

old = """    if (!settings.clientProfile) {
      throw new Error('Chưa chọn cấu hình client Full hoặc Lite.');
    }

    const sync = new SyncEngine({"""
req(old in main, 'startGame profile guard marker missing')
main = main.replace(
    old,
    """    if (!settings.clientProfile) {
      throw new Error('Chưa chọn cấu hình client Full hoặc Lite.');
    }

    const adaptiveJvm = generateJvmProfile(settings, remote);
    const weakMemoryTier = adaptiveJvm.memoryTier === 'low_memory' || adaptiveJvm.memoryTier === 'entry';
    const currentJvmProfile = settings.generatedJvmArgs.includes('-Dbestiary.jvm.profile=539');
    if (weakMemoryTier && (!currentJvmProfile || settings.maxRamMb > adaptiveJvm.recommendedMaxRamMb)) {
      const nextMaxRamMb = Math.min(settings.maxRamMb, adaptiveJvm.recommendedMaxRamMb);
      const nextMinRamMb = Math.max(512, Math.min(settings.minRamMb, adaptiveJvm.recommendedMinRamMb, nextMaxRamMb));
      settings = await settingsStore.save({
        ...settings,
        minRamMb: nextMinRamMb,
        maxRamMb: nextMaxRamMb,
        generatedJvmArgs: currentJvmProfile ? settings.generatedJvmArgs : adaptiveJvm.args,
      });
    }

    const sync = new SyncEngine({""",
    1,
)
main_path.write_text(main, encoding='utf-8')

# Weak machines can actually select low heaps; Generate updates RAM + flags together.
settings_path = root / 'src/renderer/src/components/SettingsModal.tsx'
settings_ui = settings_path.read_text(encoding='utf-8')
old = "  const maxSafeRamMb = useMemo(() => Math.max(4096, Math.floor(snapshot.systemRamMb * 0.7 / 512) * 512), [snapshot.systemRamMb]);"
req(old in settings_ui, 'SettingsModal maxSafeRamMb marker missing')
settings_ui = settings_ui.replace(
    old,
    """  const maxSafeRamMb = useMemo(() => {
    const total = snapshot.systemRamMb;
    const reserve = total <= 4608 ? 2048 : total <= 6144 ? 2560 : total <= 8192 ? 3072 : total <= 12_288 ? 4096 : 5120;
    return Math.max(1024, Math.floor(Math.min(total * 0.65, total - reserve) / 256) * 256);
  }, [snapshot.systemRamMb]);
  const selectedProfile = snapshot.release.profiles.find((profile) => profile.id === settings.clientProfile);
  const profileMemoryWarning = selectedProfile && maxSafeRamMb < selectedProfile.minimumRamMb;""",
    1,
)
old = "      onChange({ generatedJvmArgs: next.settings.generatedJvmArgs });"
req(old in settings_ui, 'SettingsModal generate result marker missing')
settings_ui = settings_ui.replace(
    old,
    """      onChange({
        minRamMb: next.settings.minRamMb,
        maxRamMb: next.settings.maxRamMb,
        generatedJvmArgs: next.settings.generatedJvmArgs,
      });""",
    1,
)
old = "<div className=\"ux-section-title\"><span>HIỆU NĂNG</span><h3>RAM và preset</h3><p>Launcher không tự generate JVM flags. Chỉ nút ở phần Nâng cao mới làm việc đó.</p></div>"
req(old in settings_ui, 'SettingsModal performance copy marker missing')
settings_ui = settings_ui.replace(
    old,
    "<div className=\"ux-section-title\"><span>HIỆU NĂNG</span><h3>RAM và preset</h3><p>Generator dùng RAM vật lý, CPU và Full/Lite để tạo một profile RAM + G1GC đồng bộ. Máy ít RAM được ưu tiên chừa bộ nhớ cho Windows và native libraries.</p></div>",
    1,
)
old = '<div className="ux-ram-card"><div><span>RAM TỐI ĐA</span><strong>{(settings.maxRamMb/1024).toFixed(1)} GB</strong><small>Máy có {(snapshot.systemRamMb/1024).toFixed(1)} GB RAM • giới hạn an toàn khoảng {(maxSafeRamMb/1024).toFixed(1)} GB</small></div><input type="range" min={4096} max={Math.max(4096,maxSafeRamMb)} step={512} value={Math.min(settings.maxRamMb,maxSafeRamMb)} onChange={(e)=>onChange({maxRamMb:Number(e.target.value)})}/></div>'
req(old in settings_ui, 'SettingsModal RAM slider marker missing')
settings_ui = settings_ui.replace(
    old,
    '<div className="ux-ram-card"><div><span>RAM TỐI ĐA</span><strong>{(settings.maxRamMb/1024).toFixed(1)} GB</strong><small>Máy có {(snapshot.systemRamMb/1024).toFixed(1)} GB RAM • trần chỉnh tay an toàn khoảng {(maxSafeRamMb/1024).toFixed(1)} GB</small></div><input type="range" min={1024} max={Math.max(1024,maxSafeRamMb)} step={256} value={Math.max(1024,Math.min(settings.maxRamMb,maxSafeRamMb))} onChange={(e)=>onChange({maxRamMb:Number(e.target.value)})}/></div>{profileMemoryWarning&&<div className="ux-error">RAM vật lý của máy thấp hơn mức tối thiểu công bố cho {selectedProfile?.name}. Generator sẽ ưu tiên giữ Windows/native memory sống trước; bản Lite vẫn là lựa chọn an toàn hơn.</div>}',
    1,
)
old = '<div className="ux-advanced-actions"><button disabled={generating} onClick={()=>void generate()}><strong>{generating?\'ĐANG GENERATE...\':\'GENERATE JVM FLAGS\'}</strong><small>Đọc cấu hình máy và lưu bộ flags mới. Không chạy tự động.</small></button>'
req(old in settings_ui, 'SettingsModal Generate copy marker missing')
settings_ui = settings_ui.replace(
    old,
    '<div className="ux-advanced-actions"><button disabled={generating} onClick={()=>void generate()}><strong>{generating?\'ĐANG GENERATE...\':\'GENERATE JVM + RAM PROFILE\'}</strong><small>Đọc RAM/CPU, tính heap an toàn và tạo G1GC profile Java 21. Máy 4-6 GB dùng low-memory policy riêng.</small></button>',
    1,
)
settings_path.write_text(settings_ui, encoding='utf-8')

# First client selection uses the adaptive generator before launch.
app_path = root / 'src/renderer/src/App.tsx'
app = app_path.read_text(encoding='utf-8')
old = """    const currentSnapshot = store.snapshot;
    if (!store.settings || !currentSnapshot) return;
    const descriptor = currentSnapshot.release.profiles.find((item) => item.id === profile);
    const next: LauncherSettings = { ...store.settings, clientProfile: profile, maxRamMb: descriptor ? Math.min(descriptor.recommendedRamMb, Math.floor(currentSnapshot.systemRamMb * 0.7)) : store.settings.maxRamMb };
    store.patchSettings(next);
    const saved = await window.bestiary.saveSettings(next);
    store.setSnapshot(saved);
    setProfileOpen(false);
    await runGame(saved.settings);"""
req(old in app, 'ProfileChooser allocation block missing')
app = app.replace(
    old,
    """    if (!store.settings || !store.snapshot) return;
    const next: LauncherSettings = { ...store.settings, clientProfile: profile };
    store.patchSettings(next);
    const generated = await window.bestiary.generateJvmFlags(next);
    store.setSnapshot(generated);
    store.patchSettings(generated.settings);
    setProfileOpen(false);
    await runGame(generated.settings);""",
    1,
)
app = re.sub(r"currentVersion:\s*'\d+\.\d+\.\d+'", "currentVersion: '5.3.9'", app, count=1)
req("currentVersion: '5.3.9'" in app, 'Unable to bump App version to 5.3.9')
app_path.write_text(app, encoding='utf-8')

for rel in ['src/main/core/AccountService.ts', 'src/main/core/RemoteService.ts']:
    path = root / rel
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'BestiaryLauncher/5\.3\.\d+', 'BestiaryLauncher/5.3.9', text)
    path.write_text(text, encoding='utf-8')

home_path = root / 'src/renderer/src/components/Home.tsx'
home = home_path.read_text(encoding='utf-8')
home = re.sub(r'5\.3\.\d+', '5.3.9', home)
home_path.write_text(home, encoding='utf-8')

print('Bestiary Launcher 5.3.9 adaptive JVM generator applied.')

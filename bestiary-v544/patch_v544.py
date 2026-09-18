from pathlib import Path
import re

root = Path('source')


def req(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(message)


generator_path = root / 'src/main/core/JvmProfileGenerator.ts'
req(generator_path.exists(), 'JvmProfileGenerator.ts missing')
generator = generator_path.read_text(encoding='utf-8')
req("GENERATOR_REVISION_ARG = '-Dbestiary.jvm.profile=544'" in generator, '5.4.4 generator revision missing')
for forbidden in (
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+DisableExplicitGC',
    '-XX:G1HeapWastePercent=',
    '-XX:G1MixedGCCountTarget=',
    '-XX:InitiatingHeapOccupancyPercent=',
    '-XX:G1MixedGCLiveThresholdPercent=',
    '-XX:G1RSetUpdatingPauseTimePercent=',
    '-XX:SurvivorRatio=',
    '-XX:MaxTenuringThreshold=',
    '-XX:G1NewSizePercent=',
    '-XX:G1MaxNewSizePercent=',
    '-XX:G1ReservePercent=',
    '-XX:ParallelGCThreads=',
    '-XX:ConcGCThreads=',
    '-XX:+AlwaysPreTouch',
):
    req(forbidden not in generator, f'Aggressive server-style JVM flag survived: {forbidden}')

# Force migration away from the 5.3.9 generator on the next game launch.
main_path = root / 'src/main/index.ts'
main = main_path.read_text(encoding='utf-8')
old = """    const adaptiveJvm = generateJvmProfile(settings, remote);
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
"""
req(old in main, '5.3.9 adaptive JVM migration block missing')
main = main.replace(
    old,
    """    const adaptiveJvm = generateJvmProfile(settings, remote);
    const currentJvmProfile = settings.generatedJvmArgs.includes('-Dbestiary.jvm.profile=544');
    if (!currentJvmProfile) {
      settings = await settingsStore.save({
        ...settings,
        minRamMb: adaptiveJvm.recommendedMinRamMb,
        maxRamMb: adaptiveJvm.recommendedMaxRamMb,
        generatedJvmArgs: adaptiveJvm.args,
      });
    } else if (settings.maxRamMb > adaptiveJvm.recommendedMaxRamMb) {
      const nextMaxRamMb = adaptiveJvm.recommendedMaxRamMb;
      const nextMinRamMb = Math.max(512, Math.min(settings.minRamMb, adaptiveJvm.recommendedMinRamMb, nextMaxRamMb));
      settings = await settingsStore.save({
        ...settings,
        minRamMb: nextMinRamMb,
        maxRamMb: nextMaxRamMb,
      });
    }
""",
    1,
)
main_path.write_text(main, encoding='utf-8')

# Make the RAM slider describe the same client-safe policy as the generator.
settings_path = root / 'src/renderer/src/components/SettingsModal.tsx'
settings_ui = settings_path.read_text(encoding='utf-8')
old = """  const maxSafeRamMb = useMemo(() => {
    const total = snapshot.systemRamMb;
    const reserve = total <= 4608 ? 2048 : total <= 6144 ? 2560 : total <= 8192 ? 3072 : total <= 12_288 ? 4096 : 5120;
    return Math.max(1024, Math.floor(Math.min(total * 0.65, total - reserve) / 256) * 256);
  }, [snapshot.systemRamMb]);"""
req(old in settings_ui, '5.3.9 SettingsModal RAM budget marker missing')
settings_ui = settings_ui.replace(
    old,
    """  const maxSafeRamMb = useMemo(() => {
    const total = snapshot.systemRamMb;
    const budget = total <= 4608
      ? Math.min(total * 0.80, total - 768, 3072)
      : total <= 6144
        ? Math.min(total * 0.58, total - 1792, 3072)
        : total <= 8192
          ? Math.min(total * 0.55, total - 2048, 4096)
          : total <= 12_288
            ? Math.min(total * 0.55, total - 3072, 6144)
            : total <= 16_384
              ? Math.min(total * 0.55, total - 4096, 8192)
              : Math.min(total * 0.60, total - 6144, 10_240);
    return Math.max(3072, Math.floor(budget / 256) * 256);
  }, [snapshot.systemRamMb]);""",
    1,
)
settings_ui = settings_ui.replace(
    'Generator dùng RAM vật lý, CPU và Full/Lite để tạo một profile RAM + G1GC đồng bộ. Máy ít RAM được ưu tiên chừa bộ nhớ cho Windows và native libraries.',
    'Generator dùng RAM vật lý và Full/Lite để tạo heap Java 21 an toàn. Client luôn được cấp tối thiểu 3 GB heap cho Cobblemon/resource reload; GC để Java 21 tự thích nghi thay vì ép Aikar/server flags.',
)
settings_ui = settings_ui.replace(
    'Đọc RAM/CPU, tính heap an toàn và tạo G1GC profile Java 21. Máy 4-6 GB dùng low-memory policy riêng.',
    'Đọc RAM, giữ tối thiểu 3 GB heap và tạo client JVM profile tối giản để tránh Java heap OOM khi tải Cobblemon/resource pack.',
)
settings_ui = settings_ui.replace(
    '<input type="range" min={1024} max={Math.max(1024,maxSafeRamMb)} step={256} value={Math.max(1024,Math.min(settings.maxRamMb,maxSafeRamMb))}',
    '<input type="range" min={3072} max={Math.max(3072,maxSafeRamMb)} step={256} value={Math.max(3072,Math.min(settings.maxRamMb,maxSafeRamMb))}',
)
req('min={3072}' in settings_ui, '3 GB RAM slider floor missing')
settings_path.write_text(settings_ui, encoding='utf-8')

# Version metadata.
app_path = root / 'src/renderer/src/App.tsx'
app = app_path.read_text(encoding='utf-8')
app = re.sub(r"currentVersion:\s*'5\.4\.3'", "currentVersion: '5.4.4'", app, count=1)
req("currentVersion: '5.4.4'" in app, 'Unable to bump App version to 5.4.4')
app_path.write_text(app, encoding='utf-8')

for rel in ['src/main/core/AccountService.ts', 'src/main/core/RemoteService.ts']:
    path = root / rel
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'BestiaryLauncher/5\.4\.3', 'BestiaryLauncher/5.4.4', text)
    req('BestiaryLauncher/5.4.4' in text, f'Unable to bump {rel} user-agent')
    path.write_text(text, encoding='utf-8')

home_path = root / 'src/renderer/src/components/Home.tsx'
home = home_path.read_text(encoding='utf-8')
home = home.replace('5.4.3', '5.4.4')
home_path.write_text(home, encoding='utf-8')

print('Bestiary Launcher 5.4.4 low-memory JVM patch applied.')

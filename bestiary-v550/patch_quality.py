from pathlib import Path
import re
import shutil

root = Path('source')

def replace_one(relative: str, old: str, new: str) -> None:
    target = root / relative
    content = target.read_text(encoding='utf-8')
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'[QUALITY PATCH] {relative}: marker count {count}, wanted 1: {old[:140]}')
    target.write_text(content.replace(old, new, 1), encoding='utf-8')

for relative, source in [
    ('src/main/core/KeybindPolicyService.ts', 'bestiary-v550/KeybindPolicyService.ts'),
    ('src/main/core/OfficialLowEndOptionsService.ts', 'bestiary-v550/OfficialLowEndOptionsService.ts'),
    ('src/main/core/JvmProfileGenerator.ts', 'bestiary-v550/JvmProfileGenerator.ts'),
    ('src/main/core/PersonalMemory.ts', 'bestiary-v550/PersonalMemory.ts'),
]:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)

main_path = root / 'src/main/index.ts'
main = main_path.read_text(encoding='utf-8')
if main.count("import { KeybindPolicyService } from './core/KeybindPolicyService';") != 1:
    raise SystemExit('Official keybind policy import missing')
main = main.replace(
    "import { KeybindPolicyService } from './core/KeybindPolicyService';",
    "import { KeybindPolicyService } from './core/KeybindPolicyService';\n"
    "import { OfficialLowEndOptionsService } from './core/OfficialLowEndOptionsService';",
    1,
)
if main.count("import { withLoaderJvmArgs } from './core/PersonalJvmArgs';") != 1:
    raise SystemExit('Personal JVM args import missing')
main = main.replace(
    "import { withLoaderJvmArgs } from './core/PersonalJvmArgs';",
    "import { withLoaderJvmArgs } from './core/PersonalJvmArgs';\n"
    "import { planPersonalMemory } from './core/PersonalMemory';",
    1,
)
marker = 'const keybindPolicyService = new KeybindPolicyService(gameDirectory);'
if main.count(marker) != 1:
    raise SystemExit('Official keybind policy instance marker missing')
main = main.replace(
    marker, marker + '\nconst officialLowEndOptionsService = new OfficialLowEndOptionsService(gameDirectory);', 1
)

# Official direct launch already has the original pre-launch keybind call.
# Preserve this location AFTER sync, and add adaptive graphics only for Lite.
direct = 'await keybindPolicyService.apply();'
if main.count(direct) != 1:
    raise SystemExit('Expected one Official direct-launch keybind application')
main = main.replace(direct,
    'await keybindPolicyService.apply();\n'
    '    await officialLowEndOptionsService.apply(settings.clientProfile);',
    1)

# Microsoft official bridge branches before the direct MinecraftLauncher call.
# It must receive the same Official keybind and Lite behavior.
bridge = 'await officialLauncherBridge.prepareAndOpen(profileId, settings);'
if main.count(bridge) != 1:
    raise SystemExit('Official Minecraft Launcher bridge call missing')
main = main.replace(bridge,
    'await keybindPolicyService.apply();\n'
    '      await officialLowEndOptionsService.apply(settings.clientProfile);\n'
    '      ' + bridge,
    1)

# Existing 5.4.4 JVM migration must be advanced, otherwise stored 3 GiB
# policies would never regenerate on machines with 4 GiB RAM.
old_revision = "settings.generatedJvmArgs.includes('-Dbestiary.jvm.profile=544')"
if main.count(old_revision) != 1:
    raise SystemExit('Old JVM migration revision marker missing')
main = main.replace(old_revision,
    "settings.generatedJvmArgs.includes('-Dbestiary.jvm.profile=551')", 1)

# Personal packs have separate directories and MUST NOT call Official services.
personal_start = main.index('async function startPersonalModpack(')
personal_end = main.index('async function accountSnapshot() {', personal_start)
personal = main[personal_start:personal_end]
if personal.count('    const settings = await settingsStore.load();') != 1:
    raise SystemExit('Personal settings load marker not unique')
personal = personal.replace(
    '    const settings = await settingsStore.load();',
    '    const settings = await settingsStore.load();\n'
    '    const personalMemory = planPersonalMemory(settings);',
    1
)
old_ram = 'memory: { minMb: settings.minRamMb, maxMb: settings.maxRamMb },'
if personal.count(old_ram) != 1:
    raise SystemExit('Personal heap marker not unique')
personal = personal.replace(
    old_ram, 'memory: { minMb: personalMemory.minMb, maxMb: personalMemory.maxMb },', 1
)
for forbidden in ('keybindPolicyService', 'officialLowEndOptionsService', 'bestiary-keybinds.json'):
    if forbidden in personal:
        raise SystemExit('Personal modpack must not inherit Official policy: ' + forbidden)
main = main[:personal_start] + personal + main[personal_end:]
main_path.write_text(main, encoding='utf-8')

# Reflect the actual constrained heap calculation in the Settings RAM slider.
settings_path = root / 'src/renderer/src/components/SettingsModal.tsx'
settings = settings_path.read_text(encoding='utf-8')
replacement_pairs = [
    ('Math.min(total * 0.80, total - 768, 3072)',
     'Math.min(total * 0.62, total - 1536, 2560)'),
    ('Math.min(total * 0.58, total - 1792, 3072)',
     'Math.min(total * 0.55, total - 2048, 3072)'),
    ('Math.min(total * 0.55, total - 2048, 4096)',
     'Math.min(total * 0.55, total - 3072, 4096)'),
    ('return Math.max(3072, Math.floor(budget / 256) * 256);',
     'return Math.max(1536, Math.floor(budget / 256) * 256);'),
    ('min={3072} max={Math.max(3072,maxSafeRamMb)}',
     'min={1536} max={Math.max(1536,maxSafeRamMb)}'),
    ('Math.max(3072,Math.min(settings.maxRamMb,maxSafeRamMb))',
     'Math.max(1536,Math.min(settings.maxRamMb,maxSafeRamMb))'),
]
for old, new in replacement_pairs:
    if settings.count(old) != 1:
        raise SystemExit('Settings UI RAM marker missing: ' + old)
    settings = settings.replace(old, new, 1)
settings = settings.replace(
    'Client luôn được cấp tối thiểu 3 GB heap cho Cobblemon/resource reload;',
    'Máy ít RAM được giữ thêm bộ nhớ cho Windows/iGPU; nếu thấp hơn mức Lite công bố sẽ cảnh báo;'
)
settings = settings.replace(
    'Đọc RAM, giữ tối thiểu 3 GB heap và tạo client JVM profile tối giản',
    'Đọc RAM, giữ bộ nhớ cho hệ điều hành và tạo client JVM profile tối giản'
)
settings_path.write_text(settings, encoding='utf-8')

final = main_path.read_text(encoding='utf-8')
assert final.count('await keybindPolicyService.apply();') == 2, 'Both Official launch paths must apply policy'
assert final.count('await officialLowEndOptionsService.apply(settings.clientProfile);') == 2, 'Both Official paths must apply Lite graphics'
assert 'memory: { minMb: personalMemory.minMb, maxMb: personalMemory.maxMb }' in final
assert 'bestiary.jvm.profile=551' in final
print('QUALITY PATCH PASS: Official-only keybind, first-apply policy, low-end and personal heap caps.')

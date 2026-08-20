from pathlib import Path
import re

root = Path('source')


def req(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(message)


bridge_path = root / 'src/main/core/OfficialLauncherBridge.ts'
bridge = bridge_path.read_text(encoding='utf-8')

old = "import fs from 'fs-extra';\n"
req(old in bridge, 'OfficialLauncherBridge import marker missing')
bridge = bridge.replace(old, old + "import type { LauncherSettings } from '../../shared/ipc';\n", 1)

old = "const PROFILE_NAME = 'Bestiary Rebirth';\n"
req(old in bridge, 'OfficialLauncherBridge profile marker missing')
bridge = bridge.replace(
    old,
    old + r"""
const DEFAULT_BRIDGE_JVM_ARGS = [
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=100',
  '-XX:+DisableExplicitGC',
  '-XX:+PerfDisableSharedMem',
  '-Dfile.encoding=UTF-8',
  '-Djava.awt.headless=false',
  '-Dlog4j2.formatMsgNoLookups=true',
] as const;

function validateRam(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 512 || value > 131_072) {
    throw new Error(`${label} không hợp lệ.`);
  }
  return value;
}

function jvmArgumentKey(argument: string): string {
  if (argument.startsWith('-D')) return argument.split('=', 1)[0];
  const xx = /^-XX:[+-]?([^=]+)(?:=.*)?$/u.exec(argument);
  if (xx) return `-XX:${xx[1]}`;
  return argument;
}

function quoteJavaArgument(argument: string): string {
  if (!/[\s"]/u.test(argument)) return argument;
  const escapedQuotes = argument.replace(/(\\*)"/gu, '$1$1\\"');
  const escapedTail = escapedQuotes.replace(/(\\+)$/u, '$1$1');
  return `"${escapedTail}"`;
}

export function buildOfficialLauncherJavaArgs(settings: LauncherSettings): string {
  const minRamMb = validateRam(settings.minRamMb, 'RAM tối thiểu');
  const maxRamMb = validateRam(settings.maxRamMb, 'RAM tối đa');
  if (maxRamMb < minRamMb) {
    throw new Error('RAM tối đa phải lớn hơn hoặc bằng RAM tối thiểu.');
  }

  const ordered = new Map<string, string>();
  for (const raw of [...DEFAULT_BRIDGE_JVM_ARGS, ...(settings.generatedJvmArgs ?? [])]) {
    if (typeof raw !== 'string') continue;
    const argument = raw.trim();
    if (!argument || argument.includes('\0') || argument.length > 4096) continue;
    if (/^-Xm[sx]/u.test(argument)) continue;
    ordered.set(jvmArgumentKey(argument), argument);
  }

  return [
    `-Xms${minRamMb}M`,
    `-Xmx${maxRamMb}M`,
    ...ordered.values(),
  ].map(quoteJavaArgument).join(' ');
}
""",
    1,
)

old = "  public async prepareAndOpen(profileId: string): Promise<void> {"
req(old in bridge, 'prepareAndOpen signature missing')
bridge = bridge.replace(old, "  public async prepareAndOpen(profileId: string, settings: LauncherSettings): Promise<void> {", 1)

old = "    await this.writeInstallation(profileId, officialRoot);"
req(old in bridge, 'writeInstallation call missing')
bridge = bridge.replace(old, "    await this.writeInstallation(profileId, officialRoot, settings);", 1)

old = "  private async writeInstallation(profileId: string, officialRoot: string): Promise<void> {"
req(old in bridge, 'writeInstallation signature missing')
bridge = bridge.replace(old, "  private async writeInstallation(profileId: string, officialRoot: string, settings: LauncherSettings): Promise<void> {", 1)

old = """    const previous: Record<string, unknown> = profiles[PROFILE_KEY] && typeof profiles[PROFILE_KEY] === 'object' ? profiles[PROFILE_KEY] : {};
    const now = new Date().toISOString();

    profiles[PROFILE_KEY] = {"""
req(old in bridge, 'installation profile marker missing')
bridge = bridge.replace(
    old,
    """    const previous: Record<string, unknown> = profiles[PROFILE_KEY] && typeof profiles[PROFILE_KEY] === 'object' ? profiles[PROFILE_KEY] : {};
    const now = new Date().toISOString();
    const javaArgs = buildOfficialLauncherJavaArgs(settings);

    profiles[PROFILE_KEY] = {""",
    1,
)

old = """      lastUsed: now,
      lastVersionId: profileId,
      name: PROFILE_NAME,"""
req(old in bridge, 'installation javaArgs insertion marker missing')
bridge = bridge.replace(
    old,
    """      lastUsed: now,
      lastVersionId: profileId,
      javaArgs,
      name: PROFILE_NAME,""",
    1,
)

bridge_path.write_text(bridge, encoding='utf-8')

main_path = root / 'src/main/index.ts'
main = main_path.read_text(encoding='utf-8')
old = '      await officialLauncherBridge.prepareAndOpen(profileId);'
req(old in main, 'Microsoft official launcher call missing')
main = main.replace(old, '      await officialLauncherBridge.prepareAndOpen(profileId, settings);', 1)
main_path.write_text(main, encoding='utf-8')

for rel in ['src/main/core/AccountService.ts', 'src/main/core/RemoteService.ts']:
    path = root / rel
    text = path.read_text(encoding='utf-8')
    text = re.sub(r'BestiaryLauncher/5\.3\.\d+', 'BestiaryLauncher/5.3.8', text)
    path.write_text(text, encoding='utf-8')

app_path = root / 'src/renderer/src/App.tsx'
app = app_path.read_text(encoding='utf-8')
app = re.sub(r"currentVersion:\s*'\d+\.\d+\.\d+'", "currentVersion: '5.3.8'", app, count=1)
req("currentVersion: '5.3.8'" in app, 'Unable to bump App version to 5.3.8')
app_path.write_text(app, encoding='utf-8')

print('Bestiary Launcher 5.3.8 Microsoft RAM/JVM bridge applied.')

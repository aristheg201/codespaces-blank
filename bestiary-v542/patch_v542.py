from pathlib import Path
import re

root = Path('source')


def req(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(message)


# 5.4.2 removes the last runtime ambiguity between the approved Microsoft
# Game Services path and the legacy Official Minecraft Launcher bridge.
# Production Microsoft sessions are direct-only. A remote/cache value is not
# allowed to silently force the account back into identity/bridge mode.
account_path = root / 'src/main/core/AccountService.ts'
account = account_path.read_text(encoding='utf-8')

req('microsoftDirectLaunchEnabled' in account, 'Microsoft direct-launch state missing')

# Force the class default to direct mode.
account, field_count = re.subn(
    r'(private\s+microsoftDirectLaunchEnabled\s*=\s*)(?:true|false)(\s*;)',
    r'\1true\2',
    account,
)
req(field_count >= 1, 'Microsoft direct-launch class field missing')

# Any runtime/config setter that attempts to assign this flag is pinned true.
# This is intentional for the Mojang-approved production AppID in 5.4.2.
assignment_pattern = re.compile(r'this\.microsoftDirectLaunchEnabled\s*=\s*[^;]+;')
assignments = assignment_pattern.findall(account)
req(assignments, 'Microsoft direct-launch runtime assignment missing')
account = assignment_pattern.sub('this.microsoftDirectLaunchEnabled = true;', account)

# Game scope is always requested for Microsoft login. Identity-only OIDC was
# only needed before the AppID had Java Edition Game Services approval.
scope_method = re.compile(
    r'  private microsoftScope\(\): string \{.*?\n  \}',
    re.S,
)
scope_match = scope_method.search(account)
req(scope_match is not None, 'microsoftScope() method missing')
account = account[:scope_match.start()] + """  private microsoftScope(): string {
    return MS_GAME_SCOPE;
  }""" + account[scope_match.end():]

# Direct authorization must never disappear because a stale remote/cached flag
# says false. Remove the old bridge-era early return.
account = account.replace('    if (!this.microsoftDirectLaunchEnabled) return null;\n', '')
account = account.replace('    if (!this.microsoftDirectLaunchEnabled) return null;\r\n', '')
req('if (!this.microsoftDirectLaunchEnabled) return null;' not in account,
    'Bridge-era direct authorization guard still exists')

# Microsoft Play never chooses OfficialLauncherBridge in production 5.4.2.
method = re.compile(
    r"  public shouldUseOfficialLauncher\(\): boolean \{\s*.*?\s*  \}",
    re.S,
)
match = method.search(account)
req(match is not None, 'AccountService shouldUseOfficialLauncher() method missing')
account = account[:match.start()] + """  public shouldUseOfficialLauncher(): boolean {
    return false;
  }""" + account[match.end():]

req("MS_GAME_SCOPE = 'XboxLive.signin offline_access'" in account,
    'XboxLive game scope missing')
req('exchangeMinecraft(response.access_token)' in account,
    'Minecraft Services exchange path missing')
req('entitlements/mcstore' in account,
    'Minecraft Java entitlement check missing')
req('minecraft/profile' in account,
    'Minecraft profile lookup missing')
account = re.sub(r'BestiaryLauncher/5\.4\.[01]', 'BestiaryLauncher/5.4.2', account)
account_path.write_text(account, encoding='utf-8')

# Even if another call-site accidentally reaches the old bridge, it must fail
# visibly instead of launching the official Minecraft Launcher. An explicit
# environment escape hatch exists for emergency diagnostics only.
bridge_path = root / 'src/main/core/OfficialLauncherBridge.ts'
bridge = bridge_path.read_text(encoding='utf-8')
signature = '  public async prepareAndOpen(profileId: string, settings: LauncherSettings): Promise<void> {'
req(signature in bridge, 'OfficialLauncherBridge.prepareAndOpen signature missing')
bridge_guard = """  public async prepareAndOpen(profileId: string, settings: LauncherSettings): Promise<void> {
    if (process.env.BESTIARY_ALLOW_OFFICIAL_LAUNCHER_BRIDGE !== '1') {
      throw new Error('Official Minecraft Launcher bridge is disabled in Bestiary Launcher 5.4.2.');
    }"""
bridge = bridge.replace(signature, bridge_guard, 1)
bridge_path.write_text(bridge, encoding='utf-8')

# Pin the local production default too. AccountService remains authoritative.
main_path = root / 'src/main/index.ts'
main = main_path.read_text(encoding='utf-8')
main = main.replace('microsoftDirectLaunch: false', 'microsoftDirectLaunch: true')
req('microsoftDirectLaunch: true' in main, 'Main-process direct Microsoft default missing')
req('accountService.getLaunchAuthorization(settings.username)' in main,
    'Direct launch authorization call missing from main process')
req('authorization: authorization ?? undefined' in main,
    'Minecraft launcher request does not receive Microsoft authorization')
req('officialLauncherBridge.prepareAndOpen' in main,
    'Expected legacy bridge call-site missing; guard audit cannot run')
main_path.write_text(main, encoding='utf-8')

remote_path = root / 'src/main/core/RemoteService.ts'
remote = remote_path.read_text(encoding='utf-8')
remote = re.sub(r'BestiaryLauncher/5\.4\.[01]', 'BestiaryLauncher/5.4.2', remote)
remote_path.write_text(remote, encoding='utf-8')

app_path = root / 'src/renderer/src/App.tsx'
app = app_path.read_text(encoding='utf-8')
app = re.sub(r"currentVersion:\s*'5\.4\.[01]'", "currentVersion: '5.4.2'", app, count=1)
req("currentVersion: '5.4.2'" in app, 'Unable to bump App version to 5.4.2')
app_path.write_text(app, encoding='utf-8')

home_path = root / 'src/renderer/src/components/Home.tsx'
home = home_path.read_text(encoding='utf-8')
home = home.replace('5.4.1', '5.4.2').replace('5.4.0', '5.4.2')
home_path.write_text(home, encoding='utf-8')

# Final source-level regression probes.
account_check = account_path.read_text(encoding='utf-8')
bridge_check = bridge_path.read_text(encoding='utf-8')
req("public shouldUseOfficialLauncher(): boolean {\n    return false;\n  }" in account_check,
    'Official Launcher route is not disabled for Microsoft production sessions')
req('return MS_GAME_SCOPE;' in account_check,
    'Microsoft login can still fall back to identity-only scope')
req('microsoftDirectLaunchEnabled = false' not in account_check,
    'AccountService can still initialize direct Microsoft mode as false')
req("BESTIARY_ALLOW_OFFICIAL_LAUNCHER_BRIDGE !== '1'" in bridge_check,
    'Official Launcher bridge fail-closed guard missing')

print('Bestiary Launcher 5.4.2 forced direct Microsoft runtime patch applied.')

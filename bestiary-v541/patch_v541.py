from pathlib import Path
import re

root = Path('source')


def req(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(message)

# 5.4.0 enabled Game Services but inherited bridge routing from 5.3.x.
# In 5.4.1 the official launcher is only a fallback when the remote/local
# direct-launch switch is explicitly disabled. Microsoft accounts must launch
# the Java process directly when Game Services are enabled.
account_path = root / 'src/main/core/AccountService.ts'
account = account_path.read_text(encoding='utf-8')

method = re.compile(
    r"  public shouldUseOfficialLauncher\(\): boolean \{\s*.*?\s*  \}",
    re.S,
)
match = method.search(account)
req(match is not None, 'AccountService shouldUseOfficialLauncher() method missing')

replacement = """  public shouldUseOfficialLauncher(): boolean {
    return this.current.mode === 'microsoft' && !this.microsoftDirectLaunchEnabled;
  }"""
account = account[:match.start()] + replacement + account[match.end():]

# Direct Microsoft authorization must remain live when the bridge is disabled.
req("if (!this.microsoftDirectLaunchEnabled) return null;" in account,
    'Direct Microsoft launch authorization guard missing')
req("MS_GAME_SCOPE = 'XboxLive.signin offline_access'" in account,
    'XboxLive game scope missing')
req('entitlements/mcstore' in account, 'Minecraft entitlement check missing')
req('minecraft/profile' in account, 'Minecraft profile lookup missing')

account = re.sub(r'BestiaryLauncher/5\.4\.0', 'BestiaryLauncher/5.4.1', account)
account_path.write_text(account, encoding='utf-8')

remote_path = root / 'src/main/core/RemoteService.ts'
remote = remote_path.read_text(encoding='utf-8')
remote = re.sub(r'BestiaryLauncher/5\.4\.0', 'BestiaryLauncher/5.4.1', remote)
remote_path.write_text(remote, encoding='utf-8')

app_path = root / 'src/renderer/src/App.tsx'
app = app_path.read_text(encoding='utf-8')
app = re.sub(r"currentVersion:\s*'5\.4\.0'", "currentVersion: '5.4.1'", app, count=1)
req("currentVersion: '5.4.1'" in app, 'Unable to bump App version to 5.4.1')
app_path.write_text(app, encoding='utf-8')

home_path = root / 'src/renderer/src/components/Home.tsx'
home = home_path.read_text(encoding='utf-8').replace('5.4.0', '5.4.1')
home_path.write_text(home, encoding='utf-8')

# Contract probe: this exact condition is the regression fix. If it changes,
# the build must fail instead of silently routing Microsoft back to Mojang's launcher.
account_check = account_path.read_text(encoding='utf-8')
req("return this.current.mode === 'microsoft' && !this.microsoftDirectLaunchEnabled;" in account_check,
    'Official Launcher fallback is not gated by direct-launch=false')

print('Bestiary Launcher 5.4.1 direct Microsoft routing fix applied.')

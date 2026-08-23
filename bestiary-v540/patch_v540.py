from pathlib import Path
import re

root = Path('source')


def req(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(message)

# 5.4.0 is the first launcher build after Mojang approved the Bestiary
# Microsoft Application ID for Java Edition Game Services. Keep the remote
# kill-switch, but make direct Microsoft/Minecraft authentication the local
# production default instead of the Official Launcher bridge fallback.
main_path = root / 'src/main/index.ts'
main = main_path.read_text(encoding='utf-8')
req('microsoftDirectLaunch:' in main, 'Microsoft direct-launch runtime flag missing')
main = main.replace('microsoftDirectLaunch: false', 'microsoftDirectLaunch: true')
req('microsoftDirectLaunch: true' in main, 'Unable to enable approved Microsoft direct launch by default')
main_path.write_text(main, encoding='utf-8')

account_path = root / 'src/main/core/AccountService.ts'
account = account_path.read_text(encoding='utf-8')
req("MS_GAME_SCOPE = 'XboxLive.signin offline_access'" in account, 'Approved XboxLive scope missing')
req('exchangeMinecraft(response.access_token)' in account, 'Minecraft token exchange path missing')
req('entitlements/mcstore' in account, 'Minecraft Java entitlement verification missing')
req('minecraft/profile' in account, 'Minecraft profile lookup missing')
req('microsoftDirectLaunchEnabled' in account, 'Microsoft direct-launch strategy missing')
account = re.sub(r'BestiaryLauncher/5\.3\.\d+', 'BestiaryLauncher/5.4.0', account)
account_path.write_text(account, encoding='utf-8')

remote_path = root / 'src/main/core/RemoteService.ts'
remote = remote_path.read_text(encoding='utf-8')
req('microsoftDirectLaunch' in remote, 'Remote Microsoft direct-launch kill-switch missing')
remote = re.sub(r'BestiaryLauncher/5\.3\.\d+', 'BestiaryLauncher/5.4.0', remote)
remote_path.write_text(remote, encoding='utf-8')

app_path = root / 'src/renderer/src/App.tsx'
app = app_path.read_text(encoding='utf-8')
app = re.sub(r"currentVersion:\s*'\d+\.\d+\.\d+'", "currentVersion: '5.4.0'", app, count=1)
req("currentVersion: '5.4.0'" in app, 'Unable to bump launcher UI version to 5.4.0')
app_path.write_text(app, encoding='utf-8')

home_path = root / 'src/renderer/src/components/Home.tsx'
home = home_path.read_text(encoding='utf-8')
home = re.sub(r'5\.3\.\d+', '5.4.0', home)
home_path.write_text(home, encoding='utf-8')

print('Bestiary Launcher 5.4.0 approved Microsoft Game Services patch applied.')

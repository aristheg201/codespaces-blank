from pathlib import Path
import re

root = Path('source')
main_path = root / 'src/main/index.ts'
main = main_path.read_text(encoding='utf-8')

marker = "    registerIpc();\n    createWindow();"
if marker not in main:
    raise SystemExit('Launcher startup window marker missing')

if 'BESTIARY_LAUNCHER_STARTUP_AUTO_UPDATE_V547' not in main:
    main = main.replace(
        marker,
        marker + "\n    // BESTIARY_LAUNCHER_STARTUP_AUTO_UPDATE_V547\n    setTimeout(() => { void appUpdater?.checkAndDownload(); }, 1200);",
        1,
    )

main_path.write_text(main, encoding='utf-8')

app_path = root / 'src/renderer/src/App.tsx'
app = app_path.read_text(encoding='utf-8')
app = re.sub(r"currentVersion:\s*'5\.4\.6'", "currentVersion: '5.4.7'", app, count=1)
if "currentVersion: '5.4.7'" not in app:
    raise SystemExit('Unable to bump App version to 5.4.7')
app_path.write_text(app, encoding='utf-8')

home_path = root / 'src/renderer/src/components/Home.tsx'
home = home_path.read_text(encoding='utf-8').replace('5.4.6', '5.4.7')
home_path.write_text(home, encoding='utf-8')

for rel in ['src/main/core/AccountService.ts', 'src/main/core/RemoteService.ts']:
    p = root / rel
    text = p.read_text(encoding='utf-8').replace('BestiaryLauncher/5.4.6', 'BestiaryLauncher/5.4.7')
    if 'BestiaryLauncher/5.4.7' not in text:
        raise SystemExit('Unable to bump ' + rel)
    p.write_text(text, encoding='utf-8')

check = main_path.read_text(encoding='utf-8')
if 'BESTIARY_LAUNCHER_STARTUP_AUTO_UPDATE_V547' not in check:
    raise SystemExit('Startup auto updater marker missing')
if "setTimeout(() => { void appUpdater?.checkAndDownload(); }, 1200);" not in check:
    raise SystemExit('Startup auto update call missing')

print('Bestiary Launcher 5.4.7 startup auto-update patch applied.')

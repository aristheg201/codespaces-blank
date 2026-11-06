from pathlib import Path
import shutil
import re

root = Path('source')

for dst, src in [
  ('src/renderer/src/components/ModpacksScreen.tsx','bestiary-v549/ModpacksScreen.tsx'),
  ('src/renderer/src/components/ModpacksScreen.css','bestiary-v549/ModpacksScreen.css'),
]:
    target=root/dst
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(src,target)

ui=(root/'src/renderer/src/components/ModpacksScreen.tsx').read_text(encoding='utf-8')
for forbidden in ('window.prompt(', 'window.confirm('):
    if forbidden in ui:
        raise SystemExit('Electron-unsupported modal call survived: ' + forbidden)
required=('role="dialog"', 'aria-modal="true"', 'onSubmit=', 'createModpack(name)', 'renameModpack(', 'removeModpack(', 'exportModpackZip(', 'openCreate', 'setDialog({ kind: \'create\'')
if not all(x in ui for x in required):
    raise SystemExit('Personal modpack modal/CRUD contract incomplete.')
if '<button disabled={busy || dialog !== null} className="primary" onClick={openCreate}>' not in ui:
    raise SystemExit('Create button must open the in-app dialog directly.')

app_path=root/'src/renderer/src/App.tsx'
app=app_path.read_text(encoding='utf-8')
if "currentVersion: '5.4.8'" not in app:
    raise SystemExit('Expected v5.4.8 renderer base is missing.')
app=app.replace("currentVersion: '5.4.8'", "currentVersion: '5.4.9'",1)
app_path.write_text(app,encoding='utf-8')

home_path=root/'src/renderer/src/components/Home.tsx'
home=home_path.read_text(encoding='utf-8').replace('5.4.8','5.4.9')
home_path.write_text(home,encoding='utf-8')

for relative in ('src/main/core/AccountService.ts','src/main/core/RemoteService.ts'):
    p=root/relative
    s=p.read_text(encoding='utf-8')
    s=s.replace('BestiaryLauncher/5.4.8','BestiaryLauncher/5.4.9')
    p.write_text(s,encoding='utf-8')

print('Bestiary Launcher 5.4.9: Create/Rename/Delete/Export use React modals instead of unsupported Electron prompt/confirm.')

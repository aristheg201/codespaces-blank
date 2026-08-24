from pathlib import Path
import re

root = Path('source')

def req(ok, msg):
    if not ok:
        raise SystemExit(msg)

# 5.3.2: account/config screens must not trust an old currentRemote forever.
p = root / 'src/main/index.ts'
s = p.read_text(encoding='utf-8')

old = "const remote = await withTimeout(RemoteService.fetchReleaseInfo(), 5_000, currentRemote ?? fallbackRemote());"
req(old in s, 'getRemote timeout marker missing')
s = s.replace(old, "const remote = await withTimeout(RemoteService.fetchReleaseInfo(), 12_000, currentRemote ?? fallbackRemote());", 1)

old = "async function accountSnapshot() {\n  const settings = await settingsStore.load();\n  const remote = currentRemote ?? (await getRemote());"
req(old in s, 'accountSnapshot cached remote marker missing')
s = s.replace(old, "async function accountSnapshot() {\n  const settings = await settingsStore.load();\n  // Always refresh distribution config when the account screen asks for state.\n  // This lets a newly-published Microsoft Client ID become usable without restarting Launcher.\n  const remote = await getRemote();", 1)

old = "  ipcMain.handle('bestiary:account-login-microsoft', async () => {\n    const remote = currentRemote ?? (await getRemote());"
req(old in s, 'Microsoft login cached remote marker missing')
s = s.replace(old, "  ipcMain.handle('bestiary:account-login-microsoft', async () => {\n    const remote = await getRemote();", 1)

p.write_text(s, encoding='utf-8')

# Refresh Home snapshot after returning from Account so REMOTE/version metadata
# shown on Home catches up with the same fresh distribution state.
p = root / 'src/renderer/src/App.tsx'
s = p.read_text(encoding='utf-8')
old = "if (screen === 'account') return <><AccountScreen onBack={() => { void window.bestiary.getAccounts().then(setAccount); setScreen('home'); }}"
req(old in s, 'AccountScreen onBack marker missing')
new = "if (screen === 'account') return <><AccountScreen onBack={() => { void window.bestiary.getAccounts().then(setAccount); void window.bestiary.getSnapshot().then(store.setSnapshot); setScreen('home'); }}"
s = s.replace(old, new, 1)
s = re.sub(r"currentVersion:\s*'\d+\.\d+\.\d+'", "currentVersion: '5.3.2'", s, count=1)
req("currentVersion: '5.3.2'" in s, 'Unable to bump App version to 5.3.2')
p.write_text(s, encoding='utf-8')

# Keep visible/runtime UA metadata aligned.
for rel in [
    'src/renderer/src/components/Home.tsx',
    'src/main/core/RemoteService.ts',
    'src/main/core/AccountService.ts',
]:
    p = root / rel
    text = p.read_text(encoding='utf-8')
    text = text.replace('5.3.1', '5.3.2').replace('5.3.0', '5.3.2')
    if rel.endswith('Home.tsx') and '5.3.2' not in text:
        text += '\n// Bestiary Launcher 5.3.2 fresh distribution config hotfix\n'
    p.write_text(text, encoding='utf-8')

print('Bestiary Launcher 5.3.2 fresh remote/account configuration hotfix applied.')

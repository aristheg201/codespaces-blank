from pathlib import Path

root = Path('source')

def req(ok, msg):
    if not ok:
        raise SystemExit(msg)

# Backend already knows when the child process closes. Forward that lifecycle
# change into the existing progress channel so the renderer can refresh its
# authoritative snapshot instead of keeping the spawn-time state forever.
p = root / 'src/main/index.ts'
s = p.read_text(encoding='utf-8')
marker = "minecraftLauncher.onEvent((event) => {\n"
req(marker in s, 'Minecraft launcher event marker missing')
insert = """minecraftLauncher.onEvent((event) => {\n  if (event.type === 'state' && event.state === 'stopped') {\n    endLaunchHeartbeat();\n    sendProgress({\n      stage: 'idle',\n      percent: 0,\n      title: 'Sẵn sàng',\n      detail: 'Minecraft đã đóng.',\n      speedMBps: 0,\n      etaSeconds: null,\n    });\n  }\n  if (event.type === 'exit') {\n    sendLog({ level: 'debug', message: `Minecraft exited (code=${event.code ?? 'null'}, signal=${event.signal ?? 'none'}).` });\n  }\n"""
s = s.replace(marker, insert, 1)
p.write_text(s, encoding='utf-8')

# Refresh the snapshot when the backend reports that Minecraft stopped.
# This clears snapshot.launching immediately without polling.
p = root / 'src/renderer/src/App.tsx'
s = p.read_text(encoding='utf-8')
old = "    const offProgress = window.bestiary.onProgress(store.setProgress);"
req(old in s, 'App progress subscription marker missing')
new = """    const offProgress = window.bestiary.onProgress((event) => {\n      store.setProgress(event);\n      if (event.stage === 'idle') {\n        void window.bestiary.getSnapshot().then((snapshot) => {\n          if (mounted) store.setSnapshot(snapshot);\n        }).catch((error) => {\n          if (mounted) store.addLog({ level: 'error', message: `Không thể làm mới trạng thái Launcher: ${String(error)}` });\n        });\n      }\n    });"""
s = s.replace(old, new, 1)
s = s.replace("currentVersion: '5.3.0'", "currentVersion: '5.3.1'")
p.write_text(s, encoding='utf-8')

# Keep visible/runtime user-agent version metadata aligned with the hotfix.
for rel in [
    'src/renderer/src/components/Home.tsx',
    'src/main/core/RemoteService.ts',
    'src/main/core/AccountService.ts',
]:
    p = root / rel
    s = p.read_text(encoding='utf-8').replace('5.3.0', '5.3.1')
    p.write_text(s, encoding='utf-8')

print('Bestiary Launcher 5.3.1 Minecraft lifecycle state hotfix applied.')

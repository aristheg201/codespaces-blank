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

# Make update checks resilient to stale GitHub/raw CDN objects. Never weaken
# SHA validation: cache-bust the metadata and asset URL, then retry once with a
# fresh timestamp if the downloaded bytes do not match the published digest.
p = root / 'src/main/core/AppUpdater.ts'
s = p.read_text(encoding='utf-8')
old = "      const channel = JSON.parse((await getBuffer(CHANNEL_URL)).toString('utf8')) as UpdateChannel;"
req(old in s, 'Updater channel request marker missing')
s = s.replace(old, "      const channelUrl = `${CHANNEL_URL}?bestiary=${Date.now()}`;\n      const channel = JSON.parse((await getBuffer(channelUrl)).toString('utf8')) as UpdateChannel;", 1)
old = "      const data = await getBuffer(record.installerUrl, 0, (current, total) => {\n        const pct = total > 0 ? Math.min(99, Math.floor((current / total) * 100)) : this.state.progress;\n        if (pct !== this.state.progress) this.set({ progress: pct });\n      });\n      const actual = crypto.createHash('sha256').update(data).digest('hex').toLowerCase();\n      if (actual !== record.sha256.toLowerCase()) throw new Error('SHA-256 của bản cập nhật không khớp. Đã hủy cài đặt.');\n      await fs.writeFile(part, data);"
req(old in s, 'Updater installer download marker missing')
new = """      const progress = (current: number, total: number) => {\n        const pct = total > 0 ? Math.min(99, Math.floor((current / total) * 100)) : this.state.progress;\n        if (pct !== this.state.progress) this.set({ progress: pct });\n      };\n      const makeDownloadUrl = (nonce: string) => {\n        const url = new URL(record.installerUrl);\n        url.searchParams.set('bestiary_sha', record.sha256.slice(0, 16));\n        url.searchParams.set('bestiary_nonce', nonce);\n        return url.toString();\n      };\n      let data = await getBuffer(makeDownloadUrl('primary'), 0, progress);\n      let actual = crypto.createHash('sha256').update(data).digest('hex').toLowerCase();\n      if (actual !== record.sha256.toLowerCase()) {\n        this.set({ progress: 0, message: `Byte tải về không khớp SHA. Đang tải lại ${record.version} từ CDN mới...` });\n        data = await getBuffer(makeDownloadUrl(String(Date.now())), 0, progress);\n        actual = crypto.createHash('sha256').update(data).digest('hex').toLowerCase();\n      }\n      if (actual !== record.sha256.toLowerCase()) {\n        throw new Error(`SHA-256 của bản cập nhật không khớp sau khi tải lại. Expected ${record.sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}….`);\n      }\n      await fs.writeFile(part, data);"""
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

# Keep visible/runtime user-agent version metadata aligned with the hotfix.
for rel in [
    'src/renderer/src/components/Home.tsx',
    'src/main/core/RemoteService.ts',
    'src/main/core/AccountService.ts',
]:
    p = root / rel
    s = p.read_text(encoding='utf-8').replace('5.3.0', '5.3.1')
    if rel.endswith('Home.tsx') and '5.3.1' not in s:
        s += '\n// Bestiary Launcher 5.3.1 lifecycle hotfix\n'
    p.write_text(s, encoding='utf-8')

print('Bestiary Launcher 5.3.1 Minecraft lifecycle and updater cache hotfix applied.')

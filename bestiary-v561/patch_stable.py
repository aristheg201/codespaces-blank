from pathlib import Path
import hashlib
import json

root=Path('source')
auth=root/'src/main/core/AccountService.ts'
preload=root/'src/preload/index.ts'
main=root/'src/main/index.ts'
auth_hash=hashlib.sha256(auth.read_bytes()).hexdigest()
preload_hash=hashlib.sha256(preload.read_bytes()).hexdigest()

for relative in ('src/renderer/src/App.tsx','src/renderer/src/components/Home.tsx'):
    p=root/relative
    data=p.read_text(encoding='utf8')
    before='5.6.1-alpha.1'
    if before not in data: raise SystemExit('Missing 5.6.1 alpha marker: '+relative)
    p.write_text(data.replace(before,'5.6.1'),encoding='utf8')
for relative in ('src/main/core/AccountService.ts','src/main/core/RemoteService.ts',
                 'src/main/core/LoaderCatalog.ts'):
    p=root/relative
    content=p.read_text(encoding='utf8')
    p.write_text(content.replace('BestiaryLauncher/5.6.0-alpha.1','BestiaryLauncher/5.6.1')
                 .replace('BestiaryLauncher/5.5.1','BestiaryLauncher/5.6.1'),encoding='utf8')
# A version-only User-Agent literal may change. Never edit account methods,
# saved login modes, encrypted token paths, OAuth device flow or IPC routing.
account=auth.read_text(encoding='utf8')
for token in (
    "mode: 'offline' | 'microsoft'",
    'public async selectMode(',
    'public async loginMicrosoft(',
    'public async getLaunchAuthorization(',
    'private async acquireMicrosoftToken(',
    'private async loginMicrosoftInternal(',
    'this.tokenPath = path.join(dataRoot,',
):
    assert token in account, 'Existing auth method missing: '+token
assert "if (this.current.mode !== 'microsoft') return null;" in account
assert "if (mode === 'microsoft' && !this.current.microsoft)" in account
assert "accountService.getLaunchAuthorization(settings.username)" in main.read_text(encoding='utf8')
for token in ('loginMicrosoft:', 'logoutMicrosoft:', 'getAccounts:', 'setAccountMode:'):
    assert token in preload.read_text(encoding='utf8')
# Stable updater stays pinned to production until separately published after CI.
assert (root/'src/renderer/src/App.tsx').read_text(encoding='utf8').count("currentVersion: '5.6.1'")==1
print(json.dumps({'release':'5.6.1','auth_source_sha256':hashlib.sha256(auth.read_bytes()).hexdigest(),
      'account_version_header_only': auth_hash != hashlib.sha256(auth.read_bytes()).hexdigest(),
      'preload_sha256_unchanged':preload_hash==hashlib.sha256(preload.read_bytes()).hexdigest(),
      'account_flow':'existing Local/Offline + Microsoft OAuth unchanged'}))

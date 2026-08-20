from pathlib import Path
import shutil, re

root=Path('source')
def req(ok,msg):
    if not ok: raise SystemExit(msg)

def cp(src,dst):
    target=root/dst
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(src,target)

cp('bestiary-v530/fixes/ipc.ts','src/shared/ipc.ts')
cp('bestiary-v530/fixes/preload-index.ts','src/preload/index.ts')
cp('bestiary-v530/fixes/AccountService.ts','src/main/core/AccountService.ts')
cp('bestiary-v530/fixes/AccountScreen.tsx','src/renderer/src/components/AccountScreen.tsx')
cp('bestiary-v530/fixes/AccountScreen.css','src/renderer/src/components/AccountScreen.css')

p=root/'src/main/core/Launcher.ts'
s=p.read_text(encoding='utf-8')
if "import type { MinecraftAuthorization } from '../../shared/ipc';" not in s:
    marker="import { Client } from 'minecraft-launcher-core';"
    req(marker in s,'Launcher import marker missing')
    s=s.replace(marker, marker+"\nimport type { MinecraftAuthorization } from '../../shared/ipc';",1)
marker='  timeoutMs?: number;\n}'
req(marker in s,'LaunchRequest marker missing')
s=s.replace(marker,'  timeoutMs?: number;\n  authorization?: MinecraftAuthorization;\n}',1)
s=s.replace('  authorization: OfflineAuthorization;','  authorization: OfflineAuthorization | MinecraftAuthorization;',1)
old='      const authorization = this.createOfflineAuthorization(normalized.username);'
req(old in s,'offline authorization marker missing')
s=s.replace(old,'      const authorization = normalized.authorization ?? this.createOfflineAuthorization(normalized.username);',1)
old='  private async validateAndNormalizeRequest(request: LaunchRequest): Promise<LaunchRequest> {\n    this.validateUsername(request.username);'
req(old in s,'Launcher validation marker missing')
s=s.replace(old,"  private async validateAndNormalizeRequest(request: LaunchRequest): Promise<LaunchRequest> {\n    const effectiveUsername = request.authorization?.name ?? request.username;\n    this.validateUsername(effectiveUsername);\n    if (request.authorization) {\n      if (!request.authorization.access_token || !/^[0-9a-f]{32}$/iu.test(request.authorization.uuid.replace(/-/gu, ''))) {\n        throw new Error('Microsoft authorization profile is invalid.');\n      }\n    }",1)
s=s.replace('      username: request.username.trim(),','      username: effectiveUsername.trim(),',1)
p.write_text(s,encoding='utf-8')

p=root/'src/main/core/RemoteService.ts'
s=p.read_text(encoding='utf-8')
marker='  defaultFabricLoader?: string;\n}'
req(marker in s,'RemoteConfig marker missing')
s=s.replace(marker,'  defaultFabricLoader?: string;\n  microsoftClientId?: string;\n}',1)
marker='      serverPort:\n        Number.isInteger(config.serverPort) && Number(config.serverPort) >= 1 && Number(config.serverPort) <= 65535\n          ? Number(config.serverPort)\n          : DEFAULT_SERVER_PORT,\n      profiles,'
req(marker in s,'Remote return server marker missing')
insert='''      serverPort:\n        Number.isInteger(config.serverPort) && Number(config.serverPort) >= 1 && Number(config.serverPort) <= 65535\n          ? Number(config.serverPort)\n          : DEFAULT_SERVER_PORT,\n      microsoftClientId:\n        typeof config.microsoftClientId === 'string' && /^[0-9a-f-]{20,64}$/iu.test(config.microsoftClientId.trim())\n          ? config.microsoftClientId.trim()\n          : '',\n      profiles,'''
s=s.replace(marker,insert,1)
s=re.sub(r"'User-Agent': 'BestiaryLauncher/[^']+'", "'User-Agent': 'BestiaryLauncher/5.3.0'", s)
p.write_text(s,encoding='utf-8')

p=root/'src/main/index.ts'
s=p.read_text(encoding='utf-8')
s=s.replace('  LibraryKind,\n} from \'../shared/ipc\';', "  LibraryKind,\n  AccountMode,\n  SkinSetRequest,\n} from '../shared/ipc';",1)
marker="import { ContentManager } from './core/ContentManager';"
req(marker in s,'ContentManager import marker missing')
if "./core/AccountService" not in s:
    s=s.replace(marker,marker+"\nimport { AccountService } from './core/AccountService';",1)
marker='const contentManager = new ContentManager(gameDirectory, ownershipFilePath);'
req(marker in s,'contentManager instance marker missing')
if 'const accountService = new AccountService' not in s:
    s=s.replace(marker,marker+"\nconst accountService = new AccountService(dataRoot, gameDirectory, (event) => {\n  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('bestiary:auth-status', event);\n});",1)
marker="    serverPort: 25565,\n    profiles: ["
req(marker in s,'fallback remote marker missing')
s=s.replace(marker,"    serverPort: 25565,\n    microsoftClientId: '',\n    profiles: [",1)
old='  currentRemote = remote;\n  return remote;'
req(old in s,'getRemote return marker missing')
s=s.replace(old,"  currentRemote = remote;\n  accountService.setMicrosoftClientId(remote.microsoftClientId);\n  return remote;",1)
old='    const remote = await RemoteService.fetchReleaseInfo();\n    currentRemote = remote;'
req(old in s,'startGame remote marker missing')
s=s.replace(old,"    const remote = await RemoteService.fetchReleaseInfo();\n    currentRemote = remote;\n    accountService.setMicrosoftClientId(remote.microsoftClientId);",1)
marker='''    const profileId = await FabricInstaller.ensureProfile(\n      gameDirectory,\n      remote.minecraftVersion,\n      remote.fabricLoader,\n    );\n\n    launchProgressPercent = 90;'''
req(marker in s,'Fabric profile marker missing')
s=s.replace(marker,'''    const profileId = await FabricInstaller.ensureProfile(\n      gameDirectory,\n      remote.minecraftVersion,\n      remote.fabricLoader,\n    );\n\n    const authorization = await accountService.getLaunchAuthorization(settings.username);\n\n    launchProgressPercent = 90;''',1)
old='''    await minecraftLauncher.launch({\n      username: settings.username,'''
req(old in s,'minecraft launch marker missing')
s=s.replace(old,'''    await minecraftLauncher.launch({\n      username: authorization?.name ?? settings.username,\n      authorization: authorization ?? undefined,''',1)
marker='function registerIpc(): void {'
req(marker in s,'registerIpc marker missing')
helper='''async function accountSnapshot() {\n  const settings = await settingsStore.load();\n  const remote = currentRemote ?? (await getRemote());\n  accountService.setMicrosoftClientId(remote.microsoftClientId);\n  return accountService.snapshot(settings.username);\n}\n\n'''
s=s.replace(marker,helper+marker,1)
window_marker="  ipcMain.handle('bestiary:window-minimize', () => mainWindow?.minimize());"
req(window_marker in s,'window IPC marker missing')
handlers='''  ipcMain.handle('bestiary:account-get', () => accountSnapshot());\n  ipcMain.handle('bestiary:account-mode', async (_event, mode: AccountMode) => {\n    if (mode !== 'offline' && mode !== 'microsoft') throw new Error('Account mode không hợp lệ.');\n    await accountService.selectMode(mode);\n    return accountSnapshot();\n  });\n  ipcMain.handle('bestiary:account-login-microsoft', async () => {\n    const remote = currentRemote ?? (await getRemote());\n    accountService.setMicrosoftClientId(remote.microsoftClientId);\n    await accountService.loginMicrosoft();\n    return accountSnapshot();\n  });\n  ipcMain.handle('bestiary:account-logout-microsoft', async () => {\n    await accountService.logoutMicrosoft();\n    return accountSnapshot();\n  });\n  ipcMain.handle('bestiary:skin-choose', async () => {\n    const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Minecraft Skin PNG', extensions: ['png'] }] });\n    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];\n  });\n  ipcMain.handle('bestiary:skin-set', async (_event, request: SkinSetRequest) => {\n    if (!request || typeof request.path !== 'string' || (request.variant !== 'classic' && request.variant !== 'slim')) throw new Error('Skin request không hợp lệ.');\n    await accountService.setSkin(request.path, request.variant);\n    return accountSnapshot();\n  });\n  ipcMain.handle('bestiary:skin-reset', async () => {\n    await accountService.resetSkin();\n    return accountSnapshot();\n  });\n'''
s=s.replace(window_marker,handlers+window_marker,1)
when_re=re.compile(r"(app\.setAppUserModelId\('vn\.bestiary\.launcher'\);\n\s*await fs\.ensureDir\(dataRoot\);\n\s*await fs\.ensureDir\(gameDirectory\);)")
m=when_re.search(s)
req(m is not None,'whenReady initialization marker missing')
init=m.group(1)+"\n    await accountService.initialize();\n    try {\n      await accountService.installClientBridge(path.join(process.resourcesPath, 'bestiary-skin-bridge-1.0.0.jar'));\n    } catch (error) {\n      sendLog({ level: 'error', message: `Skin Bridge install skipped: ${error instanceof Error ? error.message : String(error)}` });\n    }"
s=s[:m.start()]+init+s[m.end():]
p.write_text(s,encoding='utf-8')

p=root/'src/renderer/src/App.tsx'
s=p.read_text(encoding='utf-8')
marker="import { ContentScreen } from './components/ContentScreen';"
req(marker in s,'App ContentScreen import marker missing')
s=s.replace(marker,marker+"\nimport { AccountScreen } from './components/AccountScreen';",1)
s=s.replace("import type { AppUpdateState, ClientProfileId, LauncherSettings } from '../../shared/ipc';", "import type { AccountSnapshot, AppUpdateState, ClientProfileId, LauncherSettings } from '../../shared/ipc';",1)
s=s.replace("type Screen = 'home' | 'content';", "type Screen = 'home' | 'content' | 'account';",1)
s=s.replace("currentVersion: '5.2.0'", "currentVersion: '5.3.0'")
marker="  const [update, setUpdate] = useState<AppUpdateState>(INITIAL_UPDATE);"
req(marker in s,'App update state marker missing')
s=s.replace(marker,marker+"\n  const [account, setAccount] = useState<AccountSnapshot | null>(null);",1)
marker='    void window.bestiary.getAppUpdate().then((state) => mounted && setUpdate(state));'
req(marker in s,'App updater fetch marker missing')
s=s.replace(marker,"    void window.bestiary.getAccounts().then((value) => mounted && setAccount(value)).catch(() => undefined);\n"+marker,1)
marker="  if (screen === 'content') return <><ContentScreen onBack={() => setScreen('home')} />{update.status === 'ready' && <UpdateBar state={update} />}</>;"
req(marker in s,'App content screen marker missing')
account_screen=marker+"\n  if (screen === 'account') return <><AccountScreen onBack={() => { void window.bestiary.getAccounts().then(setAccount); setScreen('home'); }} />{update.status === 'ready' && <UpdateBar state={update} />}</>;"
s=s.replace(marker,account_screen,1)
old="onSettings={() => store.setSettingsOpen(true)} onLibrary={() => setScreen('content')} onConsole={() => store.setConsoleOpen(true)}"
req(old in s,'Home props marker missing')
s=s.replace(old,"onSettings={() => store.setSettingsOpen(true)} onLibrary={() => setScreen('content')} onAccount={() => setScreen('account')} account={account} onConsole={() => store.setConsoleOpen(true)}",1)
p.write_text(s,encoding='utf-8')

p=root/'src/renderer/src/components/Home.tsx'
s=p.read_text(encoding='utf-8')
s=s.replace("import type { LauncherSettings, LauncherSnapshot, UiProgressEvent } from '../../../shared/ipc';", "import type { AccountSnapshot, LauncherSettings, LauncherSnapshot, UiProgressEvent } from '../../../shared/ipc';",1)
marker='  onLibrary: () => void;\n  onConsole: () => void;'
req(marker in s,'Home Props marker missing')
s=s.replace(marker,'  onLibrary: () => void;\n  onAccount: () => void;\n  account: AccountSnapshot | null;\n  onConsole: () => void;',1)
old='export function Home({ snapshot, settings, progress, onUsername, onPlay, onDiscord, onSettings, onLibrary, onConsole, onAnnouncement }: Props) {'
req(old in s,'Home function marker missing')
s=s.replace(old,'export function Home({ snapshot, settings, progress, onUsername, onPlay, onDiscord, onSettings, onLibrary, onAccount, account, onConsole, onAnnouncement }: Props) {',1)
s=s.replace('5.2.1','5.3.0').replace('5.2.0','5.3.0')
marker="  const remoteVersion = release.version || '---';"
req(marker in s,'Home remote version marker missing')
s=s.replace(marker,marker+"\n  const microsoftActive = account?.mode === 'microsoft' && Boolean(account.microsoft);\n  const activeUsername = microsoftActive ? (account?.microsoft?.username ?? '') : settings.username;",1)
s=s.replace('<span>TÊN NGƯỜI CHƠI</span>\n            <input value={settings.username}', "<span>{microsoftActive ? 'MICROSOFT ACCOUNT' : 'TÊN NGƯỜI CHƠI'}</span>\n            <input value={activeUsername} readOnly={microsoftActive}",1)
s=s.replace('disabled={busy || settings.username.length < 3}', 'disabled={busy || (!microsoftActive && settings.username.length < 3)}',1)
marker='          <button onClick={onSettings}><b>⚙</b><span><strong>Cài đặt</strong><small>Client · RAM · Hiển thị</small></span></button>'
req(marker in s,'Home settings action marker missing')
account_btn='          <button onClick={onAccount}><b>♙</b><span><strong>Tài khoản & Skin</strong><small>{microsoftActive ? `Microsoft · ${account?.microsoft?.username ?? ""}` : "Crack · Microsoft chính chủ"}</small></span></button>\n'
s=s.replace(marker,account_btn+marker,1)
p.write_text(s,encoding='utf-8')

p=root/'src/renderer/src/components/Home.css'
s=p.read_text(encoding='utf-8')
s += "\n/* 5.3.0 account/skin navigation */\n.bestiary-actions{grid-template-columns:repeat(2,minmax(0,1fr));}\n.bestiary-userfield input:read-only{color:#8fb5ff;}\n"
p.write_text(s,encoding='utf-8')

print('Bestiary Launcher 5.3.0 Microsoft auth + player skin patch applied.')

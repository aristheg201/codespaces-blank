$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Reconstruct verified 5.3.7 source without intermediate package builds ==='
Remove-Item source -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force source | Out-Null

$baseParts = @('src5-00','src5-01','src5-02','src5-03a','src5-03b','src5-04','src5-05')
$baseB64 = ($baseParts | ForEach-Object { (Get-Content "bestiary-build/$_" -Raw).Trim() }) -join ''
[IO.File]::WriteAllBytes('base-source-v538.tar.gz', [Convert]::FromBase64String($baseB64))
tar -xzf base-source-v538.tar.gz -C source
if ($LASTEXITCODE -ne 0) { throw 'Unable to reconstruct base launcher source.' }

@'
import base64, pathlib, zlib
root = pathlib.Path('bestiary-v510/overlay')
names = ['part-00.txt','part-01.txt','part-02.txt','part-03.txt','part-04.txt']
text = ''.join((root/n).read_text(encoding='utf-8').strip() for n in names)
text += '=' * ((4-len(text)%4)%4)
d = zlib.decompressobj(16 + zlib.MAX_WBITS)
raw = d.decompress(base64.b64decode(text))
allowed = pathlib.Path('source').resolve()
start = 0
recovered = []
while True:
    p = raw.find(b'ustar', start)
    if p < 0: break
    start = p + 5
    h0 = p - 257
    if h0 < 0 or h0 + 512 > len(raw): continue
    h = raw[h0:h0+512]
    name = h[:100].split(b'\0',1)[0].decode('utf-8','replace')
    prefix = h[345:500].split(b'\0',1)[0].decode('utf-8','replace')
    if prefix: name = prefix + '/' + name
    try: size = int(h[124:136].split(b'\0',1)[0].strip() or b'0', 8)
    except Exception: continue
    data0 = h0 + 512
    if size < 0 or data0 + size > len(raw) or not name.startswith('src/'): continue
    target = (allowed / name).resolve()
    if allowed not in target.parents: continue
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw[data0:data0+size])
    recovered.append(name)
required = ['src/main/index.ts','src/main/core/JvmProfileGenerator.ts','src/main/core/Launcher.ts','src/main/core/RemoteService.ts','src/shared/ipc.ts','src/renderer/src/App.tsx']
missing = [name for name in required if name not in recovered]
if missing: raise SystemExit('Missing recovered files: ' + ', '.join(missing))
print('Recovered launcher files:', len(recovered))
'@ | Set-Content recover_overlay_v538.py -Encoding UTF8
python recover_overlay_v538.py
if ($LASTEXITCODE -ne 0) { throw 'Unable to recover Bestiary launcher overlay.' }

Copy-Item bestiary-v510-final/fixes/ipc.ts source/src/shared/ipc.ts -Force
Copy-Item bestiary-v510-final/fixes/SettingsStore.ts source/src/main/core/SettingsStore.ts -Force
Copy-Item bestiary-v510-final/fixes/preload-index.ts source/src/preload/index.ts -Force
Copy-Item bestiary-v510-final/fixes/App.tsx source/src/renderer/src/App.tsx -Force
Copy-Item bestiary-v510-final/fixes/Home.tsx source/src/renderer/src/components/Home.tsx -Force
Copy-Item bestiary-v510-final/fixes/Home.css source/src/renderer/src/components/Home.css -Force
Copy-Item bestiary-v510-final/fixes/ProfileChooser.tsx source/src/renderer/src/components/ProfileChooser.tsx -Force
Copy-Item bestiary-v510-final/fixes/SettingsModal.tsx source/src/renderer/src/components/SettingsModal.tsx -Force
Copy-Item bestiary-build/electron-builder.json source/electron-builder.json -Force

@'
from pathlib import Path
p = Path('source/src/main/index.ts')
s = p.read_text(encoding='utf-8')
s = s.replace('  const generated = generateJvmProfile(settings, release);\n', '')
s = s.replace('    generatedJvmArgs: generated.args,', '    generatedJvmArgs: settings.generatedJvmArgs,')
s = s.replace('      extraJvmArgs: generateJvmProfile(settings, remote).args,', '      extraJvmArgs: settings.generatedJvmArgs,')
marker = "  ipcMain.handle('bestiary:start-game', async (_event, settings: LauncherSettings) => startGame(settings));"
insertion = "  ipcMain.handle('bestiary:generate-jvm', async (_event, input: LauncherSettings) => {\n    const remote = currentRemote ?? (await getRemote());\n    const generated = generateJvmProfile(input, remote);\n    await settingsStore.save({ ...input, generatedJvmArgs: generated.args });\n    return snapshot();\n  });\n"
if marker not in s: raise SystemExit('start-game IPC marker not found')
p.write_text(s.replace(marker, insertion + marker), encoding='utf-8')
home = Path('source/src/renderer/src/components/Home.tsx')
home.write_text(home.read_text(encoding='utf-8').replace('5.1.2','5.1.3'), encoding='utf-8')
'@ | Set-Content patch_v513_fast.py -Encoding UTF8
python patch_v513_fast.py
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply 5.1.3 source patch.' }

Copy-Item bestiary-v510-final/fixes/UxPanels.css source/src/renderer/src/components/UxPanels.css -Force
Copy-Item bestiary-v510-final/fixes/LauncherUx.css source/src/renderer/src/components/LauncherUx.css -Force
Copy-Item bestiary-v510-final/fixes/DiscordText.tsx source/src/renderer/src/components/DiscordText.tsx -Force
Copy-Item bestiary-v510-final/fixes/AnnouncementModal.tsx source/src/renderer/src/components/AnnouncementModal.tsx -Force
Copy-Item bestiary-v515/fixes/ContentManager.ts source/src/main/core/ContentManager.ts -Force
Copy-Item bestiary-v515/fixes/LibraryModal.tsx source/src/renderer/src/components/LibraryModal.tsx -Force
Copy-Item bestiary-v515/fixes/LibraryUx.css source/src/renderer/src/components/LibraryUx.css -Force
Copy-Item bestiary-v520/fixes/App.tsx source/src/renderer/src/App.tsx -Force
Copy-Item bestiary-v520/fixes/ContentScreen.tsx source/src/renderer/src/components/ContentScreen.tsx -Force
Copy-Item bestiary-v520/fixes/ContentScreen.css source/src/renderer/src/components/ContentScreen.css -Force
Copy-Item bestiary-v520/fixes/AppUpdate.css source/src/renderer/src/components/AppUpdate.css -Force
Copy-Item bestiary-v520/fixes/AppUpdater.ts source/src/main/core/AppUpdater.ts -Force
Copy-Item bestiary-v530/fixes/ipc.ts source/src/shared/ipc.ts -Force
Copy-Item bestiary-v530/fixes/preload-index.ts source/src/preload/index.ts -Force
Copy-Item bestiary-v530/fixes/AccountService.ts source/src/main/core/AccountService.ts -Force
Copy-Item bestiary-v530/fixes/AccountScreen.tsx source/src/renderer/src/components/AccountScreen.tsx -Force
Copy-Item bestiary-v530/fixes/AccountScreen.css source/src/renderer/src/components/AccountScreen.css -Force

$patches = @(
  'bestiary-v514/patch_sync_profile.py',
  'bestiary-v515/patch_android_manifest.py',
  'bestiary-v515/patch_library.py',
  'bestiary-v520/patch_main.py',
  'bestiary-v520/patch_home.py',
  'bestiary-v521/patch_home.py',
  'bestiary-v530/patch_v530.py',
  'bestiary-v530/patch_bridge_package.py',
  'bestiary-v531/patch_v531.py',
  'bestiary-v532/patch_v532.py',
  'bestiary-v533/patch_v533.py'
)
foreach ($patch in $patches) {
  python $patch
  if ($LASTEXITCODE -ne 0) { throw "Patch failed: $patch" }
}

New-Item -ItemType Directory -Force .tmp-v533-ui | Out-Null
Copy-Item source/src/renderer/src/components/Home.tsx .tmp-v533-ui/Home.tsx -Force
Copy-Item source/src/renderer/src/components/AccountScreen.tsx .tmp-v533-ui/AccountScreen.tsx -Force
python bestiary-v534/patch_v534.py
if ($LASTEXITCODE -ne 0) { throw '5.3.4 bridge patch failed.' }
Copy-Item .tmp-v533-ui/Home.tsx source/src/renderer/src/components/Home.tsx -Force
Copy-Item .tmp-v533-ui/AccountScreen.tsx source/src/renderer/src/components/AccountScreen.tsx -Force
python bestiary-v535/patch_v535.py
if ($LASTEXITCODE -ne 0) { throw '5.3.5 identity bridge patch failed.' }
python bestiary-v536/patch_v536.py
if ($LASTEXITCODE -ne 0) { throw '5.3.6 lifecycle patch failed.' }
Copy-Item bestiary-v537/KeybindPolicyService.ts source/src/main/core/KeybindPolicyService.ts -Force
python bestiary-v537/patch_v537.py
if ($LASTEXITCODE -ne 0) { throw '5.3.7 keybind/lifecycle patch failed.' }

Write-Host '=== Apply 5.3.8 Microsoft RAM/JVM bridge fix ==='
python bestiary-v538/patch_v538.py
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.3.8 Microsoft runtime bridge fix.' }

Write-Host '=== Prepare packaging resources ==='
New-Item -ItemType Directory -Force source/build | Out-Null
Copy-Item bestiary-build/installer.nsh source/build/installer.nsh -Force
$logoParts = @('logo5-00a','logo5-00b','logo5-01a','logo5-01b','logo5-02','logo5-03','logo5-04a','logo5-04b')
$logoB64 = ($logoParts | ForEach-Object { (Get-Content "bestiary-build/$_" -Raw).Trim() }) -join ''
New-Item -ItemType Directory -Force source/resources | Out-Null
New-Item -ItemType Directory -Force source/src/renderer/public | Out-Null
[IO.File]::WriteAllBytes('source/resources/logo.png', [Convert]::FromBase64String($logoB64))
Copy-Item source/resources/logo.png source/src/renderer/public/logo.png -Force
Copy-Item bestiary-skin-bridge/build/libs/bestiary-skin-bridge-1.0.0.jar source/resources/bestiary-skin-bridge-1.0.0.jar -Force

python -m pip install --disable-pip-version-check --quiet Pillow==11.3.0
@'
from PIL import Image
from pathlib import Path
root = Path('source')
src = Image.open(root/'resources'/'logo.png').convert('RGBA')
canvas = Image.new('RGBA',(256,256),(0,0,0,0))
src.thumbnail((230,150),Image.Resampling.LANCZOS)
canvas.alpha_composite(src,((256-src.width)//2,(256-src.height)//2))
(root/'build').mkdir(parents=True,exist_ok=True)
canvas.save(root/'resources'/'icon.png')
canvas.save(root/'build'/'icon.ico',format='ICO',sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(24,24),(16,16)])
'@ | Set-Content create_icon_v538.py -Encoding UTF8
python create_icon_v538.py
if ($LASTEXITCODE -ne 0) { throw 'Unable to create Windows icon.' }


Write-Host '=== Fast-forward source patches 5.3.9 -> 5.4.5 without intermediate packaging ==='
Copy-Item 'bestiary-v539/JvmProfileGenerator.ts' 'source/src/main/core/JvmProfileGenerator.ts' -Force
python 'bestiary-v539/patch_v539.py'
if ($LASTEXITCODE -ne 0) { throw '5.3.9 source patch failed.' }

$main539 = Get-Content 'source/src/main/index.ts' -Raw
$oldProfile = '      profile: settings.clientProfile,'
if (-not $main539.Contains($oldProfile)) { throw 'SyncEngine client profile marker missing.' }
$main539 = $main539.Replace($oldProfile, '      profile: settings.clientProfile ?? undefined,')
Set-Content 'source/src/main/index.ts' $main539 -Encoding UTF8

python 'bestiary-v540/patch_v540.py'
if ($LASTEXITCODE -ne 0) { throw '5.4.0 source patch failed.' }
python 'bestiary-v541/patch_v541.py'
if ($LASTEXITCODE -ne 0) { throw '5.4.1 source patch failed.' }
python 'bestiary-v542/patch_v542.py'
if ($LASTEXITCODE -ne 0) { throw '5.4.2 source patch failed.' }
python 'bestiary-v543/patch_v543.py'
if ($LASTEXITCODE -ne 0) { throw '5.4.3 source patch failed.' }

Copy-Item 'bestiary-v544/JvmProfileGenerator.ts' 'source/src/main/core/JvmProfileGenerator.ts' -Force
python 'bestiary-v544/patch_v544.py'
if ($LASTEXITCODE -ne 0) { throw '5.4.4 source patch failed.' }

Copy-Item 'bestiary-v545/KeybindSettingsService.ts' 'source/src/main/core/KeybindSettingsService.ts' -Force
Copy-Item 'bestiary-v545/KeybindPanel.tsx' 'source/src/renderer/src/components/KeybindPanel.tsx' -Force
Copy-Item 'bestiary-v545/KeybindPanel.css' 'source/src/renderer/src/components/KeybindPanel.css' -Force
python 'bestiary-v545/patch_v545.py'
if ($LASTEXITCODE -ne 0) { throw '5.4.5 source patch failed.' }

Write-Host '=== Apply 5.4.7 Pack Manager keybind integration ==='
Copy-Item 'bestiary-v547/ContentScreen.tsx' 'source/src/renderer/src/components/ContentScreen.tsx' -Force

$panel = Get-Content 'source/src/renderer/src/components/KeybindPanel.tsx' -Raw
if ($panel -notmatch "import './UxPanels.css';") {
  $panel = $panel.Replace("import './KeybindPanel.css';", "import './UxPanels.css';" + [Environment]::NewLine + "import './KeybindPanel.css';")
  Set-Content 'source/src/renderer/src/components/KeybindPanel.tsx' $panel -Encoding UTF8
}

$cssPath = 'source/src/renderer/src/components/ContentScreen.css'
$css = Get-Content $cssPath -Raw
$css = $css.Replace('.content-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}', '.content-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}')
if ($css -notmatch 'content-keybind-host') {
  $css += [Environment]::NewLine + '.content-keybind-host{min-height:0;flex:1;border:1px solid #242831;border-radius:17px;background:#0c0f13;overflow:auto;padding:18px 20px;box-sizing:border-box}.content-keybind-host .ux-settings-section{max-width:none}.content-keybind-host .keybind-list{max-height:none}@media(max-width:900px){.content-tabs{grid-template-columns:repeat(2,1fr)}}'
}
Set-Content $cssPath $css -Encoding UTF8

$appPath = 'source/src/renderer/src/App.tsx'
$appSource = (Get-Content $appPath -Raw).Replace("currentVersion: '5.4.5'", "currentVersion: '5.4.7'")
if ($appSource -notmatch "currentVersion: '5\.4\.6'") { throw 'Unable to bump App version to 5.4.7.' }
Set-Content $appPath $appSource -Encoding UTF8

$homePath = 'source/src/renderer/src/components/Home.tsx'
$homeSource = (Get-Content $homePath -Raw).Replace('5.4.5', '5.4.7')
Set-Content $homePath $homeSource -Encoding UTF8

foreach ($rel in @('source/src/main/core/AccountService.ts','source/src/main/core/RemoteService.ts')) {
  $text = (Get-Content $rel -Raw).Replace('BestiaryLauncher/5.4.5', 'BestiaryLauncher/5.4.7')
  if ($text -notmatch 'BestiaryLauncher/5\.4\.6') { throw "Unable to bump $rel to 5.4.7." }
  Set-Content $rel $text -Encoding UTF8
}

Push-Location source
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
npm install adm-zip@0.5.16 --save --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'adm-zip install failed.' }
npm install -D @types/adm-zip@0.5.7 --save-dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw '@types/adm-zip install failed.' }

$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.4.7'
$pkg.author = 'SVFrame Team Studio'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.7 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.7 Windows build failed.' }
Pop-Location

python 'bestiary-v547/patch_v547.py'
if ($LASTEXITCODE -ne 0) { throw '5.4.7 startup auto-update patch failed.' }

Write-Host '=== Verify 5.4.7 auto-update contracts ==='
$main = Get-Content 'source/src/main/index.ts' -Raw
$ipc = Get-Content 'source/src/shared/ipc.ts' -Raw
$preload = Get-Content 'source/src/preload/index.ts' -Raw
$content = Get-Content 'source/src/renderer/src/components/ContentScreen.tsx' -Raw
$keybindPanel = Get-Content 'source/src/renderer/src/components/KeybindPanel.tsx' -Raw
$keybindService = Get-Content 'source/src/main/core/KeybindSettingsService.ts' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$generator = Get-Content 'source/src/main/core/JvmProfileGenerator.ts' -Raw

if ($appSource -notmatch "currentVersion: '5\.4\.6'") { throw '5.4.7 version metadata missing.' }
if ($generator -notmatch "GENERATOR_REVISION_ARG = '-Dbestiary.jvm.profile=544'") { throw '5.4.4 JVM profile contract regressed.' }
if ($generator -notmatch 'MIN_CLIENT_HEAP_MB = 3072') { throw '3 GB minimum client heap regressed.' }

if ($main -notmatch "event\.type === 'state' && event\.state === 'running'" -or $main -notmatch 'mainWindow\.hide\(\)') { throw '5.4.5 auto-hide contract regressed.' }
if ($main -notmatch "event\.type === 'state' && event\.state === 'stopped'" -or $main -notmatch 'restoreBestiaryWindow\(\);') { throw '5.4.5 restore contract regressed.' }
if ($main -notmatch "bestiary:keybind-get" -or $main -notmatch "bestiary:keybind-save") { throw 'Keybind IPC handlers missing.' }
if ($ipc -notmatch 'interface KeybindEntry' -or $preload -notmatch 'bestiary:keybind-get') { throw 'Keybind bridge missing.' }

if ($content -notmatch "label: 'KEYBINDS'") { throw 'Pack Manager KEYBINDS tab missing.' }
if ($content -notmatch '<KeybindPanel />') { throw 'Pack Manager does not use the shared keybind editor.' }
if ($content -notmatch '<h1>Pack Manager</h1>') { throw 'Pack Manager heading missing.' }
if ($content -notmatch "tab !== 'keybinds'") { throw 'File drop/install UI is not isolated from the keybind tab.' }
if ($content -notmatch 'openLibraryFolder\(libraryTab\)') { throw 'File folder action is not narrowed to file tabs.' }
if ($keybindPanel -notmatch "import './UxPanels.css';") { throw 'Pack Manager keybind styles are not self-contained.' }
if ($keybindPanel -notmatch 'Xung đột' -or $keybindPanel -notmatch 'LƯU KEYBIND') { throw 'Keybind edit/conflict UI missing.' }
if ($keybindService -notmatch "mode === 'locked'" -or $keybindService -notmatch 'buildConflictMap') { throw 'Keybind policy/conflict backend missing.' }

$installer = Get-Item 'source/release/BestiaryLauncher-Setup-5.4.7.exe' -ErrorAction Stop
$unpacked = Resolve-Path 'source/release/win-unpacked'
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher 5.4.7 binary unexpectedly small.' }
if (-not (Test-Path (Join-Path $unpacked 'resources/app.asar'))) { throw 'Launcher 5.4.7 runtime is missing app.asar.' }

Write-Host '=== Smoke Launcher 5.4.7 binary ==='
$stdoutPath = "$PWD/runtime-smoke-v547-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v547-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 10
if ($proc.HasExited) {
  if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Tail 120 }
  if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 120 }
  throw "Launcher 5.4.7 exited during smoke test with code $($proc.ExitCode)."
}
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v547' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v547/diagnostic-source' | Out-Null
Copy-Item $installer.FullName 'build-output-v547/BestiaryLauncher-Setup-5.4.7.exe' -Force
$hash = (Get-FileHash 'build-output-v547/BestiaryLauncher-Setup-5.4.7.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.4.7.exe" | Set-Content 'build-output-v547/BestiaryLauncher-Setup-5.4.7-SHA256.txt' -Encoding ascii
Copy-Item $stdoutPath 'build-output-v547/runtime-smoke-stdout.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stderrPath 'build-output-v547/runtime-smoke-stderr.log' -Force -ErrorAction SilentlyContinue
Copy-Item 'source/src/renderer/src/components/ContentScreen.tsx' 'build-output-v547/diagnostic-source/ContentScreen.tsx' -Force
Copy-Item 'source/src/renderer/src/components/KeybindPanel.tsx' 'build-output-v547/diagnostic-source/KeybindPanel.tsx' -Force
Copy-Item 'source/src/main/core/KeybindSettingsService.ts' 'build-output-v547/diagnostic-source/KeybindSettingsService.ts' -Force

@"
version=5.4.7
sha256=$hash
baseJvmProfileRevision=544
minimumClientHeapMb=3072
autoHideOnMinecraftRunning=true
restoreLauncherOnMinecraftStop=true
settingsKeybindEditor=true
packManagerKeybindTab=true
packManagerUsesSharedKeybindEditor=true
vanillaAndModdedKeybinds=true
keybindConflictDetection=true
keybindLockedPolicyAware=true
keybindAtomicSave=true
"@ | Set-Content 'build-output-v547/feature-contract.txt' -Encoding ascii

Write-Host "Launcher 5.4.7 SHA256: $hash"
Write-Host 'Launcher 5.4.7 startup auto-update build completed.'

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

Write-Host '=== Install dependencies, typecheck and package 5.3.8 ==='
Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.3.8'
$pkg.author = 'SVFrame Team Studio'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
npm install adm-zip@0.5.16 --save --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'adm-zip install failed.' }
npm install -D @types/adm-zip@0.5.7 --save-dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw '@types/adm-zip install failed.' }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.8 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.8 Windows build failed.' }
Pop-Location

Write-Host '=== Verify Microsoft runtime bridge contracts ==='
$bridge = Get-Content source/src/main/core/OfficialLauncherBridge.ts -Raw
$main = Get-Content source/src/main/index.ts -Raw
$appSource = Get-Content source/src/renderer/src/App.tsx -Raw
$account = Get-Content source/src/main/core/AccountService.ts -Raw
$remote = Get-Content source/src/main/core/RemoteService.ts -Raw
$launcher = Get-Content source/src/main/core/Launcher.ts -Raw
if ($bridge -notmatch 'buildOfficialLauncherJavaArgs') { throw 'Official launcher JVM serializer missing.' }
if ($bridge -notmatch 'DEFAULT_BRIDGE_JVM_ARGS') { throw 'Official launcher default JVM parity missing.' }
if ($bridge -notmatch '`-Xms\$\{minRamMb\}M`' -or $bridge -notmatch '`-Xmx\$\{maxRamMb\}M`') { throw 'Official launcher RAM flags missing.' }
if ($bridge -notmatch 'settings\.generatedJvmArgs') { throw 'Generated JVM flags are not synced.' }
if ($bridge -notmatch 'javaArgs,') { throw 'Bestiary installation does not persist javaArgs.' }
if ($bridge -notmatch 'prepareAndOpen\(profileId: string, settings: LauncherSettings\)') { throw 'Bridge does not accept Launcher settings.' }
if ($bridge -match 'launcher_accounts\.json|accessToken|refreshToken') { throw 'Official launcher bridge must never touch launcher credentials.' }
if ($main -notmatch 'officialLauncherBridge\.prepareAndOpen\(profileId, settings\)') { throw 'Microsoft route does not pass settings.' }
if ($appSource -notmatch "currentVersion: '5\.3\.8'") { throw 'Launcher 5.3.8 version metadata missing.' }
if ($account -notmatch 'BestiaryLauncher/5\.3\.8' -or $remote -notmatch 'BestiaryLauncher/5\.3\.8') { throw 'Launcher 5.3.8 user-agent metadata missing.' }
$requiredJvm = @('-XX:+UseG1GC','-XX:+ParallelRefProcEnabled','-XX:MaxGCPauseMillis=100','-XX:+DisableExplicitGC','-XX:+PerfDisableSharedMem','-Dfile.encoding=UTF-8','-Djava.awt.headless=false','-Dlog4j2.formatMsgNoLookups=true')
foreach ($arg in $requiredJvm) {
  if (-not $launcher.Contains($arg) -or -not $bridge.Contains($arg)) { throw "JVM parity contract missing: $arg" }
}

$installer = Get-Item source/release/BestiaryLauncher-Setup-5.3.8.exe -ErrorAction Stop
$unpacked = Resolve-Path source/release/win-unpacked
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher 5.3.8 binary unexpectedly small.' }

Write-Host '=== Smoke patched 5.3.8 binary ==='
$stdoutPath = "$PWD/runtime-smoke-v538-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v538-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 10
if ($proc.HasExited) {
  if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Tail 120 }
  if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 120 }
  throw "Launcher 5.3.8 exited during smoke test with code $($proc.ExitCode)."
}
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item build-output-v538 -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force build-output-v538 | Out-Null
Copy-Item $installer.FullName build-output-v538/BestiaryLauncher-Setup-5.3.8.exe -Force
$hash = (Get-FileHash build-output-v538/BestiaryLauncher-Setup-5.3.8.exe -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.3.8.exe" | Set-Content build-output-v538/BestiaryLauncher-Setup-5.3.8-SHA256.txt -Encoding ascii
Copy-Item $stdoutPath build-output-v538/runtime-smoke-stdout.log -Force -ErrorAction SilentlyContinue
Copy-Item $stderrPath build-output-v538/runtime-smoke-stderr.log -Force -ErrorAction SilentlyContinue
Write-Host "Launcher 5.3.8 SHA256: $hash"
Write-Host 'Launcher 5.3.8 Microsoft RAM/JVM bridge build completed.'

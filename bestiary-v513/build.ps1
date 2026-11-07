$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

Write-Host '=== Bestiary Launcher 5.1.3 runtime-verified build ==='
Remove-Item "$PWD/source" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "$PWD/build-output-v513" -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$PWD/source" | Out-Null

$baseParts = @('src5-00','src5-01','src5-02','src5-03a','src5-03b','src5-04','src5-05')
$baseB64 = ($baseParts | ForEach-Object { (Get-Content "bestiary-build/$_" -Raw).Trim() }) -join ''
[IO.File]::WriteAllBytes("$PWD/base-source-v513.tar.gz", [Convert]::FromBase64String($baseB64))
tar -xzf "$PWD/base-source-v513.tar.gz" -C "$PWD/source"
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
    if size < 0 or data0 + size > len(raw): continue
    if not name.startswith('src/'): continue
    target = (allowed / name).resolve()
    if allowed not in target.parents: continue
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(raw[data0:data0+size])
    recovered.append(name)
required = [
    'src/main/index.ts','src/main/core/JvmProfileGenerator.ts','src/main/core/ContentManager.ts',
    'src/main/core/Launcher.ts','src/main/core/SyncEngine.ts','src/main/core/RemoteService.ts',
    'src/shared/ipc.ts','src/renderer/src/App.tsx','src/renderer/src/components/LibraryModal.tsx'
]
missing = [name for name in required if name not in recovered]
if missing: raise SystemExit('Missing required recovered files: ' + ', '.join(missing))
print('Recovered launcher files:', len(recovered))
'@ | Set-Content -Encoding UTF8 "$PWD/recover_overlay_v513.py"
python "$PWD/recover_overlay_v513.py"
if ($LASTEXITCODE -ne 0) { throw 'Unable to recover Bestiary Launcher overlay.' }

Copy-Item 'bestiary-v510-final/fixes/ipc.ts' "$PWD/source/src/shared/ipc.ts" -Force
Copy-Item 'bestiary-v510-final/fixes/SettingsStore.ts' "$PWD/source/src/main/core/SettingsStore.ts" -Force
Copy-Item 'bestiary-v510-final/fixes/preload-index.ts' "$PWD/source/src/preload/index.ts" -Force
Copy-Item 'bestiary-v510-final/fixes/App.tsx' "$PWD/source/src/renderer/src/App.tsx" -Force
Copy-Item 'bestiary-v510-final/fixes/Home.tsx' "$PWD/source/src/renderer/src/components/Home.tsx" -Force
Copy-Item 'bestiary-v510-final/fixes/Home.css' "$PWD/source/src/renderer/src/components/Home.css" -Force
Copy-Item 'bestiary-v510-final/fixes/ProfileChooser.tsx' "$PWD/source/src/renderer/src/components/ProfileChooser.tsx" -Force
Copy-Item 'bestiary-v510-final/fixes/SettingsModal.tsx' "$PWD/source/src/renderer/src/components/SettingsModal.tsx" -Force
Copy-Item 'bestiary-build/electron-builder.json' "$PWD/source/electron-builder.json" -Force

@'
from pathlib import Path
p = Path('source/src/main/index.ts')
s = p.read_text(encoding='utf-8')
s = s.replace('  const generated = generateJvmProfile(settings, release);\n', '')
s = s.replace('    generatedJvmArgs: generated.args,', '    generatedJvmArgs: settings.generatedJvmArgs,')
s = s.replace('      extraJvmArgs: generateJvmProfile(settings, remote).args,', '      extraJvmArgs: settings.generatedJvmArgs,')
marker = "  ipcMain.handle('bestiary:start-game', async (_event, settings: LauncherSettings) => startGame(settings));"
insertion = """  ipcMain.handle('bestiary:generate-jvm', async (_event, input: LauncherSettings) => {\n    const remote = currentRemote ?? (await getRemote());\n    const generated = generateJvmProfile(input, remote);\n    await settingsStore.save({ ...input, generatedJvmArgs: generated.args });\n    return snapshot();\n  });\n"""
if marker not in s: raise SystemExit('start-game IPC marker not found')
s = s.replace(marker, insertion + marker)
p.write_text(s, encoding='utf-8')

home = Path('source/src/renderer/src/components/Home.tsx')
h = home.read_text(encoding='utf-8').replace('5.1.2', '5.1.3')
home.write_text(h, encoding='utf-8')
'@ | Set-Content -Encoding UTF8 "$PWD/patch_v513.py"
python "$PWD/patch_v513.py"
if ($LASTEXITCODE -ne 0) { throw 'Unable to patch Bestiary Launcher 5.1.3.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.1.3'
$pkg.author = 'SVFrame Team Studio'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
Pop-Location

New-Item -ItemType Directory -Force "$PWD/source/build" | Out-Null
Copy-Item 'bestiary-build/installer.nsh' "$PWD/source/build/installer.nsh" -Force
$logoParts = @('logo5-00a','logo5-00b','logo5-01a','logo5-01b','logo5-02','logo5-03','logo5-04a','logo5-04b')
$logoB64 = ($logoParts | ForEach-Object { (Get-Content "bestiary-build/$_" -Raw).Trim() }) -join ''
New-Item -ItemType Directory -Force "$PWD/source/resources" | Out-Null
New-Item -ItemType Directory -Force "$PWD/source/src/renderer/public" | Out-Null
[IO.File]::WriteAllBytes("$PWD/source/resources/logo.png", [Convert]::FromBase64String($logoB64))
Copy-Item "$PWD/source/resources/logo.png" "$PWD/source/src/renderer/public/logo.png" -Force

python -m pip install --disable-pip-version-check --quiet Pillow==11.3.0
@'
from PIL import Image
from pathlib import Path
root=Path('source')
src=Image.open(root/'resources'/'logo.png').convert('RGBA')
canvas=Image.new('RGBA',(256,256),(0,0,0,0))
src.thumbnail((230,150),Image.Resampling.LANCZOS)
canvas.alpha_composite(src,((256-src.width)//2,(256-src.height)//2))
(root/'build').mkdir(parents=True,exist_ok=True)
canvas.save(root/'resources'/'icon.png')
canvas.save(root/'build'/'icon.ico',format='ICO',sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(24,24),(16,16)])
'@ | Set-Content -Encoding UTF8 "$PWD/create_icon_v513.py"
python "$PWD/create_icon_v513.py"
if ($LASTEXITCODE -ne 0) { throw 'Unable to create Windows icon.' }

$remote = Get-Content "$PWD/source/src/main/core/RemoteService.ts" -Raw
$launcherCore = Get-Content "$PWD/source/src/main/core/Launcher.ts" -Raw
$constants = Get-Content "$PWD/source/src/shared/constants.ts" -Raw
$homeSource = Get-Content "$PWD/source/src/renderer/src/components/Home.tsx" -Raw
$cssSource = Get-Content "$PWD/source/src/renderer/src/components/Home.css" -Raw
if ($remote -notmatch 'loaderVersion') { throw 'Remote manifest loaderVersion support is missing.' }
if ($remote -notmatch 'defaultFabricLoader') { throw 'config.json defaultFabricLoader fallback is missing.' }
if (($remote + $launcherCore + $constants) -notmatch 'DEFAULT_FABRIC_LOADER') { throw 'Pinned Fabric fallback constant is missing.' }
if ($launcherCore -notmatch '(?i)fabric') { throw 'Fabric runtime stage is missing from launcher core.' }
if (($remote + $launcherCore) -match '(?is)fabric.{0,48}\blatest\b|\blatest\b.{0,48}fabric') { throw 'Launcher must not auto-select latest Fabric Loader.' }
if ($homeSource -notmatch 'bestiary-layout' -or $homeSource -notmatch 'bestiary-rail') { throw 'Restored launcher layout is missing.' }
if ($cssSource -notmatch '\.bestiary-layout' -or $cssSource.Length -lt 5000) { throw 'Restored launcher CSS is missing or incomplete.' }
Write-Host 'Runtime and renderer contracts verified.'

Push-Location source
npm install --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
npm install adm-zip@0.5.16 --save --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'adm-zip install failed.' }
npm install -D @types/adm-zip@0.5.7 --save-dev --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw '@types/adm-zip install failed.' }
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
Pop-Location

$unpackedDir = Resolve-Path "$PWD/source/release/win-unpacked"
$launcherExe = Get-Item (Join-Path $unpackedDir 'Bestiary Launcher.exe') -ErrorAction Stop
$installer = Get-Item "$PWD/source/release/BestiaryLauncher-Setup-5.1.3.exe" -ErrorAction Stop
if ($installer.Length -lt 1000000) { throw "Installer unexpectedly small: $($installer.Length)" }
if ($launcherExe.Length -lt 1000000) { throw "Launcher executable unexpectedly small: $($launcherExe.Length)" }
if (-not (Test-Path (Join-Path $unpackedDir 'resources/app.asar'))) { throw 'Portable runtime is missing resources/app.asar.' }

Write-Host '=== Runtime smoke test ==='
$stdoutPath = "$PWD/runtime-smoke-stdout.log"
$stderrPath = "$PWD/runtime-smoke-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $launcherExe.FullName -WorkingDirectory $unpackedDir -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 12
if ($proc.HasExited) {
    Write-Host "Launcher exited during smoke test with code $($proc.ExitCode)."
    if (Test-Path $stdoutPath) { Write-Host '--- stdout ---'; Get-Content $stdoutPath -Tail 200 }
    if (Test-Path $stderrPath) { Write-Host '--- stderr ---'; Get-Content $stderrPath -Tail 200 }
    throw 'Launcher failed runtime smoke test.'
}
Write-Host "Launcher stayed alive for runtime smoke test. PID=$($proc.Id)"
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

New-Item -ItemType Directory -Force "$PWD/build-output-v513" | Out-Null
Copy-Item $installer.FullName "$PWD/build-output-v513/BestiaryLauncher-Setup-5.1.3.exe" -Force
$portableDir = "$PWD/build-output-v513/BestiaryLauncher-Portable-5.1.3"
Copy-Item $unpackedDir $portableDir -Recurse -Force
$portableZip = "$PWD/build-output-v513/BestiaryLauncher-Portable-5.1.3.zip"
Compress-Archive -Path "$portableDir/*" -DestinationPath $portableZip -CompressionLevel Optimal -Force
Remove-Item $portableDir -Recurse -Force

$installerHash = (Get-FileHash "$PWD/build-output-v513/BestiaryLauncher-Setup-5.1.3.exe" -Algorithm SHA256).Hash.ToLowerInvariant()
$portableHash = (Get-FileHash $portableZip -Algorithm SHA256).Hash.ToLowerInvariant()
"$installerHash  BestiaryLauncher-Setup-5.1.3.exe" | Set-Content -Encoding ascii "$PWD/build-output-v513/BestiaryLauncher-Setup-5.1.3-SHA256.txt"
"$portableHash  BestiaryLauncher-Portable-5.1.3.zip" | Set-Content -Encoding ascii "$PWD/build-output-v513/BestiaryLauncher-Portable-5.1.3-SHA256.txt"
Copy-Item $stdoutPath "$PWD/build-output-v513/runtime-smoke-stdout.log" -Force -ErrorAction SilentlyContinue
Copy-Item $stderrPath "$PWD/build-output-v513/runtime-smoke-stderr.log" -Force -ErrorAction SilentlyContinue

Write-Host "Installer SHA256: $installerHash"
Write-Host "Portable SHA256:  $portableHash"
Write-Host 'Bestiary Launcher 5.1.3 runtime-verified build completed.'

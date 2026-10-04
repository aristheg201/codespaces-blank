$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Reconstruct verified Launcher 5.3.8 baseline once ==='
& './bestiary-v538/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.8 baseline build failed with code $LASTEXITCODE" }

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

Write-Host '=== Apply 5.4.6 Pack Manager keybind integration ==='
Copy-Item 'bestiary-v546/ContentScreen.tsx' 'source/src/renderer/src/components/ContentScreen.tsx' -Force

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
$appSource = (Get-Content $appPath -Raw).Replace("currentVersion: '5.4.5'", "currentVersion: '5.4.6'")
if ($appSource -notmatch "currentVersion: '5\.4\.6'") { throw 'Unable to bump App version to 5.4.6.' }
Set-Content $appPath $appSource -Encoding UTF8

$homePath = 'source/src/renderer/src/components/Home.tsx'
$home = (Get-Content $homePath -Raw).Replace('5.4.5', '5.4.6')
Set-Content $homePath $home -Encoding UTF8

foreach ($rel in @('source/src/main/core/AccountService.ts','source/src/main/core/RemoteService.ts')) {
  $text = (Get-Content $rel -Raw).Replace('BestiaryLauncher/5.4.5', 'BestiaryLauncher/5.4.6')
  if ($text -notmatch 'BestiaryLauncher/5\.4\.6') { throw "Unable to bump $rel to 5.4.6." }
  Set-Content $rel $text -Encoding UTF8
}

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.4.6'
$pkg.author = 'SVFrame Team Studio'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.6 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.6 Windows build failed.' }
Pop-Location

Write-Host '=== Verify 5.4.6 Pack Manager contracts ==='
$main = Get-Content 'source/src/main/index.ts' -Raw
$ipc = Get-Content 'source/src/shared/ipc.ts' -Raw
$preload = Get-Content 'source/src/preload/index.ts' -Raw
$content = Get-Content 'source/src/renderer/src/components/ContentScreen.tsx' -Raw
$keybindPanel = Get-Content 'source/src/renderer/src/components/KeybindPanel.tsx' -Raw
$keybindService = Get-Content 'source/src/main/core/KeybindSettingsService.ts' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$generator = Get-Content 'source/src/main/core/JvmProfileGenerator.ts' -Raw

if ($appSource -notmatch "currentVersion: '5\.4\.6'") { throw '5.4.6 version metadata missing.' }
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

$installer = Get-Item 'source/release/BestiaryLauncher-Setup-5.4.6.exe' -ErrorAction Stop
$unpacked = Resolve-Path 'source/release/win-unpacked'
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher 5.4.6 binary unexpectedly small.' }
if (-not (Test-Path (Join-Path $unpacked 'resources/app.asar'))) { throw 'Launcher 5.4.6 runtime is missing app.asar.' }

Write-Host '=== Smoke Launcher 5.4.6 binary ==='
$stdoutPath = "$PWD/runtime-smoke-v546-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v546-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 10
if ($proc.HasExited) {
  if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Tail 120 }
  if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 120 }
  throw "Launcher 5.4.6 exited during smoke test with code $($proc.ExitCode)."
}
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v546' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v546/diagnostic-source' | Out-Null
Copy-Item $installer.FullName 'build-output-v546/BestiaryLauncher-Setup-5.4.6.exe' -Force
$hash = (Get-FileHash 'build-output-v546/BestiaryLauncher-Setup-5.4.6.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.4.6.exe" | Set-Content 'build-output-v546/BestiaryLauncher-Setup-5.4.6-SHA256.txt' -Encoding ascii
Copy-Item $stdoutPath 'build-output-v546/runtime-smoke-stdout.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stderrPath 'build-output-v546/runtime-smoke-stderr.log' -Force -ErrorAction SilentlyContinue
Copy-Item 'source/src/renderer/src/components/ContentScreen.tsx' 'build-output-v546/diagnostic-source/ContentScreen.tsx' -Force
Copy-Item 'source/src/renderer/src/components/KeybindPanel.tsx' 'build-output-v546/diagnostic-source/KeybindPanel.tsx' -Force
Copy-Item 'source/src/main/core/KeybindSettingsService.ts' 'build-output-v546/diagnostic-source/KeybindSettingsService.ts' -Force

@"
version=5.4.6
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
"@ | Set-Content 'build-output-v546/feature-contract.txt' -Encoding ascii

Write-Host "Launcher 5.4.6 SHA256: $hash"
Write-Host 'Launcher 5.4.6 Pack Manager build completed.'

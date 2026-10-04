$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Rebuild verified Launcher 5.4.4 baseline ==='
& './bestiary-v544/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.4.4 baseline build failed with code $LASTEXITCODE" }

Write-Host '=== Apply 5.4.5 auto-hide + keybind settings ==='
Copy-Item 'bestiary-v545/KeybindSettingsService.ts' 'source/src/main/core/KeybindSettingsService.ts' -Force
Copy-Item 'bestiary-v545/KeybindPanel.tsx' 'source/src/renderer/src/components/KeybindPanel.tsx' -Force
Copy-Item 'bestiary-v545/KeybindPanel.css' 'source/src/renderer/src/components/KeybindPanel.css' -Force
python 'bestiary-v545/patch_v545.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.4.5 patch.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.4.5'
$pkg.author = 'SVFrame Team Studio'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.5 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.5 Windows build failed.' }
Pop-Location

Write-Host '=== Verify 5.4.5 source contracts ==='
$main = Get-Content 'source/src/main/index.ts' -Raw
$ipc = Get-Content 'source/src/shared/ipc.ts' -Raw
$preload = Get-Content 'source/src/preload/index.ts' -Raw
$settings = Get-Content 'source/src/renderer/src/components/SettingsModal.tsx' -Raw
$keybindService = Get-Content 'source/src/main/core/KeybindSettingsService.ts' -Raw
$keybindPanel = Get-Content 'source/src/renderer/src/components/KeybindPanel.tsx' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$generator = Get-Content 'source/src/main/core/JvmProfileGenerator.ts' -Raw

if ($appSource -notmatch "currentVersion: '5\.4\.5'") { throw '5.4.5 version metadata missing.' }
if ($generator -notmatch "GENERATOR_REVISION_ARG = '-Dbestiary.jvm.profile=544'") { throw '5.4.4 JVM profile contract regressed.' }
if ($generator -notmatch 'MIN_CLIENT_HEAP_MB = 3072') { throw '3 GB minimum client heap regressed.' }

$lockCount = ([regex]::Matches($main, 'app\.requestSingleInstanceLock\(\)')).Count
if ($lockCount -ne 1) { throw "Expected exactly one requestSingleInstanceLock(), found $lockCount." }
if ($main -notmatch "event\.type === 'state' && event\.state === 'running'") { throw 'Minecraft running lifecycle event missing.' }
if ($main -notmatch 'mainWindow\.hide\(\)') { throw 'Launcher auto-hide call missing.' }
if ($main -notmatch "event\.type === 'state' && event\.state === 'stopped'") { throw 'Minecraft stopped lifecycle event missing.' }
if ($main -notmatch 'restoreBestiaryWindow\(\);') { throw 'Launcher restore-on-stop missing.' }
if ($main -notmatch "bestiary:keybind-get" -or $main -notmatch "bestiary:keybind-save") { throw 'Keybind IPC handlers missing.' }
if ($main -notmatch 'minecraftSessionActive') { throw 'Keybind write guard state missing.' }

if ($ipc -notmatch 'interface KeybindEntry' -or $ipc -notmatch 'getKeybinds\(\): Promise<KeybindSnapshot>') { throw 'Keybind shared IPC types missing.' }
if ($preload -notmatch 'bestiary:keybind-get' -or $preload -notmatch 'bestiary:keybind-save') { throw 'Keybind preload bridge missing.' }
if ($settings -notmatch "setTab\('controls'\)" -or $settings -notmatch '<KeybindPanel />') { throw 'Controls settings tab missing.' }

if ($keybindService -notmatch "options\.txt\.bestiary-keybind\.bak") { throw 'Keybind backup contract missing.' }
if ($keybindService -notmatch "bestiary-keybind\.tmp") { throw 'Keybind atomic save contract missing.' }
if ($keybindService -notmatch "mode === 'locked'") { throw 'Locked keybind policy integration missing.' }
if ($keybindService -notmatch 'buildConflictMap') { throw 'Keybind conflict detection missing.' }
if ($keybindPanel -notmatch 'key\.mouse\.left' -or $keybindPanel -notmatch 'key\.mouse\.right') { throw 'Canonical mouse bindings missing.' }
if ($keybindPanel -notmatch 'Xung đột' -or $keybindPanel -notmatch 'LƯU KEYBIND') { throw 'Keybind conflict/save UI missing.' }

$installer = Get-Item 'source/release/BestiaryLauncher-Setup-5.4.5.exe' -ErrorAction Stop
$unpacked = Resolve-Path 'source/release/win-unpacked'
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher 5.4.5 binary unexpectedly small.' }
if (-not (Test-Path (Join-Path $unpacked 'resources/app.asar'))) { throw 'Launcher 5.4.5 runtime is missing app.asar.' }

Write-Host '=== Smoke Launcher 5.4.5 binary ==='
$stdoutPath = "$PWD/runtime-smoke-v545-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v545-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 10
if ($proc.HasExited) {
  if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Tail 120 }
  if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 120 }
  throw "Launcher 5.4.5 exited during smoke test with code $($proc.ExitCode)."
}
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v545' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v545/diagnostic-source' | Out-Null
Copy-Item $installer.FullName 'build-output-v545/BestiaryLauncher-Setup-5.4.5.exe' -Force
$hash = (Get-FileHash 'build-output-v545/BestiaryLauncher-Setup-5.4.5.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.4.5.exe" | Set-Content 'build-output-v545/BestiaryLauncher-Setup-5.4.5-SHA256.txt' -Encoding ascii
Copy-Item $stdoutPath 'build-output-v545/runtime-smoke-stdout.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stderrPath 'build-output-v545/runtime-smoke-stderr.log' -Force -ErrorAction SilentlyContinue
Copy-Item 'source/src/main/index.ts' 'build-output-v545/diagnostic-source/index.ts' -Force
Copy-Item 'source/src/main/core/KeybindSettingsService.ts' 'build-output-v545/diagnostic-source/KeybindSettingsService.ts' -Force
Copy-Item 'source/src/renderer/src/components/KeybindPanel.tsx' 'build-output-v545/diagnostic-source/KeybindPanel.tsx' -Force

@"
version=5.4.5
sha256=$hash
baseJvmProfileRevision=544
minimumClientHeapMb=3072
autoHideOnMinecraftRunning=true
restoreLauncherOnMinecraftStop=true
keybindOptionsEditor=true
keybindConflictDetection=true
keybindMouseCapture=true
keybindLockedPolicyAware=true
keybindAtomicSave=true
keybindBackup=true
keybindWriteWhileRunningBlocked=true
"@ | Set-Content 'build-output-v545/feature-contract.txt' -Encoding ascii

Write-Host "Launcher 5.4.5 SHA256: $hash"
Write-Host 'Launcher 5.4.5 build completed.'

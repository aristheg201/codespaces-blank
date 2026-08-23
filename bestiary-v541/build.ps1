$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Rebuild verified Launcher 5.4.0 baseline ==='
& './bestiary-v540/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.4.0 baseline build failed with code $LASTEXITCODE" }

Write-Host '=== Apply 5.4.1 direct Microsoft routing fix ==='
python 'bestiary-v541/patch_v541.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.4.1 routing fix.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.4.1'
$pkg.author = 'SVFrame Team Studio'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.1 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.1 Windows build failed.' }
Pop-Location

Write-Host '=== Verify 5.4.1 Microsoft routing contracts ==='
$main = Get-Content 'source/src/main/index.ts' -Raw
$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$remote = Get-Content 'source/src/main/core/RemoteService.ts' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw

if ($main -notmatch 'microsoftDirectLaunch: true') { throw 'Microsoft direct launch is not enabled by default.' }
if ($account -notmatch "return this\.current\.mode === 'microsoft' && !this\.microsoftDirectLaunchEnabled;") { throw 'Official Launcher fallback is not gated by direct-launch=false.' }
if ($account -notmatch 'if \(!this\.microsoftDirectLaunchEnabled\) return null;') { throw 'Direct authorization guard missing.' }
if ($account -notmatch "MS_GAME_SCOPE = 'XboxLive\.signin offline_access'") { throw 'XboxLive game scope missing.' }
if ($account -notmatch 'user\.auth\.xboxlive\.com/user/authenticate') { throw 'Xbox Live exchange missing.' }
if ($account -notmatch 'xsts\.auth\.xboxlive\.com/xsts/authorize') { throw 'XSTS exchange missing.' }
if ($account -notmatch 'api\.minecraftservices\.com/authentication/login_with_xbox') { throw 'Minecraft Services login missing.' }
if ($account -notmatch 'api\.minecraftservices\.com/entitlements/mcstore') { throw 'Minecraft entitlement check missing.' }
if ($account -notmatch 'api\.minecraftservices\.com/minecraft/profile') { throw 'Minecraft profile check missing.' }
if ($main -notmatch 'officialLauncherBridge\.prepareAndOpen\(profileId, settings\)') { throw 'Official Launcher fallback path disappeared entirely.' }
if ($appSource -notmatch "currentVersion: '5\.4\.1'") { throw '5.4.1 renderer version missing.' }
if ($account -notmatch 'BestiaryLauncher/5\.4\.1' -or $remote -notmatch 'BestiaryLauncher/5\.4\.1') { throw '5.4.1 user-agent metadata missing.' }

$installer = Get-Item 'source/release/BestiaryLauncher-Setup-5.4.1.exe' -ErrorAction Stop
$unpacked = Resolve-Path 'source/release/win-unpacked'
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher 5.4.1 binary unexpectedly small.' }
if (-not (Test-Path (Join-Path $unpacked 'resources/app.asar'))) { throw 'Launcher 5.4.1 runtime is missing app.asar.' }

Write-Host '=== Smoke Launcher 5.4.1 binary ==='
$stdoutPath = "$PWD/runtime-smoke-v541-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v541-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 10
if ($proc.HasExited) {
  if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Tail 120 }
  if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 120 }
  throw "Launcher 5.4.1 exited during smoke test with code $($proc.ExitCode)."
}
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v541' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v541' | Out-Null
Copy-Item $installer.FullName 'build-output-v541/BestiaryLauncher-Setup-5.4.1.exe' -Force
$hash = (Get-FileHash 'build-output-v541/BestiaryLauncher-Setup-5.4.1.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.4.1.exe" | Set-Content 'build-output-v541/BestiaryLauncher-Setup-5.4.1-SHA256.txt' -Encoding ascii
Copy-Item $stdoutPath 'build-output-v541/runtime-smoke-stdout.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stderrPath 'build-output-v541/runtime-smoke-stderr.log' -Force -ErrorAction SilentlyContinue
Write-Host "Launcher 5.4.1 SHA256: $hash"
Write-Host 'Launcher 5.4.1 direct Microsoft routing build completed.'

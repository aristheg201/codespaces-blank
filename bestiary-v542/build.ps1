$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Rebuild verified Launcher 5.4.1 baseline ==='
& './bestiary-v541/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.4.1 baseline build failed with code $LASTEXITCODE" }

Write-Host '=== Apply 5.4.2 forced direct Microsoft runtime patch ==='
python 'bestiary-v542/patch_v542.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.4.2 direct-Microsoft patch.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.4.2'
$pkg.author = 'SVFrame Team Studio'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.2 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.2 Windows build failed.' }
Pop-Location

Write-Host '=== Verify 5.4.2 direct Microsoft runtime contracts ==='
$main = Get-Content 'source/src/main/index.ts' -Raw
$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$remote = Get-Content 'source/src/main/core/RemoteService.ts' -Raw
$bridge = Get-Content 'source/src/main/core/OfficialLauncherBridge.ts' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$updater = Get-Content 'source/src/main/core/AppUpdater.ts' -Raw

if ($account -notmatch "public shouldUseOfficialLauncher\(\): boolean \{\s*return false;\s*\}") { throw 'Official Launcher selection is not hard-disabled.' }
if ($account -notmatch "MS_GAME_SCOPE = 'XboxLive\.signin offline_access'") { throw 'XboxLive game scope missing.' }
if ($account -notmatch 'private microsoftScope\(\): string \{\s*return MS_GAME_SCOPE;\s*\}') { throw 'Microsoft scope can still fall back to identity-only OIDC.' }
if ($account -match 'if \(!this\.microsoftDirectLaunchEnabled\) return null;') { throw 'Direct authorization can still be disabled by stale runtime config.' }
if ($account -match 'microsoftDirectLaunchEnabled\s*=\s*false') { throw 'AccountService can still set direct Microsoft mode false.' }
if ($account -notmatch 'user\.auth\.xboxlive\.com/user/authenticate') { throw 'Xbox Live exchange missing.' }
if ($account -notmatch 'xsts\.auth\.xboxlive\.com/xsts/authorize') { throw 'XSTS exchange missing.' }
if ($account -notmatch 'api\.minecraftservices\.com/authentication/login_with_xbox') { throw 'Minecraft Services login exchange missing.' }
if ($account -notmatch 'api\.minecraftservices\.com/entitlements/mcstore') { throw 'Minecraft Java entitlement verification missing.' }
if ($account -notmatch 'api\.minecraftservices\.com/minecraft/profile') { throw 'Minecraft profile verification missing.' }
if ($main -notmatch 'microsoftDirectLaunch: true') { throw 'Main-process direct Microsoft default missing.' }
if ($main -notmatch 'getLaunchAuthorization\(\)') { throw 'Main process does not request direct Minecraft authorization.' }
if ($main -notmatch 'officialLauncherBridge\.prepareAndOpen') { throw 'Legacy bridge call-site unexpectedly disappeared; audit assumptions changed.' }
if ($bridge -notmatch "BESTIARY_ALLOW_OFFICIAL_LAUNCHER_BRIDGE !== '1'") { throw 'Official Launcher bridge is not fail-closed.' }
if ($bridge -notmatch 'Official Minecraft Launcher bridge is disabled in Bestiary Launcher 5\.4\.2') { throw 'Bridge fail-closed error marker missing.' }
if ($account -notmatch 'BestiaryLauncher/5\.4\.2' -or $remote -notmatch 'BestiaryLauncher/5\.4\.2') { throw '5.4.2 user-agent metadata missing.' }
if ($appSource -notmatch "currentVersion: '5\.4\.2'") { throw '5.4.2 renderer version metadata missing.' }
if ($updater -notmatch 'bestiary-distribution/main/bestiary-distribution/app-updates\.json') { throw 'Launcher updater feed contract missing.' }

$installer = Get-Item 'source/release/BestiaryLauncher-Setup-5.4.2.exe' -ErrorAction Stop
$unpacked = Resolve-Path 'source/release/win-unpacked'
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher 5.4.2 binary unexpectedly small.' }
if (-not (Test-Path (Join-Path $unpacked 'resources/app.asar'))) { throw 'Launcher 5.4.2 runtime is missing app.asar.' }

Write-Host '=== Smoke Launcher 5.4.2 binary ==='
$stdoutPath = "$PWD/runtime-smoke-v542-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v542-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 10
if ($proc.HasExited) {
  if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Tail 120 }
  if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 120 }
  throw "Launcher 5.4.2 exited during smoke test with code $($proc.ExitCode)."
}
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v542' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v542/diagnostic-source' | Out-Null
Copy-Item $installer.FullName 'build-output-v542/BestiaryLauncher-Setup-5.4.2.exe' -Force
$hash = (Get-FileHash 'build-output-v542/BestiaryLauncher-Setup-5.4.2.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.4.2.exe" | Set-Content 'build-output-v542/BestiaryLauncher-Setup-5.4.2-SHA256.txt' -Encoding ascii
Copy-Item $stdoutPath 'build-output-v542/runtime-smoke-stdout.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stderrPath 'build-output-v542/runtime-smoke-stderr.log' -Force -ErrorAction SilentlyContinue

# Keep the exact generated source used for this binary in the CI artifact so
# future routing reports can be diagnosed against the shipped code, not patch assumptions.
Copy-Item 'source/src/main/index.ts' 'build-output-v542/diagnostic-source/index.ts' -Force
Copy-Item 'source/src/main/core/AccountService.ts' 'build-output-v542/diagnostic-source/AccountService.ts' -Force
Copy-Item 'source/src/main/core/RemoteService.ts' 'build-output-v542/diagnostic-source/RemoteService.ts' -Force
Copy-Item 'source/src/main/core/OfficialLauncherBridge.ts' 'build-output-v542/diagnostic-source/OfficialLauncherBridge.ts' -Force
if (Test-Path 'source/dist-main/index.js') { Copy-Item 'source/dist-main/index.js' 'build-output-v542/diagnostic-source/dist-main-index.js' -Force }

@"
version=5.4.2
sha256=$hash
shouldUseOfficialLauncher=false
microsoftScope=MS_GAME_SCOPE
staleFlagCanDisableAuthorization=false
officialLauncherBridgeDefault=blocked
"@ | Set-Content 'build-output-v542/routing-contract.txt' -Encoding ascii

Write-Host "Launcher 5.4.2 SHA256: $hash"
Write-Host 'Launcher 5.4.2 forced direct Microsoft runtime build completed.'

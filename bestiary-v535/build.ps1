$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Build verified 5.3.3 source baseline ==='
& './bestiary-v533/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.3 baseline build failed with code $LASTEXITCODE" }

$uiSnapshot = Join-Path $env:RUNNER_TEMP 'bestiary-v533-ui'
if (-not $env:RUNNER_TEMP) { $uiSnapshot = Join-Path $PWD '.tmp-v533-ui' }
Remove-Item $uiSnapshot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $uiSnapshot | Out-Null
Copy-Item 'source/src/renderer/src/components/Home.tsx' (Join-Path $uiSnapshot 'Home.tsx') -Force
Copy-Item 'source/src/renderer/src/components/AccountScreen.tsx' (Join-Path $uiSnapshot 'AccountScreen.tsx') -Force
$baselineHome = Get-Content (Join-Path $uiSnapshot 'Home.tsx') -Raw
$baselineAccount = Get-Content (Join-Path $uiSnapshot 'AccountScreen.tsx') -Raw

Write-Host '=== Apply 5.3.4 backend official-launcher bridge ==='
python 'bestiary-v534/patch_v534.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.3.4 bridge foundation.' }

Write-Host '=== Restore exact 5.3.3 renderer UI ==='
Copy-Item (Join-Path $uiSnapshot 'Home.tsx') 'source/src/renderer/src/components/Home.tsx' -Force
Copy-Item (Join-Path $uiSnapshot 'AccountScreen.tsx') 'source/src/renderer/src/components/AccountScreen.tsx' -Force

Write-Host '=== Apply 5.3.5 Microsoft identity + official-launcher routing ==='
python 'bestiary-v535/patch_v535.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.3.5 Microsoft identity flow.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.3.5'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json

npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.5 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.5 Windows build failed.' }
Pop-Location

$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$bridge = Get-Content 'source/src/main/core/OfficialLauncherBridge.ts' -Raw
$remote = Get-Content 'source/src/main/core/RemoteService.ts' -Raw
$main = Get-Content 'source/src/main/index.ts' -Raw
$ipc = Get-Content 'source/src/shared/ipc.ts' -Raw
$homeSource = Get-Content 'source/src/renderer/src/components/Home.tsx' -Raw
$accountUi = Get-Content 'source/src/renderer/src/components/AccountScreen.tsx' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw

if ($account -notmatch "MS_IDENTITY_SCOPE = 'openid profile email offline_access'") { throw 'Microsoft identity-only scope missing.' }
if ($account -notmatch 'readMicrosoftIdentity\(response\.id_token\)') { throw 'Microsoft identity login path missing.' }
if ($account -notmatch 'if \(!this\.microsoftDirectLaunchEnabled\) return null') { throw 'Bridge mode must never mint Bestiary Minecraft authorization.' }
if ($account -notmatch 'entitlements/mcstore') { throw 'Future approved direct-MSA entitlement verification was accidentally removed.' }
if ($bridge -notmatch 'launcher_profiles\.json' -or $bridge -notmatch 'bestiary-rebirth') { throw 'Official launcher installation bridge missing.' }
if ($bridge -match 'launcher_accounts\.json|accessToken|refreshToken') { throw 'Official launcher bridge must never read or write launcher credentials.' }
if ($main -notmatch 'officialLauncherBridge\.prepareAndOpen\(profileId\)') { throw 'Microsoft Play route is not wired to official launcher.' }
if ($main -notmatch 'microsoftDirectLaunch: false') { throw 'Official-launcher bridge must remain the safe default.' }
if ($remote -notmatch 'microsoftDirectLaunch') { throw 'Remote direct-launch feature flag missing.' }
if ($ipc -notmatch 'microsoftDirectLaunch: boolean') { throw 'Renderer launch strategy metadata missing.' }
if ($appSource -notmatch "currentVersion: '5\.3\.5'") { throw 'Launcher 5.3.5 version metadata missing.' }

# UI freeze contract: AccountScreen must be byte-for-byte 5.3.3. Home may only
# change literal 5.3.3 -> 5.3.5 version text; no layout/CTA/account changes.
if ($accountUi -ne $baselineAccount) { throw 'AccountScreen UI drifted from 5.3.3.' }
$normalizedHome = $homeSource.Replace('5.3.5', '5.3.3')
if ($normalizedHome -ne $baselineHome) { throw 'Home UI drifted from 5.3.3 beyond version metadata.' }
if ($homeSource -notmatch 'CHƠI NGAY' -or $homeSource -notmatch 'CÀI CLIENT & CHƠI') { throw '5.3.3 Play CTA changed.' }
if ($accountUi -notmatch 'ĐĂNG NHẬP MICROSOFT') { throw '5.3.3 Microsoft login button missing.' }
if ($accountUi -notmatch 'MICROSOFT · ONLINE') { throw '5.3.3 Microsoft account status UI changed.' }
if ($accountUi -match '(?i)crack' -or $account -match '(?i)crack' -or $homeSource -match '(?i)crack') { throw 'Legacy crack wording returned.' }

Write-Host 'Launcher 5.3.5 flow and 5.3.3 UI contracts verified.'

$unpackedDir = Resolve-Path "$PWD/source/release/win-unpacked"
$launcherExe = Get-Item (Join-Path $unpackedDir 'Bestiary Launcher.exe') -ErrorAction Stop
$installer = Get-Item "$PWD/source/release/BestiaryLauncher-Setup-5.3.5.exe" -ErrorAction Stop
if ($installer.Length -lt 1000000) { throw "Installer unexpectedly small: $($installer.Length)" }
if ($launcherExe.Length -lt 1000000) { throw "Launcher executable unexpectedly small: $($launcherExe.Length)" }
if (-not (Test-Path (Join-Path $unpackedDir 'resources/app.asar'))) { throw 'Portable runtime is missing resources/app.asar.' }

Write-Host '=== Runtime smoke test 5.3.5 ==='
$stdoutPath = "$PWD/runtime-smoke-v535-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v535-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $launcherExe.FullName -WorkingDirectory $unpackedDir -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 12
if ($proc.HasExited) {
    Write-Host "Launcher exited during smoke test with code $($proc.ExitCode)."
    if (Test-Path $stdoutPath) { Write-Host '--- stdout ---'; Get-Content $stdoutPath -Tail 200 }
    if (Test-Path $stderrPath) { Write-Host '--- stderr ---'; Get-Content $stderrPath -Tail 200 }
    throw 'Launcher 5.3.5 failed runtime smoke test.'
}
Write-Host "Launcher 5.3.5 stayed alive for runtime smoke test. PID=$($proc.Id)"
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v535' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v535' | Out-Null
Copy-Item $installer.FullName 'build-output-v535/BestiaryLauncher-Setup-5.3.5.exe' -Force
$portableDir = "$PWD/build-output-v535/BestiaryLauncher-Portable-5.3.5"
Copy-Item $unpackedDir $portableDir -Recurse -Force
$portableZip = "$PWD/build-output-v535/BestiaryLauncher-Portable-5.3.5.zip"
Compress-Archive -Path "$portableDir/*" -DestinationPath $portableZip -CompressionLevel Optimal -Force
Remove-Item $portableDir -Recurse -Force

$installerHash = (Get-FileHash 'build-output-v535/BestiaryLauncher-Setup-5.3.5.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
$portableHash = (Get-FileHash $portableZip -Algorithm SHA256).Hash.ToLowerInvariant()
"$installerHash  BestiaryLauncher-Setup-5.3.5.exe" | Set-Content -Encoding ascii 'build-output-v535/BestiaryLauncher-Setup-5.3.5-SHA256.txt'
"$portableHash  BestiaryLauncher-Portable-5.3.5.zip" | Set-Content -Encoding ascii 'build-output-v535/BestiaryLauncher-Portable-5.3.5-SHA256.txt'
Copy-Item $stdoutPath 'build-output-v535/runtime-smoke-stdout.log' -Force
Copy-Item $stderrPath 'build-output-v535/runtime-smoke-stderr.log' -Force

$bridgeJar = Get-Item 'bestiary-skin-bridge/build/libs/bestiary-skin-bridge-1.0.0.jar' -ErrorAction Stop
Copy-Item $bridgeJar.FullName 'build-output-v535/bestiary-skin-bridge-1.0.0.jar' -Force
$bridgeHash = (Get-FileHash $bridgeJar.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
"$bridgeHash  bestiary-skin-bridge-1.0.0.jar" | Set-Content -Encoding ascii 'build-output-v535/bestiary-skin-bridge-1.0.0-SHA256.txt'

Write-Host "Installer SHA256: $installerHash"
Write-Host "Portable SHA256:  $portableHash"
Write-Host "Skin Bridge SHA256: $bridgeHash"
Write-Host 'Bestiary Launcher 5.3.5 runtime-verified Microsoft identity / official-launcher build completed.'

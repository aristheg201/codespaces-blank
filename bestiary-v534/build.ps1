$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Build verified 5.3.3 source baseline ==='
& './bestiary-v533/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.3 baseline build failed with code $LASTEXITCODE" }

Write-Host '=== Apply 5.3.4 hybrid official-launcher bridge ==='
python 'bestiary-v534/patch_v534.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.3.4 hybrid bridge.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.3.4'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json

npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.4 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.4 Windows build failed.' }
Pop-Location

$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$bridge = Get-Content 'source/src/main/core/OfficialLauncherBridge.ts' -Raw
$remote = Get-Content 'source/src/main/core/RemoteService.ts' -Raw
$main = Get-Content 'source/src/main/index.ts' -Raw
$ipc = Get-Content 'source/src/shared/ipc.ts' -Raw
$homeSource = Get-Content 'source/src/renderer/src/components/Home.tsx' -Raw
$accountUi = Get-Content 'source/src/renderer/src/components/AccountScreen.tsx' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw

if ($account -notmatch 'shouldUseOfficialLauncher') { throw 'Account launch strategy method missing.' }
if ($account -notmatch 'if \(!this\.microsoftDirectLaunchEnabled\)') { throw 'Microsoft bridge mode does not bypass Bestiary Game Services auth.' }
if ($account -notmatch 'entitlements/mcstore') { throw 'Future direct-MSA entitlement verification was accidentally removed.' }
if ($bridge -notmatch 'launcher_profiles\.json' -or $bridge -notmatch 'bestiary-rebirth') { throw 'Official launcher installation bridge missing.' }
if ($bridge -match 'launcher_accounts\.json|accessToken|refreshToken') { throw 'Official launcher bridge must never read or write launcher credentials.' }
if ($main -notmatch 'officialLauncherBridge\.prepareAndOpen\(profileId\)') { throw 'Microsoft play route is not wired to official launcher.' }
if ($main -notmatch 'microsoftDirectLaunch: false') { throw 'Bridge mode must be the safe default.' }
if ($remote -notmatch 'microsoftDirectLaunch') { throw 'Remote direct-launch feature flag missing.' }
if ($ipc -notmatch 'microsoftDirectLaunch: boolean') { throw 'Renderer launch strategy metadata missing.' }
if ($homeSource -notmatch 'MINECRAFT LAUNCHER') { throw 'Home Microsoft bridge CTA missing.' }
if ($accountUi -notmatch 'MINECRAFT LAUNCHER') { throw 'Account Microsoft bridge selector missing.' }
if ($accountUi -match '(?i)crack' -or $account -match '(?i)crack' -or $homeSource -match '(?i)crack') { throw 'Legacy crack terminology returned.' }
if ($appSource -notmatch "currentVersion: '5\.3\.4'") { throw 'Launcher 5.3.4 version metadata missing.' }

Write-Host 'Launcher 5.3.4 hybrid contracts verified.'

$unpackedDir = Resolve-Path "$PWD/source/release/win-unpacked"
$launcherExe = Get-Item (Join-Path $unpackedDir 'Bestiary Launcher.exe') -ErrorAction Stop
$installer = Get-Item "$PWD/source/release/BestiaryLauncher-Setup-5.3.4.exe" -ErrorAction Stop
if ($installer.Length -lt 1000000) { throw "Installer unexpectedly small: $($installer.Length)" }
if ($launcherExe.Length -lt 1000000) { throw "Launcher executable unexpectedly small: $($launcherExe.Length)" }
if (-not (Test-Path (Join-Path $unpackedDir 'resources/app.asar'))) { throw 'Portable runtime is missing resources/app.asar.' }

Write-Host '=== Runtime smoke test 5.3.4 ==='
$stdoutPath = "$PWD/runtime-smoke-v534-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v534-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $launcherExe.FullName -WorkingDirectory $unpackedDir -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 12
if ($proc.HasExited) {
    Write-Host "Launcher exited during smoke test with code $($proc.ExitCode)."
    if (Test-Path $stdoutPath) { Write-Host '--- stdout ---'; Get-Content $stdoutPath -Tail 200 }
    if (Test-Path $stderrPath) { Write-Host '--- stderr ---'; Get-Content $stderrPath -Tail 200 }
    throw 'Launcher 5.3.4 failed runtime smoke test.'
}
Write-Host "Launcher 5.3.4 stayed alive for runtime smoke test. PID=$($proc.Id)"
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v534' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v534' | Out-Null
Copy-Item $installer.FullName 'build-output-v534/BestiaryLauncher-Setup-5.3.4.exe' -Force
$portableDir = "$PWD/build-output-v534/BestiaryLauncher-Portable-5.3.4"
Copy-Item $unpackedDir $portableDir -Recurse -Force
$portableZip = "$PWD/build-output-v534/BestiaryLauncher-Portable-5.3.4.zip"
Compress-Archive -Path "$portableDir/*" -DestinationPath $portableZip -CompressionLevel Optimal -Force
Remove-Item $portableDir -Recurse -Force

$installerHash = (Get-FileHash 'build-output-v534/BestiaryLauncher-Setup-5.3.4.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
$portableHash = (Get-FileHash $portableZip -Algorithm SHA256).Hash.ToLowerInvariant()
"$installerHash  BestiaryLauncher-Setup-5.3.4.exe" | Set-Content -Encoding ascii 'build-output-v534/BestiaryLauncher-Setup-5.3.4-SHA256.txt'
"$portableHash  BestiaryLauncher-Portable-5.3.4.zip" | Set-Content -Encoding ascii 'build-output-v534/BestiaryLauncher-Portable-5.3.4-SHA256.txt'
Copy-Item $stdoutPath 'build-output-v534/runtime-smoke-stdout.log' -Force
Copy-Item $stderrPath 'build-output-v534/runtime-smoke-stderr.log' -Force

$bridgeJar = Get-Item 'bestiary-skin-bridge/build/libs/bestiary-skin-bridge-1.0.0.jar' -ErrorAction Stop
Copy-Item $bridgeJar.FullName 'build-output-v534/bestiary-skin-bridge-1.0.0.jar' -Force
$bridgeHash = (Get-FileHash $bridgeJar.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
"$bridgeHash  bestiary-skin-bridge-1.0.0.jar" | Set-Content -Encoding ascii 'build-output-v534/bestiary-skin-bridge-1.0.0-SHA256.txt'

Write-Host "Installer SHA256: $installerHash"
Write-Host "Portable SHA256:  $portableHash"
Write-Host "Skin Bridge SHA256: $bridgeHash"
Write-Host 'Bestiary Launcher 5.3.4 runtime-verified hybrid build completed.'

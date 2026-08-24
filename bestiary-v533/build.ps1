$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Build verified 5.3.2 source baseline ==='
& './bestiary-v532/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.2 baseline build failed with code $LASTEXITCODE" }

Write-Host '=== Apply 5.3.3 local/offline identity policy hotfix ==='
python 'bestiary-v533/patch_v533.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.3.3 local/offline identity hotfix.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.3.3'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json

npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.3 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.3 Windows build failed.' }
Pop-Location

$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$accountUi = Get-Content 'source/src/renderer/src/components/AccountScreen.tsx' -Raw
$homeSource = Get-Content 'source/src/renderer/src/components/Home.tsx' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$main = Get-Content 'source/src/main/index.ts' -Raw

if ($accountUi -notmatch 'LOCAL / OFFLINE' -or $accountUi -notmatch 'DÙNG PROFILE LOCAL') { throw 'Local/offline account UI wording missing.' }
if ($accountUi -match '(?i)crack' -or $account -match '(?i)crack' -or $homeSource -match '(?i)crack') { throw 'Legacy crack terminology remains in Launcher UI/runtime.' }
if ($account -notmatch "if \(this\.current\.mode !== 'microsoft'\) return null;") { throw 'Local/offline launch is not isolated from Microsoft authorization.' }
if ($account -notmatch 'Skin local/offline') { throw 'Local/offline skin bridge messaging missing.' }
if ($homeSource -notmatch 'Local / Offline · Microsoft chính chủ') { throw 'Home local/offline account label missing.' }
if ($appSource -notmatch "currentVersion: '5\.3\.3'") { throw 'Launcher 5.3.3 version metadata missing.' }
if ($main -notmatch "authorization: authorization \?\? undefined") { throw 'Account-aware launch path missing.' }
Write-Host 'Launcher 5.3.3 local/offline identity isolation and terminology contracts verified.'

$unpackedDir = Resolve-Path "$PWD/source/release/win-unpacked"
$launcherExe = Get-Item (Join-Path $unpackedDir 'Bestiary Launcher.exe') -ErrorAction Stop
$installer = Get-Item "$PWD/source/release/BestiaryLauncher-Setup-5.3.3.exe" -ErrorAction Stop
if ($installer.Length -lt 1000000) { throw "Installer unexpectedly small: $($installer.Length)" }
if ($launcherExe.Length -lt 1000000) { throw "Launcher executable unexpectedly small: $($launcherExe.Length)" }
if (-not (Test-Path (Join-Path $unpackedDir 'resources/app.asar'))) { throw 'Portable runtime is missing resources/app.asar.' }

Write-Host '=== Runtime smoke test 5.3.3 ==='
$stdoutPath = "$PWD/runtime-smoke-v533-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v533-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $launcherExe.FullName -WorkingDirectory $unpackedDir -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 12
if ($proc.HasExited) {
    Write-Host "Launcher exited during smoke test with code $($proc.ExitCode)."
    if (Test-Path $stdoutPath) { Write-Host '--- stdout ---'; Get-Content $stdoutPath -Tail 200 }
    if (Test-Path $stderrPath) { Write-Host '--- stderr ---'; Get-Content $stderrPath -Tail 200 }
    throw 'Launcher 5.3.3 failed runtime smoke test.'
}
Write-Host "Launcher 5.3.3 stayed alive for runtime smoke test. PID=$($proc.Id)"
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v533' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v533' | Out-Null
Copy-Item $installer.FullName 'build-output-v533/BestiaryLauncher-Setup-5.3.3.exe' -Force
$portableDir = "$PWD/build-output-v533/BestiaryLauncher-Portable-5.3.3"
Copy-Item $unpackedDir $portableDir -Recurse -Force
$portableZip = "$PWD/build-output-v533/BestiaryLauncher-Portable-5.3.3.zip"
Compress-Archive -Path "$portableDir/*" -DestinationPath $portableZip -CompressionLevel Optimal -Force
Remove-Item $portableDir -Recurse -Force

$installerHash = (Get-FileHash 'build-output-v533/BestiaryLauncher-Setup-5.3.3.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
$portableHash = (Get-FileHash $portableZip -Algorithm SHA256).Hash.ToLowerInvariant()
"$installerHash  BestiaryLauncher-Setup-5.3.3.exe" | Set-Content -Encoding ascii 'build-output-v533/BestiaryLauncher-Setup-5.3.3-SHA256.txt'
"$portableHash  BestiaryLauncher-Portable-5.3.3.zip" | Set-Content -Encoding ascii 'build-output-v533/BestiaryLauncher-Portable-5.3.3-SHA256.txt'
Copy-Item $stdoutPath 'build-output-v533/runtime-smoke-stdout.log' -Force
Copy-Item $stderrPath 'build-output-v533/runtime-smoke-stderr.log' -Force

$bridgeJar = Get-Item 'bestiary-skin-bridge/build/libs/bestiary-skin-bridge-1.0.0.jar' -ErrorAction Stop
Copy-Item $bridgeJar.FullName 'build-output-v533/bestiary-skin-bridge-1.0.0.jar' -Force
$bridgeHash = (Get-FileHash $bridgeJar.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
"$bridgeHash  bestiary-skin-bridge-1.0.0.jar" | Set-Content -Encoding ascii 'build-output-v533/bestiary-skin-bridge-1.0.0-SHA256.txt'

Write-Host "Installer SHA256: $installerHash"
Write-Host "Portable SHA256:  $portableHash"
Write-Host "Skin Bridge SHA256: $bridgeHash"
Write-Host 'Bestiary Launcher 5.3.3 runtime-verified build completed.'

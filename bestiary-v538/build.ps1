$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Build verified 5.3.7 baseline ==='
& './bestiary-v537/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.7 baseline build failed with code $LASTEXITCODE" }

Write-Host '=== Apply 5.3.8 Microsoft RAM/JVM bridge fix ==='
python 'bestiary-v538/patch_v538.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.3.8 Microsoft runtime bridge fix.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.3.8'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.8 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.8 Windows build failed.' }
Pop-Location

$bridge = Get-Content 'source/src/main/core/OfficialLauncherBridge.ts' -Raw
$main = Get-Content 'source/src/main/index.ts' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$remote = Get-Content 'source/src/main/core/RemoteService.ts' -Raw

if ($bridge -notmatch 'buildOfficialLauncherJavaArgs') { throw 'Official launcher JVM serializer missing.' }
if ($bridge -notmatch 'DEFAULT_BRIDGE_JVM_ARGS') { throw 'Official launcher default JVM parity missing.' }
if ($bridge -notmatch '`-Xms\$\{minRamMb\}M`' -or $bridge -notmatch '`-Xmx\$\{maxRamMb\}M`') { throw 'Official launcher RAM flags missing.' }
if ($bridge -notmatch 'settings\.generatedJvmArgs') { throw 'Generated JVM flags are not synced to the official launcher.' }
if ($bridge -notmatch 'javaArgs,') { throw 'Bestiary installation does not persist javaArgs.' }
if ($bridge -notmatch 'prepareAndOpen\(profileId: string, settings: LauncherSettings\)') { throw 'Bridge does not accept Launcher settings.' }
if ($bridge -match 'launcher_accounts\.json|accessToken|refreshToken') { throw 'Official launcher bridge must never read or write launcher credentials.' }
if ($main -notmatch 'officialLauncherBridge\.prepareAndOpen\(profileId, settings\)') { throw 'Microsoft Play route does not pass settings to the bridge.' }
if ($appSource -notmatch "currentVersion: '5\.3\.8'") { throw 'Launcher 5.3.8 version metadata missing.' }
if ($account -notmatch 'BestiaryLauncher/5\.3\.8' -or $remote -notmatch 'BestiaryLauncher/5\.3\.8') { throw 'Launcher 5.3.8 user-agent metadata missing.' }

# Confirm bridge defaults stay aligned with MinecraftLauncher.resolveJvmArgs().
$launcher = Get-Content 'source/src/main/core/Launcher.ts' -Raw
$requiredJvm = @(
  '-XX:+UseG1GC',
  '-XX:+ParallelRefProcEnabled',
  '-XX:MaxGCPauseMillis=100',
  '-XX:+DisableExplicitGC',
  '-XX:+PerfDisableSharedMem',
  '-Dfile.encoding=UTF-8',
  '-Djava.awt.headless=false',
  '-Dlog4j2.formatMsgNoLookups=true'
)
foreach($arg in $requiredJvm) {
  if(-not $launcher.Contains($arg) -or -not $bridge.Contains($arg)) { throw "JVM parity contract missing: $arg" }
}

$installer = Get-Item 'source/release/BestiaryLauncher-Setup-5.3.8.exe' -ErrorAction Stop
$unpacked = Resolve-Path 'source/release/win-unpacked'
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher 5.3.8 binary unexpectedly small.' }

# Smoke the patched binary itself. Baseline 5.3.7 already performs the full installed
# lifecycle suite; this verifies the rebuilt 5.3.8 executable still boots normally.
$stdoutPath = "$PWD/runtime-smoke-v538-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v538-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING='1'
$proc = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 10
if($proc.HasExited) {
  if(Test-Path $stdoutPath){Get-Content $stdoutPath -Tail 120}
  if(Test-Path $stderrPath){Get-Content $stderrPath -Tail 120}
  throw "Launcher 5.3.8 exited during smoke test with code $($proc.ExitCode)."
}
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v538' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v538' | Out-Null
Copy-Item $installer.FullName 'build-output-v538/BestiaryLauncher-Setup-5.3.8.exe' -Force
$hash = (Get-FileHash 'build-output-v538/BestiaryLauncher-Setup-5.3.8.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.3.8.exe" | Set-Content -Encoding ascii 'build-output-v538/BestiaryLauncher-Setup-5.3.8-SHA256.txt'
Copy-Item $stdoutPath 'build-output-v538/runtime-smoke-stdout.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stderrPath 'build-output-v538/runtime-smoke-stderr.log' -Force -ErrorAction SilentlyContinue
Write-Host "Launcher 5.3.8 SHA256: $hash"
Write-Host 'Launcher 5.3.8 Microsoft RAM/JVM bridge build completed.'

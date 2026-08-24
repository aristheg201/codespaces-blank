$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Rebuild verified Launcher 5.4.2 baseline ==='
& './bestiary-v542/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.4.2 baseline build failed with code $LASTEXITCODE" }

Write-Host '=== Apply 5.4.3 lifecycle fix ==='
python 'bestiary-v543/patch_v543.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.4.3 lifecycle patch.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.4.3'
$pkg.author = 'SVFrame Team Studio'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.3 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.3 Windows build failed.' }
Pop-Location

Write-Host '=== Verify 5.4.3 lifecycle source contracts ==='
$main = Get-Content 'source/src/main/index.ts' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$remote = Get-Content 'source/src/main/core/RemoteService.ts' -Raw

$lockCount = ([regex]::Matches($main, 'app\.requestSingleInstanceLock\(\)')).Count
if ($lockCount -ne 1) { throw "Expected exactly one requestSingleInstanceLock(), found $lockCount." }
if ($main -notmatch "app\.on\('second-instance', \(\) => \{\s*restoreBestiaryWindow\(\);\s*\}\);") { throw 'Second-instance restore contract missing.' }
if ($main -notmatch "app\.on\('activate', \(\) => \{\s*restoreBestiaryWindow\(\);\s*\}\);") { throw 'Activate restore contract missing.' }
if ($main -notmatch 'if \(!mainWindow \|\| mainWindow\.isDestroyed\(\)\) \{\s*createWindow\(\);') { throw 'Destroyed-window recreation contract missing.' }
if ($main -notmatch 'if \(!mainWindow\.isVisible\(\)\) mainWindow\.show\(\);') { throw 'Hidden-window show contract missing.' }
if ($main -notmatch "app\.on\('window-all-closed', \(\) => \{\s*if \(process\.platform !== 'darwin'\) \{\s*isQuitting = true;\s*app\.exit\(0\);") { throw 'Deterministic Windows/Linux close contract missing.' }
if ($main -match 'gotSingleInstanceLock') { throw 'Duplicate single-instance state survived.' }
if ($appSource -notmatch "currentVersion: '5\.4\.3'") { throw '5.4.3 renderer version metadata missing.' }
if ($account -notmatch 'BestiaryLauncher/5\.4\.3' -or $remote -notmatch 'BestiaryLauncher/5\.4\.3') { throw '5.4.3 user-agent metadata missing.' }

$installer = Get-Item 'source/release/BestiaryLauncher-Setup-5.4.3.exe' -ErrorAction Stop
$unpacked = Resolve-Path 'source/release/win-unpacked'
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher 5.4.3 binary unexpectedly small.' }
if (-not (Test-Path (Join-Path $unpacked 'resources/app.asar'))) { throw 'Launcher 5.4.3 runtime is missing app.asar.' }

function Get-BestiaryProcesses {
  @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'Bestiary*' })
}

function Wait-BestiaryWindow([int]$ProcessId, [int]$TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($process) {
      $process.Refresh()
      if ($process.MainWindowHandle -ne 0) { return $process }
    }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return $null
}

function Wait-NoBestiaryProcesses([int]$TimeoutSeconds = 15) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $remaining = Get-BestiaryProcesses
    if ($remaining.Count -eq 0) { return $true }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return $false
}

Write-Host '=== Runtime lifecycle test: open -> close -> process gone -> reopen ==='
Get-BestiaryProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

$stdout1 = "$PWD/runtime-lifecycle-v543-first-stdout.log"
$stderr1 = "$PWD/runtime-lifecycle-v543-first-stderr.log"
$stdout2 = "$PWD/runtime-lifecycle-v543-second-stdout.log"
$stderr2 = "$PWD/runtime-lifecycle-v543-second-stderr.log"
Remove-Item $stdout1,$stderr1,$stdout2,$stderr2 -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'

$first = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdout1 -RedirectStandardError $stderr1 -PassThru
$firstWindow = Wait-BestiaryWindow -ProcessId $first.Id
if (-not $firstWindow) {
  if (Test-Path $stdout1) { Get-Content $stdout1 -Tail 120 }
  if (Test-Path $stderr1) { Get-Content $stderr1 -Tail 120 }
  throw 'First 5.4.3 launch never created a visible main window.'
}
Write-Host "First launcher window ready: PID=$($firstWindow.Id) HWND=$($firstWindow.MainWindowHandle)"

if (-not $firstWindow.CloseMainWindow()) { throw 'Unable to send WM_CLOSE to first launcher window.' }
if (-not (Wait-NoBestiaryProcesses)) {
  Get-BestiaryProcesses | Format-Table Id,ProcessName,MainWindowHandle -AutoSize
  throw 'Launcher processes remained after closing the final window.'
}
Write-Host 'First launcher instance exited cleanly after window close.'

$second = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdout2 -RedirectStandardError $stderr2 -PassThru
$secondWindow = Wait-BestiaryWindow -ProcessId $second.Id
if (-not $secondWindow) {
  if (Test-Path $stdout2) { Get-Content $stdout2 -Tail 120 }
  if (Test-Path $stderr2) { Get-Content $stderr2 -Tail 120 }
  throw 'Launcher failed to create a visible window after close-and-reopen.'
}
Write-Host "Second launcher window ready: PID=$($secondWindow.Id) HWND=$($secondWindow.MainWindowHandle)"

Write-Host '=== Runtime single-instance test: second invocation restores existing UI ==='
$secondInvocation = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -PassThru
Start-Sleep -Seconds 2
if (-not $secondInvocation.HasExited) {
  Stop-Process -Id $secondInvocation.Id -Force -ErrorAction SilentlyContinue
  throw 'Second invocation did not yield to the existing single instance.'
}
$secondWindow.Refresh()
if ($secondWindow.MainWindowHandle -eq 0) { throw 'Existing launcher lost its visible window after second invocation.' }

Get-BestiaryProcesses | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

Remove-Item 'build-output-v543' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v543/diagnostic-source' | Out-Null
Copy-Item $installer.FullName 'build-output-v543/BestiaryLauncher-Setup-5.4.3.exe' -Force
$hash = (Get-FileHash 'build-output-v543/BestiaryLauncher-Setup-5.4.3.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.4.3.exe" | Set-Content 'build-output-v543/BestiaryLauncher-Setup-5.4.3-SHA256.txt' -Encoding ascii
Copy-Item $stdout1 'build-output-v543/runtime-lifecycle-first-stdout.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stderr1 'build-output-v543/runtime-lifecycle-first-stderr.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stdout2 'build-output-v543/runtime-lifecycle-second-stdout.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stderr2 'build-output-v543/runtime-lifecycle-second-stderr.log' -Force -ErrorAction SilentlyContinue
Copy-Item 'source/src/main/index.ts' 'build-output-v543/diagnostic-source/index.ts' -Force
Copy-Item 'source/src/main/core/AccountService.ts' 'build-output-v543/diagnostic-source/AccountService.ts' -Force
Copy-Item 'source/src/main/core/RemoteService.ts' 'build-output-v543/diagnostic-source/RemoteService.ts' -Force

@"
version=5.4.3
sha256=$hash
singleInstanceLockCount=$lockCount
secondInstanceRestoresWindow=true
activateRestoresWindow=true
lastWindowForcesExit=true
closeReopenRuntimeVerified=true
secondInvocationRuntimeVerified=true
"@ | Set-Content 'build-output-v543/lifecycle-contract.txt' -Encoding ascii

Write-Host "Launcher 5.4.3 SHA256: $hash"
Write-Host 'Launcher 5.4.3 lifecycle build completed.'

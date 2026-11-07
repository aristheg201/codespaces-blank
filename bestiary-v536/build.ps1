$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Build verified 5.3.5 baseline ==='
& './bestiary-v535/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.5 baseline build failed with code $LASTEXITCODE" }

Write-Host '=== Apply 5.3.6 lifecycle hotfix ==='
python 'bestiary-v536/patch_v536.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.3.6 lifecycle hotfix.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.3.6'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.6 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.6 Windows build failed.' }
Pop-Location

$main = Get-Content 'source/src/main/index.ts' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$homeSource = Get-Content 'source/src/renderer/src/components/Home.tsx' -Raw

if ($main -notmatch 'requestSingleInstanceLock') { throw 'Single-instance lock missing.' }
if ($main -notmatch "app\.on\('second-instance'" -or $main -notmatch 'restoreBestiaryWindow') { throw 'Second-instance restore missing.' }
if ($main -notmatch "app\.on\('window-all-closed'" -or $main -notmatch "process\.platform !== 'darwin'") { throw 'Windows close-to-exit lifecycle missing.' }
if ($main -notmatch 'mainWindow\.isDestroyed\(\)' -or $main -notmatch 'mainWindow\.restore\(\)' -or $main -notmatch 'mainWindow\.show\(\)' -or $main -notmatch 'mainWindow\.focus\(\)') { throw 'Window recreation/restore/focus contract missing.' }
if ($main -match "preventDefault\(\)[\s\S]{0,300}mainWindow(?:\?)?\.hide\(\)") { throw 'Zombie close-to-hide handler remains.' }
if ($appSource -notmatch "currentVersion: '5\.3\.6'" -or $homeSource -notmatch '5\.3\.6') { throw '5.3.6 renderer version metadata missing.' }
Write-Host '5.3.6 source lifecycle contracts verified.'

$unpackedDir = Resolve-Path "$PWD/source/release/win-unpacked"
$launcherExe = Get-Item (Join-Path $unpackedDir 'Bestiary Launcher.exe') -ErrorAction Stop
$installer = Get-Item "$PWD/source/release/BestiaryLauncher-Setup-5.3.6.exe" -ErrorAction Stop
if ($installer.Length -lt 1000000) { throw "Installer unexpectedly small: $($installer.Length)" }
if ($launcherExe.Length -lt 1000000) { throw "Launcher executable unexpectedly small: $($launcherExe.Length)" }

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BestiaryWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
}
'@

function Get-MainWindowForProcess([int]$ProcessId) {
  $script:foundWindow = [IntPtr]::Zero
  [BestiaryWin32]::EnumWindows({
    param([IntPtr]$hWnd, [IntPtr]$lParam)
    [uint32]$windowPid = 0
    [void][BestiaryWin32]::GetWindowThreadProcessId($hWnd, [ref]$windowPid)
    if ($windowPid -eq $ProcessId -and [BestiaryWin32]::IsWindowVisible($hWnd)) {
      $script:foundWindow = $hWnd
      return $false
    }
    return $true
  }, [IntPtr]::Zero) | Out-Null
  return $script:foundWindow
}

function Wait-VisibleWindow([System.Diagnostics.Process]$Process, [int]$TimeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    if ($Process.HasExited) { throw "Launcher exited before showing a window. Code=$($Process.ExitCode)" }
    $hwnd = Get-MainWindowForProcess $Process.Id
    if ($hwnd -ne [IntPtr]::Zero) { return $hwnd }
    Start-Sleep -Milliseconds 300
  } while ((Get-Date) -lt $deadline)
  throw "Launcher PID=$($Process.Id) did not create a visible window."
}

Write-Host '=== Lifecycle test: close must terminate process ==='
$env:ELECTRON_ENABLE_LOGGING = '1'
$first = Start-Process -FilePath $launcherExe.FullName -WorkingDirectory $unpackedDir -ArgumentList @('--enable-logging','--disable-gpu') -PassThru
$firstWindow = Wait-VisibleWindow $first
Write-Host "First launch PID=$($first.Id), HWND=$firstWindow"
[void][BestiaryWin32]::PostMessage($firstWindow, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
if (-not $first.WaitForExit(12000)) {
  Stop-Process -Id $first.Id -Force -ErrorAction SilentlyContinue
  throw 'WM_CLOSE removed the window but Bestiary Launcher process stayed alive.'
}
Write-Host 'Close-to-exit test passed.'

Write-Host '=== Lifecycle test: reopen after close ==='
$reopened = Start-Process -FilePath $launcherExe.FullName -WorkingDirectory $unpackedDir -ArgumentList @('--enable-logging','--disable-gpu') -PassThru
$reopenedWindow = Wait-VisibleWindow $reopened
Write-Host "Reopen PID=$($reopened.Id), HWND=$reopenedWindow"

Write-Host '=== Lifecycle test: second instance must hand off to first ==='
$second = Start-Process -FilePath $launcherExe.FullName -WorkingDirectory $unpackedDir -ArgumentList @('--enable-logging','--disable-gpu') -PassThru
if (-not $second.WaitForExit(8000)) {
  Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $reopened.Id -Force -ErrorAction SilentlyContinue
  throw 'Second launcher instance did not exit after single-instance handoff.'
}
if ($reopened.HasExited) { throw 'Primary launcher exited during second-instance handoff.' }
$reopenedWindow2 = Wait-VisibleWindow $reopened
if ($reopenedWindow2 -eq [IntPtr]::Zero) { throw 'Primary launcher has no visible window after second-instance handoff.' }
Write-Host 'Second-instance restore/focus test passed.'

[void][BestiaryWin32]::PostMessage($reopenedWindow2, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
if (-not $reopened.WaitForExit(12000)) {
  Stop-Process -Id $reopened.Id -Force -ErrorAction SilentlyContinue
  throw 'Reopened launcher did not terminate cleanly on close.'
}

Remove-Item 'build-output-v536' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v536' | Out-Null
Copy-Item $installer.FullName 'build-output-v536/BestiaryLauncher-Setup-5.3.6.exe' -Force
$portableDir = "$PWD/build-output-v536/BestiaryLauncher-Portable-5.3.6"
Copy-Item $unpackedDir $portableDir -Recurse -Force
$portableZip = "$PWD/build-output-v536/BestiaryLauncher-Portable-5.3.6.zip"
Compress-Archive -Path "$portableDir/*" -DestinationPath $portableZip -CompressionLevel Optimal -Force
Remove-Item $portableDir -Recurse -Force

$installerHash = (Get-FileHash 'build-output-v536/BestiaryLauncher-Setup-5.3.6.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
$portableHash = (Get-FileHash $portableZip -Algorithm SHA256).Hash.ToLowerInvariant()
"$installerHash  BestiaryLauncher-Setup-5.3.6.exe" | Set-Content -Encoding ascii 'build-output-v536/BestiaryLauncher-Setup-5.3.6-SHA256.txt'
"$portableHash  BestiaryLauncher-Portable-5.3.6.zip" | Set-Content -Encoding ascii 'build-output-v536/BestiaryLauncher-Portable-5.3.6-SHA256.txt'

Write-Host "Installer SHA256: $installerHash"
Write-Host "Portable SHA256:  $portableHash"
Write-Host 'Bestiary Launcher 5.3.6 lifecycle-verified build completed.'

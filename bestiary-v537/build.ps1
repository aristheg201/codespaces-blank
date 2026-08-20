$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Build verified 5.3.6 baseline ==='
& './bestiary-v536/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.6 baseline build failed with code $LASTEXITCODE" }

Copy-Item 'bestiary-v537/KeybindPolicyService.ts' 'source/src/main/core/KeybindPolicyService.ts' -Force
python 'bestiary-v537/patch_v537.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.3.7 patch.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.3.7'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.7 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.7 Windows build failed.' }
Pop-Location

$main = Get-Content 'source/src/main/index.ts' -Raw
$keybind = Get-Content 'source/src/main/core/KeybindPolicyService.ts' -Raw
$css = Get-Content 'source/src/renderer/src/components/Home.css' -Raw
if ($main -notmatch 'if \(!gotSingleInstanceLock\)[\s\S]{0,80}app\.exit\(0\)') { throw 'Rejected Launcher instance does not hard-exit.' }
if ($main -notmatch 'await keybindPolicyService\.apply\(\)') { throw 'Keybind policy is not applied before launch.' }
if ($keybind -notmatch 'keybind-state\.json' -or $keybind -notmatch "mode === 'locked'" -or $keybind -notmatch 'previous\.observedValue') { throw 'Keybind merge/state contract missing.' }
if ($css -notmatch '\.bestiary-home[\s\S]{0,160}overflow-y:\s*auto' -or $css -notmatch 'scrollbar-gutter:\s*stable') { throw 'Desktop scrollbar contract missing.' }

$unpacked = Resolve-Path 'source/release/win-unpacked'
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
$installer = Get-Item 'source/release/BestiaryLauncher-Setup-5.3.7.exe' -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher binary unexpectedly small.' }

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Bestiary537Win32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);
}
'@
function Get-VisibleWindow([int]$ProcessId) {
  $script:found=[IntPtr]::Zero
  [Bestiary537Win32]::EnumWindows({param($h,$l);[uint32]$wp=0;[void][Bestiary537Win32]::GetWindowThreadProcessId($h,[ref]$wp);if($wp -eq $ProcessId -and [Bestiary537Win32]::IsWindowVisible($h)){$script:found=$h;return $false};return $true},[IntPtr]::Zero)|Out-Null
  return $script:found
}
function Wait-Window([System.Diagnostics.Process]$Process,[int]$Seconds=25) {
  $deadline=(Get-Date).AddSeconds($Seconds)
  do { if($Process.HasExited){throw "Launcher exited before UI. code=$($Process.ExitCode)"};$h=Get-VisibleWindow $Process.Id;if($h -ne [IntPtr]::Zero){return $h};Start-Sleep -Milliseconds 250 } while((Get-Date)-lt $deadline)
  throw "Launcher PID=$($Process.Id) did not show a window."
}
function Get-ProcessesUnder([string]$Directory) {
  $prefix=[IO.Path]::GetFullPath($Directory).TrimEnd('\\')+'\\'
  @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath).StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)) })
}
function Wait-NoProcessesUnder([string]$Directory,[int]$Seconds=15) {
  $deadline=(Get-Date).AddSeconds($Seconds)
  do { $left=Get-ProcessesUnder $Directory;if($left.Count -eq 0){return};Start-Sleep -Milliseconds 300 } while((Get-Date)-lt $deadline)
  $detail=(Get-ProcessesUnder $Directory | ForEach-Object { "PID=$($_.ProcessId) $($_.Name) cmd=$($_.CommandLine)" }) -join "`n"
  throw "Launcher process tree survived close:`n$detail"
}
function Exercise-Launcher([string]$Executable,[string]$WorkingDirectory) {
  for($round=1;$round -le 3;$round++){
    Write-Host "Lifecycle round $round: open -> close -> zero process tree"
    $p=Start-Process -FilePath $Executable -WorkingDirectory $WorkingDirectory -ArgumentList @('--enable-logging','--disable-gpu') -PassThru
    $h=Wait-Window $p
    [void][Bestiary537Win32]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
    if(-not $p.WaitForExit(12000)){Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue;throw 'Primary Launcher process stayed alive after WM_CLOSE.'}
    Wait-NoProcessesUnder $WorkingDirectory
  }
  Write-Host 'Second-instance handoff test'
  $primary=Start-Process -FilePath $Executable -WorkingDirectory $WorkingDirectory -ArgumentList @('--enable-logging','--disable-gpu') -PassThru
  $h=Wait-Window $primary
  $second=Start-Process -FilePath $Executable -WorkingDirectory $WorkingDirectory -ArgumentList @('--enable-logging','--disable-gpu') -PassThru
  if(-not $second.WaitForExit(6000)){Stop-Process -Id $second.Id -Force -ErrorAction SilentlyContinue;throw 'Rejected second Launcher instance stayed alive.'}
  if($primary.HasExited){throw 'Primary Launcher exited during handoff.'}
  $h=Wait-Window $primary
  [void][Bestiary537Win32]::PostMessage($h,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)
  if(-not $primary.WaitForExit(12000)){Stop-Process -Id $primary.Id -Force -ErrorAction SilentlyContinue;throw 'Primary Launcher stayed alive after handoff close.'}
  Wait-NoProcessesUnder $WorkingDirectory
}

$env:ELECTRON_ENABLE_LOGGING='1'
Write-Host '=== Portable lifecycle verification ==='
Exercise-Launcher $exe.FullName $unpacked

Write-Host '=== Installed NSIS lifecycle verification ==='
$before=@(Get-ChildItem $env:LOCALAPPDATA\Programs -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName)
$installProc=Start-Process -FilePath $installer.FullName -ArgumentList '/S' -PassThru
if(-not $installProc.WaitForExit(120000)){Stop-Process -Id $installProc.Id -Force -ErrorAction SilentlyContinue;throw 'Silent NSIS install timed out.'}
Start-Sleep -Seconds 2
$candidates=Get-ChildItem $env:LOCALAPPDATA\Programs -Filter 'Bestiary Launcher.exe' -Recurse -File -ErrorAction SilentlyContinue
$installedExe=$candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
if(-not $installedExe){throw 'Unable to locate installed Bestiary Launcher.exe after NSIS install.'}
Exercise-Launcher $installedExe.FullName $installedExe.Directory.FullName

Remove-Item 'build-output-v537' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v537' | Out-Null
Copy-Item $installer.FullName 'build-output-v537/BestiaryLauncher-Setup-5.3.7.exe' -Force
$hash=(Get-FileHash 'build-output-v537/BestiaryLauncher-Setup-5.3.7.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.3.7.exe" | Set-Content -Encoding ascii 'build-output-v537/BestiaryLauncher-Setup-5.3.7-SHA256.txt'
Write-Host "Launcher 5.3.7 SHA256: $hash"
Write-Host 'Launcher 5.3.7 lifecycle/process-tree/scroll/keybind build completed.'

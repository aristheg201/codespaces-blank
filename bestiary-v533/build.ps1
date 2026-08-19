$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

# Reuse the proven 5.3.2 composition, then apply the 5.3.3 local/offline terminology hotfix.
$source = Get-Content './bestiary-v532/build.ps1' -Raw
$source = $source.Replace('5.3.2', '5.3.3').Replace('build-output-v532', 'build-output-v533')

$needle = "python 'bestiary-v532/patch_v532.py'"
if (-not $source.Contains($needle)) { throw '5.3.2 patch marker missing from build composition.' }
$replacement = $needle + "`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to apply fresh remote/account configuration hotfix.' }`n" +
  "python 'bestiary-v533/patch_v533.py'"
$source = $source.Replace($needle + "`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to apply fresh remote/account configuration hotfix.' }", $replacement)

$generated = Join-Path $PSScriptRoot 'generated-v533.ps1'
Set-Content $generated $source -Encoding UTF8
& $generated
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.3 build composition failed with code $LASTEXITCODE" }

$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$accountUi = Get-Content 'source/src/renderer/src/components/AccountScreen.tsx' -Raw
$homeSource = Get-Content 'source/src/renderer/src/components/Home.tsx' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw

if ($accountUi -notmatch 'LOCAL / OFFLINE' -or $accountUi -notmatch 'DÙNG PROFILE LOCAL') { throw 'Local/offline account UI wording missing.' }
if ($accountUi -match '(?i)crack' -or $account -match '(?i)crack' -or $homeSource -match '(?i)crack') { throw 'Legacy crack terminology remains in Launcher UI/runtime.' }
if ($account -notmatch "if \(this\.current\.mode !== 'microsoft'\) return null;") { throw 'Local/offline launch is not isolated from Microsoft authorization.' }
if ($account -notmatch 'Skin local/offline') { throw 'Local/offline skin bridge messaging missing.' }
if ($homeSource -notmatch 'Local / Offline · Microsoft chính chủ') { throw 'Home local/offline account label missing.' }
if ($appSource -notmatch "currentVersion: '5\.3\.3'") { throw 'Launcher 5.3.3 version metadata missing.' }

Write-Host 'Launcher 5.3.3 local/offline identity isolation and terminology contracts verified.'

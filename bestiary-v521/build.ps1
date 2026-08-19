$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$source = Get-Content './bestiary-v520/build.ps1' -Raw
$source = $source.Replace('5.2.0', '5.2.1').Replace('build-output-v520', 'build-output-v521')

$homePatch = "python 'bestiary-v520/patch_home.py'"
if (-not $source.Contains($homePatch)) { throw 'Launcher Home patch command missing.' }
$source = $source.Replace($homePatch, $homePatch + "`npython 'bestiary-v521/patch_home.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to apply prominent mod manager entry.' }")

$generated = Join-Path $PSScriptRoot 'generated-build.ps1'
Set-Content $generated $source -Encoding UTF8
& $generated
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.2.1 generated build failed with code $LASTEXITCODE" }

$home = Get-Content 'source/src/renderer/src/components/Home.tsx' -Raw
$app = Get-Content 'source/src/renderer/src/App.tsx' -Raw
if ($home -notmatch 'QUẢN LÝ MOD' -or $home -notmatch 'MỞ QUẢN LÝ' -or $home -notmatch 'bestiary-mod-manager') { throw 'Prominent mod manager Home entry missing.' }
if ($app -notmatch "currentVersion: '5.2.1'") { throw 'Launcher 5.2.1 updater version missing.' }
Write-Host 'Launcher 5.2.1 prominent mod manager entry verified.'

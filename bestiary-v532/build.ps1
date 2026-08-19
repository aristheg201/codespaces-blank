$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

# Reuse the proven 5.3.1 composition, then apply the 5.3.2 fresh-remote hotfix.
$source = Get-Content './bestiary-v530/build.ps1' -Raw
$source = $source.Replace('5.3.1', '5.3.2').Replace('build-output-v531', 'build-output-v532')

$needle = "python 'bestiary-v531/patch_v531.py'"
if (-not $source.Contains($needle)) { throw '5.3.1 patch marker missing from build composition.' }
$replacement = $needle + "`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to apply Minecraft lifecycle state hotfix.' }`n" +
  "python 'bestiary-v532/patch_v532.py'"
$source = $source.Replace($needle + "`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to apply Minecraft lifecycle state hotfix.' }", $replacement)

$generated = Join-Path $PSScriptRoot 'generated-v532.ps1'
Set-Content $generated $source -Encoding UTF8
& $generated
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.2 build composition failed with code $LASTEXITCODE" }

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$source = Get-Content './bestiary-v515/build.ps1' -Raw
$source = $source.Replace('5.1.5', '5.2.0').Replace('build-output-v515', 'build-output-v520')

$copyAnchor = "Copy-Item 'bestiary-v515/fixes/LibraryUx.css' `"`$PWD/source/src/renderer/src/components/LibraryUx.css`" -Force"
if (-not $source.Contains($copyAnchor)) { throw 'Launcher 5.1.5 copy anchor missing.' }
$copies = $copyAnchor + "`n" +
  "Copy-Item 'bestiary-v520/fixes/ipc.ts' `"`$PWD/source/src/shared/ipc.ts`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/preload-index.ts' `"`$PWD/source/src/preload/index.ts`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/App.tsx' `"`$PWD/source/src/renderer/src/App.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/ContentScreen.tsx' `"`$PWD/source/src/renderer/src/components/ContentScreen.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/ContentScreen.css' `"`$PWD/source/src/renderer/src/components/ContentScreen.css`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/AppUpdate.css' `"`$PWD/source/src/renderer/src/components/AppUpdate.css`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/AppUpdater.ts' `"`$PWD/source/src/main/core/AppUpdater.ts`" -Force"
$source = $source.Replace($copyAnchor, $copies)

$patchAnchor = "python 'bestiary-v515/patch_library.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch client library IPC.' }"
if (-not $source.Contains($patchAnchor)) { throw 'Launcher 5.1.5 patch anchor missing.' }
$patches = $patchAnchor + "`n" +
  "python 'bestiary-v520/patch_main.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to wire app updater.' }`n" +
  "python 'bestiary-v520/patch_home.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch Launcher Home.' }"
$source = $source.Replace($patchAnchor, $patches)

$verification = @'

$contentScreen = Get-Content 'source/src/renderer/src/components/ContentScreen.tsx' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$updateCore = Get-Content 'source/src/main/core/AppUpdater.ts' -Raw
$mainSource = Get-Content 'source/src/main/index.ts' -Raw
$ipcSource = Get-Content 'source/src/shared/ipc.ts' -Raw
if ($contentScreen -notmatch 'Content Manager' -or $contentScreen -notmatch 'content-row' -or $contentScreen -notmatch 'TẤT CẢ' -or $contentScreen -notmatch 'CÁ NHÂN') { throw 'Primary Content screen contract missing.' }
if ($appSource -notmatch "screen === 'content'" -or $appSource -notmatch 'checkAppUpdate' -or $appSource -notmatch 'CẬP NHẬT & KHỞI ĐỘNG LẠI') { throw 'Launcher main navigation/updater UX missing.' }
if ($updateCore -notmatch 'sha256' -or $updateCore -notmatch 'checkAndDownload' -or $updateCore -notmatch 'installReady') { throw 'SHA-verified updater core missing.' }
if ($mainSource -notmatch 'bestiary:app-update-check' -or $mainSource -notmatch "new AppUpdater\('launcher'") { throw 'Updater IPC/main wiring missing.' }
if ($ipcSource -notmatch 'AppUpdateState' -or $ipcSource -notmatch 'installAppUpdate') { throw 'Updater IPC types missing.' }
Write-Host 'Launcher 5.2.0 Content screen and updater contracts verified.'
'@
$source += $verification

$generated = Join-Path $PSScriptRoot 'generated-build.ps1'
Set-Content $generated $source -Encoding UTF8
& $generated
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.2.0 generated build failed with code $LASTEXITCODE" }

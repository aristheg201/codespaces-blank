$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$source = Get-Content './bestiary-v513/build.ps1' -Raw
$source = $source.Replace('5.1.3', '5.2.0').Replace('build-output-v513', 'build-output-v520')

$homeCss = "Copy-Item 'bestiary-v510-final/fixes/Home.css' `"`$PWD/source/src/renderer/src/components/Home.css`" -Force"
if (-not $source.Contains($homeCss)) { throw 'Home.css copy marker missing.' }
$copies = $homeCss + "`n" +
  "Copy-Item 'bestiary-v510-final/fixes/UxPanels.css' `"`$PWD/source/src/renderer/src/components/UxPanels.css`" -Force`n" +
  "Copy-Item 'bestiary-v510-final/fixes/LauncherUx.css' `"`$PWD/source/src/renderer/src/components/LauncherUx.css`" -Force`n" +
  "Copy-Item 'bestiary-v510-final/fixes/DiscordText.tsx' `"`$PWD/source/src/renderer/src/components/DiscordText.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v510-final/fixes/AnnouncementModal.tsx' `"`$PWD/source/src/renderer/src/components/AnnouncementModal.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v515/fixes/ContentManager.ts' `"`$PWD/source/src/main/core/ContentManager.ts`" -Force`n" +
  "Copy-Item 'bestiary-v515/fixes/LibraryModal.tsx' `"`$PWD/source/src/renderer/src/components/LibraryModal.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v515/fixes/LibraryUx.css' `"`$PWD/source/src/renderer/src/components/LibraryUx.css`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/ipc.ts' `"`$PWD/source/src/shared/ipc.ts`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/preload-index.ts' `"`$PWD/source/src/preload/index.ts`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/App.tsx' `"`$PWD/source/src/renderer/src/App.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/ContentScreen.tsx' `"`$PWD/source/src/renderer/src/components/ContentScreen.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/ContentScreen.css' `"`$PWD/source/src/renderer/src/components/ContentScreen.css`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/AppUpdate.css' `"`$PWD/source/src/renderer/src/components/AppUpdate.css`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/AppUpdater.ts' `"`$PWD/source/src/main/core/AppUpdater.ts`" -Force"
$source = $source.Replace($homeCss, $copies)

$builderCopy = "Copy-Item 'bestiary-build/electron-builder.json' `"`$PWD/source/electron-builder.json`" -Force"
if (-not $source.Contains($builderCopy)) { throw 'electron-builder copy marker missing.' }
$patches = $builderCopy + "`n" +
  "python 'bestiary-v514/patch_sync_profile.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch Full/Lite sync semantics.' }`n" +
  "python 'bestiary-v515/patch_android_manifest.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to preserve Android profile entries.' }`n" +
  "python 'bestiary-v515/patch_library.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch client library IPC.' }`n" +
  "python 'bestiary-v520/patch_main.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to wire app updater.' }`n" +
  "python 'bestiary-v520/patch_home.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch Launcher Home.' }"
$source = $source.Replace($builderCopy, $patches)

$generated = Join-Path $PSScriptRoot 'generated-build.ps1'
Set-Content $generated $source -Encoding UTF8
& $generated
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.2.0 generated build failed with code $LASTEXITCODE" }

$contentScreen = Get-Content 'source/src/renderer/src/components/ContentScreen.tsx' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$updateCore = Get-Content 'source/src/main/core/AppUpdater.ts' -Raw
$mainSource = Get-Content 'source/src/main/index.ts' -Raw
$ipcSource = Get-Content 'source/src/shared/ipc.ts' -Raw
$sync = Get-Content 'source/src/main/core/SyncEngine.ts' -Raw
if ($contentScreen -notmatch 'Content Manager' -or $contentScreen -notmatch 'content-row' -or $contentScreen -notmatch 'TẤT CẢ' -or $contentScreen -notmatch 'CÁ NHÂN') { throw 'Primary Content screen contract missing.' }
if ($appSource -notmatch "screen === 'content'" -or $appSource -notmatch 'checkAppUpdate' -or $appSource -notmatch 'CẬP NHẬT & KHỞI ĐỘNG LẠI') { throw 'Launcher main navigation/updater UX missing.' }
if ($updateCore -notmatch 'sha256' -or $updateCore -notmatch 'checkAndDownload' -or $updateCore -notmatch 'installReady') { throw 'SHA-verified updater core missing.' }
if ($mainSource -notmatch 'bestiary:app-update-check' -or $mainSource -notmatch "new AppUpdater\('launcher'") { throw 'Updater IPC/main wiring missing.' }
if ($ipcSource -notmatch 'AppUpdateState' -or $ipcSource -notmatch 'installAppUpdate') { throw 'Updater IPC types missing.' }
if ($sync -notmatch "profile === 'android'") { throw 'Android-only manifest entries would leak into desktop profiles.' }
Write-Host 'Launcher 5.2.0 Content screen and updater contracts verified.'

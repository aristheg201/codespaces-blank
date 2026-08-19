$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$source = Get-Content './bestiary-v513/build.ps1' -Raw
$source = $source.Replace('5.1.3', '5.1.5').Replace('build-output-v513', 'build-output-v515')

$homeCss = "Copy-Item 'bestiary-v510-final/fixes/Home.css' `"`$PWD/source/src/renderer/src/components/Home.css`" -Force"
if (-not $source.Contains($homeCss)) { throw 'Home.css copy marker missing.' }
$copies = $homeCss + "`n" +
  "Copy-Item 'bestiary-v510-final/fixes/UxPanels.css' `"`$PWD/source/src/renderer/src/components/UxPanels.css`" -Force`n" +
  "Copy-Item 'bestiary-v510-final/fixes/LauncherUx.css' `"`$PWD/source/src/renderer/src/components/LauncherUx.css`" -Force`n" +
  "Copy-Item 'bestiary-v510-final/fixes/DiscordText.tsx' `"`$PWD/source/src/renderer/src/components/DiscordText.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v510-final/fixes/AnnouncementModal.tsx' `"`$PWD/source/src/renderer/src/components/AnnouncementModal.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v515/fixes/ipc.ts' `"`$PWD/source/src/shared/ipc.ts`" -Force`n" +
  "Copy-Item 'bestiary-v515/fixes/preload-index.ts' `"`$PWD/source/src/preload/index.ts`" -Force`n" +
  "Copy-Item 'bestiary-v515/fixes/ContentManager.ts' `"`$PWD/source/src/main/core/ContentManager.ts`" -Force`n" +
  "Copy-Item 'bestiary-v515/fixes/LibraryModal.tsx' `"`$PWD/source/src/renderer/src/components/LibraryModal.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v515/fixes/LibraryUx.css' `"`$PWD/source/src/renderer/src/components/LibraryUx.css`" -Force"
$source = $source.Replace($homeCss, $copies)

$builderCopy = "Copy-Item 'bestiary-build/electron-builder.json' `"`$PWD/source/electron-builder.json`" -Force"
if (-not $source.Contains($builderCopy)) { throw 'electron-builder copy marker missing.' }
$patches = $builderCopy + "`n" +
  "python 'bestiary-v514/patch_sync_profile.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch Full/Lite sync semantics.' }`n" +
  "python 'bestiary-v515/patch_android_manifest.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to preserve Android profile entries.' }`n" +
  "python 'bestiary-v515/patch_library.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch client library IPC.' }"
$source = $source.Replace($builderCopy, $patches)

$generated = Join-Path $PSScriptRoot 'generated-build.ps1'
Set-Content $generated $source -Encoding UTF8
& $generated
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.1.5 generated build failed with code $LASTEXITCODE" }

$library = Get-Content 'source/src/renderer/src/components/LibraryModal.tsx' -Raw
$content = Get-Content 'source/src/main/core/ContentManager.ts' -Raw
$preload = Get-Content 'source/src/preload/index.ts' -Raw
$ipc = Get-Content 'source/src/shared/ipc.ts' -Raw
$main = Get-Content 'source/src/main/index.ts' -Raw
$sync = Get-Content 'source/src/main/core/SyncEngine.ts' -Raw
if ($library -notmatch 'KÉO MOD / RESOURCE PACK / SHADER' -or $library -notmatch 'getPathForFile') { throw 'Drag-drop library UX is missing.' }
if ($content -notmatch 'classify\(' -or $content -notmatch 'fabric\.mod\.json' -or $content -notmatch 'pack\.mcmeta' -or $content -notmatch 'shaders/') { throw 'Automatic content classifier is incomplete.' }
if ($preload -notmatch 'webUtils\.getPathForFile' -or $ipc -notmatch 'importLibraryFiles') { throw 'Safe drag-drop IPC contract is missing.' }
if ($main -notmatch 'library-import-auto' -or $main -notmatch 'library-choose-auto') { throw 'Automatic library IPC handlers are missing.' }
if ($sync -notmatch 'isModJar' -or $sync -notmatch "this.profile === 'full'" -or $sync -notmatch 'entry.profiles.includes\(this.profile\)') { throw 'Full/Lite sync contract was lost.' }
if ($sync -notmatch "profile === 'android'") { throw 'Android-only manifest entries would leak into desktop profiles.' }
if (-not (Test-Path 'source/src/renderer/src/components/LibraryUx.css')) { throw 'Library UX stylesheet missing.' }
Write-Host 'Bestiary Launcher 5.1.5 library, UX, desktop-profile, and Android-exclusion contracts verified.'

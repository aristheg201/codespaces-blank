$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$source = Get-Content './bestiary-v513/build.ps1' -Raw
$source = $source.Replace('5.1.3', '5.1.4').Replace('build-output-v513', 'build-output-v514')

$homeCss = "Copy-Item 'bestiary-v510-final/fixes/Home.css' `"`$PWD/source/src/renderer/src/components/Home.css`" -Force"
if (-not $source.Contains($homeCss)) { throw 'Home.css copy marker missing in runtime-verified base build script.' }
$uxCopies = $homeCss + "`n" +
  "Copy-Item 'bestiary-v510-final/fixes/UxPanels.css' `"`$PWD/source/src/renderer/src/components/UxPanels.css`" -Force`n" +
  "Copy-Item 'bestiary-v510-final/fixes/LauncherUx.css' `"`$PWD/source/src/renderer/src/components/LauncherUx.css`" -Force`n" +
  "Copy-Item 'bestiary-v510-final/fixes/DiscordText.tsx' `"`$PWD/source/src/renderer/src/components/DiscordText.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v510-final/fixes/AnnouncementModal.tsx' `"`$PWD/source/src/renderer/src/components/AnnouncementModal.tsx`" -Force"
$source = $source.Replace($homeCss, $uxCopies)

$builderCopy = "Copy-Item 'bestiary-build/electron-builder.json' `"`$PWD/source/electron-builder.json`" -Force"
if (-not $source.Contains($builderCopy)) { throw 'electron-builder copy marker missing.' }
$profilePatch = $builderCopy + "`npython 'bestiary-v514/patch_sync_profile.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch Full/Lite sync semantics.' }"
$source = $source.Replace($builderCopy, $profilePatch)

$generated = Join-Path $PSScriptRoot 'generated-build.ps1'
Set-Content $generated $source -Encoding UTF8
& $generated
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.1.4 generated build failed with code $LASTEXITCODE" }

$profile = Get-Content 'source/src/renderer/src/components/ProfileChooser.tsx' -Raw
$settings = Get-Content 'source/src/renderer/src/components/SettingsModal.tsx' -Raw
$announcement = Get-Content 'source/src/renderer/src/components/AnnouncementModal.tsx' -Raw
$discord = Get-Content 'source/src/renderer/src/components/DiscordText.tsx' -Raw
$sync = Get-Content 'source/src/main/core/SyncEngine.ts' -Raw
if ($profile -notmatch 'KHUYÊN DÙNG' -or $profile -notmatch 'CHỌN FULL & TIẾP TỤC') { throw 'Guided Full/Lite chooser missing.' }
if ($settings -notmatch 'Hiệu năng' -or $settings -notmatch 'Nâng cao' -or $settings -notmatch 'GENERATE JVM FLAGS') { throw 'Guided settings navigation missing.' }
if ($announcement -notmatch 'DiscordText') { throw 'Discord announcement renderer is not wired.' }
if ($discord -notmatch 'blockquote' -or $discord -notmatch 'discord-codeblock') { throw 'Discord formatting support is incomplete.' }
if ($sync -notmatch 'isModJar' -or $sync -notmatch "this.profile === 'full'") { throw 'Legacy Full/Lite defensive filter is missing.' }
if ($sync -notmatch 'entry.profiles.includes\(this.profile\)') { throw 'Per-file manifest profile filter is missing.' }
Write-Host 'Bestiary Launcher 5.1.4 UX and Full/Lite contracts verified.'

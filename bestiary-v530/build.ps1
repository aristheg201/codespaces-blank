$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

$source = Get-Content './bestiary-v513/build.ps1' -Raw
$source = $source.Replace('5.1.3', '5.3.0').Replace('build-output-v513', 'build-output-v530')

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
  "Copy-Item 'bestiary-v520/fixes/App.tsx' `"`$PWD/source/src/renderer/src/App.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/ContentScreen.tsx' `"`$PWD/source/src/renderer/src/components/ContentScreen.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/ContentScreen.css' `"`$PWD/source/src/renderer/src/components/ContentScreen.css`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/AppUpdate.css' `"`$PWD/source/src/renderer/src/components/AppUpdate.css`" -Force`n" +
  "Copy-Item 'bestiary-v520/fixes/AppUpdater.ts' `"`$PWD/source/src/main/core/AppUpdater.ts`" -Force`n" +
  "Copy-Item 'bestiary-v530/fixes/ipc.ts' `"`$PWD/source/src/shared/ipc.ts`" -Force`n" +
  "Copy-Item 'bestiary-v530/fixes/preload-index.ts' `"`$PWD/source/src/preload/index.ts`" -Force`n" +
  "Copy-Item 'bestiary-v530/fixes/AccountService.ts' `"`$PWD/source/src/main/core/AccountService.ts`" -Force`n" +
  "Copy-Item 'bestiary-v530/fixes/AccountScreen.tsx' `"`$PWD/source/src/renderer/src/components/AccountScreen.tsx`" -Force`n" +
  "Copy-Item 'bestiary-v530/fixes/AccountScreen.css' `"`$PWD/source/src/renderer/src/components/AccountScreen.css`" -Force"
$source = $source.Replace($homeCss, $copies)

$builderCopy = "Copy-Item 'bestiary-build/electron-builder.json' `"`$PWD/source/electron-builder.json`" -Force"
if (-not $source.Contains($builderCopy)) { throw 'electron-builder copy marker missing.' }
$patches = $builderCopy + "`n" +
  "python 'bestiary-v514/patch_sync_profile.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch Full/Lite sync semantics.' }`n" +
  "python 'bestiary-v515/patch_android_manifest.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to preserve Android profile entries.' }`n" +
  "python 'bestiary-v515/patch_library.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch client library IPC.' }`n" +
  "python 'bestiary-v520/patch_main.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to wire app updater.' }`n" +
  "python 'bestiary-v520/patch_home.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to patch Launcher Home.' }`n" +
  "python 'bestiary-v521/patch_home.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to apply prominent mod manager entry.' }`n" +
  "python 'bestiary-v530/patch_v530.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to apply Microsoft auth + skin patch.' }`n" +
  "python 'bestiary-v530/patch_bridge_package.py'`nif (`$LASTEXITCODE -ne 0) { throw 'Unable to switch Skin Bridge to ASAR-safe packaging.' }`n" +
  "Copy-Item 'bestiary-skin-bridge/build/libs/bestiary-skin-bridge-1.0.0.jar' `"`$PWD/source/resources/bestiary-skin-bridge-1.0.0.jar`" -Force"
$source = $source.Replace($builderCopy, $patches)

$generated = Join-Path $PSScriptRoot 'generated-build.ps1'
Set-Content $generated $source -Encoding UTF8
& $generated
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.0 generated build failed with code $LASTEXITCODE" }

$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$launcher = Get-Content 'source/src/main/core/Launcher.ts' -Raw
$remote = Get-Content 'source/src/main/core/RemoteService.ts' -Raw
$main = Get-Content 'source/src/main/index.ts' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$accountUi = Get-Content 'source/src/renderer/src/components/AccountScreen.tsx' -Raw
$homeSource = Get-Content 'source/src/renderer/src/components/Home.tsx' -Raw
$ipc = Get-Content 'source/src/shared/ipc.ts' -Raw
$builderConfig = Get-Content 'source/electron-builder.json' -Raw
$bridgeJar = Get-Item 'bestiary-skin-bridge/build/libs/bestiary-skin-bridge-1.0.0.jar' -ErrorAction Stop

if ($account -notmatch 'devicecode' -or $account -notmatch 'safeStorage\.encryptString' -or $account -notmatch 'entitlements/mcstore') { throw 'Microsoft device auth/secure token/ownership contract missing.' }
if ($account -notmatch 'minecraft/profile/skins' -or $account -notmatch 'player-skin\.json') { throw 'Skin management contract missing.' }
if ($account -notmatch 'fs\.readFile\(sourceJar\)' -or $account -notmatch 'fs\.writeFile\(tmp, data\)') { throw 'ASAR-safe Skin Bridge extraction missing.' }
if ($launcher -notmatch 'normalized\.authorization \?\?' -or $launcher -notmatch 'MinecraftAuthorization') { throw 'MCLC Microsoft authorization path missing.' }
if ($main -notmatch 'authorization: authorization \?\? undefined' -or $main -notmatch 'account-login-microsoft' -or $main -notmatch 'skin-set') { throw 'Account-aware launch or IPC wiring missing.' }
if ($main -notmatch "app\.getAppPath\(\), 'resources', 'bestiary-skin-bridge-1\.0\.0\.jar'") { throw 'ASAR Skin Bridge runtime path missing.' }
if ($remote -notmatch 'microsoftClientId' -or $ipc -notmatch "type: 'msa'") { throw 'Public client id/MSA authorization metadata missing.' }
if ($appSource -notmatch "screen === 'account'" -or $accountUi -notmatch 'ĐĂNG NHẬP MICROSOFT' -or $accountUi -notmatch 'PLAYER SKIN') { throw 'Account/Skin UI missing.' }
if ($homeSource -notmatch 'Tài khoản & Skin' -or $homeSource -notmatch 'microsoftActive') { throw 'Home account entry or Microsoft-aware Play UI missing.' }
if ($bridgeJar.Length -lt 10000) { throw "Skin Bridge jar unexpectedly small: $($bridgeJar.Length)" }
if ($builderConfig -notmatch 'resources/\*\*/\*') { throw 'electron-builder no longer packages resources directory.' }
if (-not (Test-Path 'source/resources/bestiary-skin-bridge-1.0.0.jar')) { throw 'Launcher source resources are missing Skin Bridge jar.' }
if (-not (Test-Path 'source/release/win-unpacked/resources/app.asar')) { throw 'Packaged Launcher app.asar is missing.' }

Push-Location source
$asarEntries = node -e "const asar=require('@electron/asar'); console.log(asar.listPackage('release/win-unpacked/resources/app.asar').join('\n'))"
$asarExit = $LASTEXITCODE
Pop-Location
if ($asarExit -ne 0) { throw 'Unable to inspect packaged app.asar.' }
if (($asarEntries -join "`n") -notmatch 'resources[\\/]bestiary-skin-bridge-1\.0\.0\.jar') { throw 'Packaged app.asar does not contain Bestiary Skin Bridge.' }

New-Item -ItemType Directory -Force 'build-output-v530' | Out-Null
Copy-Item $bridgeJar.FullName 'build-output-v530/bestiary-skin-bridge-1.0.0.jar' -Force
$bridgeHash = (Get-FileHash $bridgeJar.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
"$bridgeHash  bestiary-skin-bridge-1.0.0.jar" | Set-Content 'build-output-v530/bestiary-skin-bridge-1.0.0-SHA256.txt' -Encoding ascii
Write-Host "Skin Bridge SHA256: $bridgeHash"
Write-Host 'Launcher 5.3.0 Microsoft account and player-skin contracts verified.'

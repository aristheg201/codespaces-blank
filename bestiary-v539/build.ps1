$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Build verified Launcher 5.3.8 baseline ==='
& './bestiary-v538/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.3.8 baseline build failed with code $LASTEXITCODE" }

Write-Host '=== Apply 5.3.9 adaptive JVM generator ==='
Copy-Item 'bestiary-v539/JvmProfileGenerator.ts' 'source/src/main/core/JvmProfileGenerator.ts' -Force
python 'bestiary-v539/patch_v539.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.3.9 adaptive JVM patch.' }
$main539 = Get-Content 'source/src/main/index.ts' -Raw
$oldProfile = '      profile: settings.clientProfile,'
if (-not $main539.Contains($oldProfile)) { throw 'SyncEngine client profile marker missing.' }
$main539 = $main539.Replace($oldProfile, '      profile: settings.clientProfile ?? undefined,')
Set-Content 'source/src/main/index.ts' $main539 -Encoding UTF8

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.3.9'
$pkg.author = 'SVFrame Team Studio'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.9 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.3.9 Windows build failed.' }
Pop-Location

Write-Host '=== Verify adaptive generator contracts ==='
$generator = Get-Content 'source/src/main/core/JvmProfileGenerator.ts' -Raw
$main = Get-Content 'source/src/main/index.ts' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$settingsUi = Get-Content 'source/src/renderer/src/components/SettingsModal.tsx' -Raw
$bridge = Get-Content 'source/src/main/core/OfficialLauncherBridge.ts' -Raw
$keybind = Get-Content 'source/src/main/core/KeybindPolicyService.ts' -Raw
$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$remote = Get-Content 'source/src/main/core/RemoteService.ts' -Raw

if ($generator -notmatch "tier: 'low_memory'" -or $generator -notmatch 'hardMaxMb: 2048') { throw '4 GB low-memory policy missing.' }
if ($generator -notmatch "GENERATOR_REVISION_ARG = '-Dbestiary.jvm.profile=539'") { throw 'JVM generator revision marker missing.' }
if ($generator -notmatch '\-XX:\+UnlockExperimentalVMOptions' -or $generator -notmatch '\-XX:G1MixedGCLiveThresholdPercent=90') { throw 'UltraServers/Aikar-style G1 policy missing.' }
if ($generator -notmatch '\-XX:\+UseStringDeduplication' -or $generator -notmatch 'gcThreadArgs') { throw 'Client low-memory tuning missing.' }
if ($generator -match 'G1HeapRegionSize=8M') { throw 'Fixed 8M G1 region size must not be forced on weak clients.' }
if ($main -notmatch 'minRamMb: generated\.recommendedMinRamMb' -or $main -notmatch 'maxRamMb: generated\.recommendedMaxRamMb') { throw 'Generate is not atomic RAM + JVM.' }
if ($main -notmatch 'weakMemoryTier' -or $main -notmatch "generatedJvmArgs\.includes\('-Dbestiary\.jvm\.profile=539'\)") { throw 'Weak-machine migration contract missing.' }
if ($main -notmatch 'profile: settings\.clientProfile \?\? undefined') { throw 'SyncEngine nullable profile typing fix missing.' }
if ($settingsUi -notmatch 'min=\{1024\}' -or $settingsUi -notmatch 'step=\{256\}' -or $settingsUi -notmatch 'GENERATE JVM \+ RAM PROFILE') { throw 'Weak-machine RAM UI contract missing.' }
if ($settingsUi -notmatch 'minRamMb: next\.settings\.minRamMb' -or $settingsUi -notmatch 'maxRamMb: next\.settings\.maxRamMb') { throw 'Settings UI does not consume generated RAM recommendation.' }
if ($appSource -notmatch 'generateJvmFlags\(next\)' -or $appSource -notmatch "currentVersion: '5\.3\.9'") { throw 'First profile selection is not adaptive or version metadata missing.' }
if ($bridge -notmatch 'prepareAndOpen\(profileId: string, settings: LauncherSettings\)' -or $bridge -notmatch 'settings\.generatedJvmArgs') { throw '5.3.8 Microsoft RAM/JVM bridge regressed.' }
if ($main -notmatch 'officialLauncherBridge\.prepareAndOpen\(profileId, settings\)') { throw 'Microsoft route no longer passes adaptive settings.' }
if ($main -notmatch 'keybindPolicyService\.apply\(\)' -or $keybind -notmatch 'bestiary-keybinds\.json') { throw 'Keybind policy consumer regressed.' }
if ($main -notmatch 'app\.requestSingleInstanceLock\(\)' -or $main -notmatch "app\.on\('second-instance'") { throw 'Launcher lifecycle regression detected.' }
if ($account -notmatch 'BestiaryLauncher/5\.3\.9' -or $remote -notmatch 'BestiaryLauncher/5\.3\.9') { throw '5.3.9 user-agent metadata missing.' }

Write-Host '=== Execute deterministic 4/6/8/12/16 GB generator tests ==='
@'
import { writeFileSync } from 'node:fs';
import { generateJvmProfileForHardware, isCurrentJvmProfile } from './source/src/main/core/JvmProfileGenerator.ts';

const remote = {
  profiles: [
    { id: 'lite', minimumRamMb: 3072, recommendedRamMb: 4096 },
    { id: 'full', minimumRamMb: 6144, recommendedRamMb: 8192 },
  ],
};
const base = {
  username: 'BestiaryTest', minRamMb: 2048, maxRamMb: 8192,
  width: 1280, height: 720, fullscreen: false,
  performancePreset: 'performance', clientProfile: 'lite',
  customJvmArgs: '', generatedJvmArgs: [],
};
const cases = [
  [4096, 4, 'lite', 512, 2048, 'low_memory'],
  [4096, 4, 'full', 512, 2048, 'low_memory'],
  [6144, 4, 'lite', 768, 3072, 'entry'],
  [8192, 8, 'lite', 1024, 4096, 'standard'],
  [12288, 12, 'full', 1536, 6144, 'performance'],
  [16384, 16, 'full', 2048, 8192, 'performance'],
];
let low;
for (const [ram, cpu, clientProfile, expectedMin, expectedMax, expectedTier] of cases) {
  const generated = generateJvmProfileForHardware({ ...base, clientProfile }, remote, { systemRamMb: ram, cpuThreads: cpu });
  if (generated.recommendedMinRamMb !== expectedMin || generated.recommendedMaxRamMb !== expectedMax || generated.memoryTier !== expectedTier) {
    throw new Error(`Unexpected profile for ${ram}MB/${clientProfile}: ${JSON.stringify(generated)}`);
  }
  if (!isCurrentJvmProfile(generated.args)) throw new Error('Generator revision marker missing at runtime.');
  if (generated.args.some((arg) => /^-Xm[sx]/u.test(arg))) throw new Error('Generated args leaked Xms/Xmx.');
  if (ram === 4096 && clientProfile === 'lite') low = generated;
}
if (!low) throw new Error('Low-memory test profile missing.');
for (const required of ['-XX:MaxGCPauseMillis=150','-XX:G1NewSizePercent=20','-XX:G1MaxNewSizePercent=30','-XX:ParallelGCThreads=2','-XX:ConcGCThreads=1','-XX:+UseStringDeduplication']) {
  if (!low.args.includes(required)) throw new Error(`4 GB profile missing ${required}`);
}
if (!low.belowProfileMinimum) throw new Error('4 GB Lite profile must report that safe heap is below distribution minimum.');
if (low.args.some((arg) => arg.startsWith('-XX:G1HeapRegionSize='))) throw new Error('Low-memory profile must not force G1HeapRegionSize.');
const custom = generateJvmProfileForHardware({ ...base, performancePreset: 'custom', customJvmArgs: '-XX:MaxGCPauseMillis=175 -XX:G1ReservePercent=25 -Xmx99G' }, remote, { systemRamMb: 4096, cpuThreads: 4 });
if (custom.args.filter((arg) => arg.startsWith('-XX:MaxGCPauseMillis=')).join('') !== '-XX:MaxGCPauseMillis=175') throw new Error('Custom pause override failed.');
if (custom.args.filter((arg) => arg.startsWith('-XX:G1ReservePercent=')).join('') !== '-XX:G1ReservePercent=25') throw new Error('Custom reserve override failed.');
if (custom.args.some((arg) => arg.startsWith('-Xmx'))) throw new Error('Custom Xmx must be ignored.');
writeFileSync('.tmp-v539-java-args.txt', [`-Xms${low.recommendedMinRamMb}M`, `-Xmx${low.recommendedMaxRamMb}M`, ...low.args].join('\n'));
console.log('Adaptive JVM generator hardware matrix passed.');
'@ | Set-Content '.tmp-v539-generator-test.mjs' -Encoding UTF8
node --experimental-strip-types '.tmp-v539-generator-test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'Adaptive JVM generator hardware tests failed.' }

Write-Host '=== Validate generated low-memory flags on Java 21 ==='
$jvmArgs = Get-Content '.tmp-v539-java-args.txt' | Where-Object { $_ -and $_.Trim() }
& java @jvmArgs -version
if ($LASTEXITCODE -ne 0) { throw 'Java 21 rejected the generated 4 GB JVM profile.' }

$installer = Get-Item 'source/release/BestiaryLauncher-Setup-5.3.9.exe' -ErrorAction Stop
$unpacked = Resolve-Path 'source/release/win-unpacked'
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher 5.3.9 binary unexpectedly small.' }

Write-Host '=== Smoke Launcher 5.3.9 binary ==='
$stdoutPath = "$PWD/runtime-smoke-v539-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v539-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 10
if ($proc.HasExited) {
  if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Tail 120 }
  if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 120 }
  throw "Launcher 5.3.9 exited during smoke test with code $($proc.ExitCode)."
}
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v539' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v539' | Out-Null
Copy-Item $installer.FullName 'build-output-v539/BestiaryLauncher-Setup-5.3.9.exe' -Force
$hash = (Get-FileHash 'build-output-v539/BestiaryLauncher-Setup-5.3.9.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.3.9.exe" | Set-Content 'build-output-v539/BestiaryLauncher-Setup-5.3.9-SHA256.txt' -Encoding ascii
Copy-Item $stdoutPath 'build-output-v539/runtime-smoke-stdout.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stderrPath 'build-output-v539/runtime-smoke-stderr.log' -Force -ErrorAction SilentlyContinue
Write-Host "Launcher 5.3.9 SHA256: $hash"
Write-Host 'Launcher 5.3.9 adaptive JVM generator build completed.'

$ErrorActionPreference = 'Stop'
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $repoRoot

Write-Host '=== Rebuild verified Launcher 5.4.3 baseline ==='
& './bestiary-v543/build.ps1'
if ($LASTEXITCODE -ne 0) { throw "Launcher 5.4.3 baseline build failed with code $LASTEXITCODE" }

Write-Host '=== Apply 5.4.4 low-memory JVM fix ==='
Copy-Item 'bestiary-v544/JvmProfileGenerator.ts' 'source/src/main/core/JvmProfileGenerator.ts' -Force
python 'bestiary-v544/patch_v544.py'
if ($LASTEXITCODE -ne 0) { throw 'Unable to apply Launcher 5.4.4 JVM patch.' }

Push-Location source
$pkg = Get-Content package.json -Raw | ConvertFrom-Json
$pkg.version = '5.4.4'
$pkg.author = 'SVFrame Team Studio'
$pkg | ConvertTo-Json -Depth 20 | Set-Content -Encoding UTF8 package.json
npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.4 typecheck failed.' }
npm run dist:win
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.4 Windows build failed.' }
Pop-Location

Write-Host '=== Verify 5.4.4 source contracts ==='
$generator = Get-Content 'source/src/main/core/JvmProfileGenerator.ts' -Raw
$main = Get-Content 'source/src/main/index.ts' -Raw
$appSource = Get-Content 'source/src/renderer/src/App.tsx' -Raw
$settingsUi = Get-Content 'source/src/renderer/src/components/SettingsModal.tsx' -Raw
$account = Get-Content 'source/src/main/core/AccountService.ts' -Raw
$remote = Get-Content 'source/src/main/core/RemoteService.ts' -Raw

if ($generator -notmatch "GENERATOR_REVISION_ARG = '-Dbestiary.jvm.profile=544'") { throw '5.4.4 JVM revision marker missing.' }
if ($generator -notmatch "hardMaxMb: 2304") { throw '4 GB heap target missing.' }
if ($generator -notmatch "fraction: 0\.60, reserveMb: 1280") { throw '4 GB memory reserve policy missing.' }
if ($generator -notmatch "\-XX:\+UseG1GC" -or $generator -notmatch "\-XX:\+ParallelRefProcEnabled") { throw 'Minimal G1 client defaults missing.' }
if ($generator -notmatch "\-XX:\+UseStringDeduplication") { throw 'Low-memory string dedup missing.' }

$forbidden = @(
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:G1HeapWastePercent=',
  '-XX:G1MixedGCCountTarget=',
  '-XX:InitiatingHeapOccupancyPercent=',
  '-XX:G1MixedGCLiveThresholdPercent=',
  '-XX:G1RSetUpdatingPauseTimePercent=',
  '-XX:SurvivorRatio=',
  '-XX:MaxTenuringThreshold=',
  '-XX:G1NewSizePercent=',
  '-XX:G1MaxNewSizePercent=',
  '-XX:G1ReservePercent=',
  '-XX:ParallelGCThreads=',
  '-XX:ConcGCThreads=',
  '-XX:+AlwaysPreTouch'
)
foreach ($arg in $forbidden) {
  if ($generator.Contains($arg)) { throw "Aggressive server-style JVM flag survived: $arg" }
}

if ($main -notmatch "generatedJvmArgs\.includes\('-Dbestiary\.jvm\.profile=544'\)") { throw '5.4.4 automatic JVM migration missing.' }
if ($main -match "generatedJvmArgs\.includes\('-Dbestiary\.jvm\.profile=539'\)") { throw 'Old 5.3.9 JVM revision is still authoritative.' }
if ($main -notmatch 'minRamMb: adaptiveJvm\.recommendedMinRamMb' -or $main -notmatch 'maxRamMb: adaptiveJvm\.recommendedMaxRamMb') { throw 'Old JVM profiles are not atomically migrated to new RAM recommendations.' }
if ($settingsUi -notmatch 'total \* 0\.60' -or $settingsUi -notmatch '2304') { throw 'Settings RAM slider does not reflect new low-memory budget.' }
if ($appSource -notmatch "currentVersion: '5\.4\.4'") { throw '5.4.4 renderer version metadata missing.' }
if ($account -notmatch 'BestiaryLauncher/5\.4\.4' -or $remote -notmatch 'BestiaryLauncher/5\.4\.4') { throw '5.4.4 user-agent metadata missing.' }

# Preserve the 5.4.3 lifecycle fix.
$lockCount = ([regex]::Matches($main, 'app\.requestSingleInstanceLock\(\)')).Count
if ($lockCount -ne 1) { throw "Expected exactly one requestSingleInstanceLock(), found $lockCount." }
if ($main -notmatch "app\.on\('second-instance', \(\) => \{\s*restoreBestiaryWindow\(\);\s*\}\);") { throw '5.4.3 second-instance restore contract regressed.' }
if ($main -notmatch "app\.on\('window-all-closed', \(\) => \{\s*if \(process\.platform !== 'darwin'\) \{\s*isQuitting = true;\s*app\.exit\(0\);") { throw '5.4.3 deterministic close contract regressed.' }

Write-Host '=== Execute deterministic JVM hardware matrix ==='
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
  username: 'BestiaryTest', minRamMb: 512, maxRamMb: 4096,
  width: 1280, height: 720, fullscreen: false,
  performancePreset: 'performance', clientProfile: 'lite',
  customJvmArgs: '', generatedJvmArgs: [],
};
const cases = [
  [3840, 4, 'lite', 512, 2304, 'low_memory'],
  [4096, 4, 'lite', 512, 2304, 'low_memory'],
  [4096, 4, 'full', 512, 2304, 'low_memory'],
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
  if (ram === 3840 && clientProfile === 'lite') low = generated;
}
if (!low) throw new Error('4 GB-class low-memory test profile missing.');

for (const required of ['-XX:+UseG1GC','-XX:+ParallelRefProcEnabled','-XX:+PerfDisableSharedMem','-XX:+UseStringDeduplication']) {
  if (!low.args.includes(required)) throw new Error(`4 GB profile missing ${required}`);
}
const forbidden = [
  '-XX:+UnlockExperimentalVMOptions',
  '-XX:+DisableExplicitGC',
  '-XX:G1HeapWastePercent=',
  '-XX:G1MixedGCCountTarget=',
  '-XX:InitiatingHeapOccupancyPercent=',
  '-XX:G1MixedGCLiveThresholdPercent=',
  '-XX:G1RSetUpdatingPauseTimePercent=',
  '-XX:SurvivorRatio=',
  '-XX:MaxTenuringThreshold=',
  '-XX:G1NewSizePercent=',
  '-XX:G1MaxNewSizePercent=',
  '-XX:G1ReservePercent=',
  '-XX:ParallelGCThreads=',
  '-XX:ConcGCThreads=',
  '-XX:+AlwaysPreTouch',
];
for (const prefix of forbidden) {
  if (low.args.some((arg) => arg === prefix || arg.startsWith(prefix))) throw new Error(`4 GB profile still contains ${prefix}`);
}
if (!low.belowProfileMinimum) throw new Error('4 GB Lite profile must still report below published profile minimum.');

const custom = generateJvmProfileForHardware(
  { ...base, performancePreset: 'custom', customJvmArgs: '-XX:MaxGCPauseMillis=175 -XX:G1ReservePercent=25 -Xmx99G' },
  remote,
  { systemRamMb: 4096, cpuThreads: 4 },
);
if (custom.args.filter((arg) => arg.startsWith('-XX:MaxGCPauseMillis=')).join('') !== '-XX:MaxGCPauseMillis=175') throw new Error('Custom pause override failed.');
if (custom.args.filter((arg) => arg.startsWith('-XX:G1ReservePercent=')).join('') !== '-XX:G1ReservePercent=25') throw new Error('Custom reserve override failed.');
if (custom.args.some((arg) => arg.startsWith('-Xmx'))) throw new Error('Custom Xmx must be ignored.');

writeFileSync('.tmp-v544-java-args.txt', [`-Xms${low.recommendedMinRamMb}M`, `-Xmx${low.recommendedMaxRamMb}M`, ...low.args].join('\n'));
console.log('Launcher 5.4.4 JVM hardware matrix passed.');
'@ | Set-Content '.tmp-v544-generator-test.mjs' -Encoding UTF8
node --experimental-strip-types '.tmp-v544-generator-test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'Launcher 5.4.4 generator hardware tests failed.' }

Write-Host '=== Validate low-memory flags on Java 21 ==='
$jvmArgs = Get-Content '.tmp-v544-java-args.txt' | Where-Object { $_ -and $_.Trim() }
& java @jvmArgs -version
if ($LASTEXITCODE -ne 0) { throw 'Java 21 rejected the 5.4.4 low-memory JVM profile.' }

$installer = Get-Item 'source/release/BestiaryLauncher-Setup-5.4.4.exe' -ErrorAction Stop
$unpacked = Resolve-Path 'source/release/win-unpacked'
$exe = Get-Item (Join-Path $unpacked 'Bestiary Launcher.exe') -ErrorAction Stop
if ($installer.Length -lt 1000000 -or $exe.Length -lt 1000000) { throw 'Launcher 5.4.4 binary unexpectedly small.' }
if (-not (Test-Path (Join-Path $unpacked 'resources/app.asar'))) { throw 'Launcher 5.4.4 runtime is missing app.asar.' }

Write-Host '=== Smoke Launcher 5.4.4 binary ==='
$stdoutPath = "$PWD/runtime-smoke-v544-stdout.log"
$stderrPath = "$PWD/runtime-smoke-v544-stderr.log"
Remove-Item $stdoutPath,$stderrPath -Force -ErrorAction SilentlyContinue
$env:ELECTRON_ENABLE_LOGGING = '1'
$proc = Start-Process -FilePath $exe.FullName -WorkingDirectory $unpacked -ArgumentList @('--enable-logging','--disable-gpu') -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -PassThru
Start-Sleep -Seconds 10
if ($proc.HasExited) {
  if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Tail 120 }
  if (Test-Path $stderrPath) { Get-Content $stderrPath -Tail 120 }
  throw "Launcher 5.4.4 exited during smoke test with code $($proc.ExitCode)."
}
Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2
Get-Process | Where-Object { $_.ProcessName -like 'Bestiary*' } | Stop-Process -Force -ErrorAction SilentlyContinue

Remove-Item 'build-output-v544' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force 'build-output-v544/diagnostic-source' | Out-Null
Copy-Item $installer.FullName 'build-output-v544/BestiaryLauncher-Setup-5.4.4.exe' -Force
$hash = (Get-FileHash 'build-output-v544/BestiaryLauncher-Setup-5.4.4.exe' -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  BestiaryLauncher-Setup-5.4.4.exe" | Set-Content 'build-output-v544/BestiaryLauncher-Setup-5.4.4-SHA256.txt' -Encoding ascii
Copy-Item $stdoutPath 'build-output-v544/runtime-smoke-stdout.log' -Force -ErrorAction SilentlyContinue
Copy-Item $stderrPath 'build-output-v544/runtime-smoke-stderr.log' -Force -ErrorAction SilentlyContinue
Copy-Item 'source/src/main/core/JvmProfileGenerator.ts' 'build-output-v544/diagnostic-source/JvmProfileGenerator.ts' -Force
Copy-Item 'source/src/main/index.ts' 'build-output-v544/diagnostic-source/index.ts' -Force
Copy-Item 'source/src/renderer/src/components/SettingsModal.tsx' 'build-output-v544/diagnostic-source/SettingsModal.tsx' -Force

@"
version=5.4.4
sha256=$hash
jvmProfileRevision=544
lowMemory3840MaxMb=2304
lowMemory4096MaxMb=2304
legacy539AutoMigrated=true
aggressiveServerGcFlagsRemoved=true
java21AdaptiveG1=true
lifecycle543Preserved=true
"@ | Set-Content 'build-output-v544/memory-contract.txt' -Encoding ascii

Write-Host "Launcher 5.4.4 SHA256: $hash"
Write-Host 'Launcher 5.4.4 low-memory JVM build completed.'

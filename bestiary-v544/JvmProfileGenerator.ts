import os from 'node:os';
import type { ClientProfileId, LauncherSettings, RemoteReleaseInfo } from '../../shared/ipc';

export type JvmMemoryTier = 'low_memory' | 'entry' | 'standard' | 'performance' | 'high_memory';

export interface GeneratedJvmProfile {
  args: string[];
  recommendedMinRamMb: number;
  recommendedMaxRamMb: number;
  systemRamMb: number;
  cpuThreads: number;
  memoryTier: JvmMemoryTier;
  profileMinimumRamMb: number;
  belowProfileMinimum: boolean;
}

interface HardwareSnapshot {
  systemRamMb: number;
  cpuThreads: number;
}

interface MemoryPolicy {
  tier: JvmMemoryTier;
  fraction: number;
  reserveMb: number;
  hardMaxMb: number;
}

const MEMORY_POLICIES: Array<MemoryPolicy & { maxSystemRamMb: number }> = [
  // Cobblemon + the merged resource pack requires at least a 3 GiB Java heap.
  // On 4 GB-class systems this is intentionally aggressive and relies on the OS/pagefile
  // for native/iGPU pressure rather than allowing Minecraft to fall back below 3 GiB.
  { maxSystemRamMb: 4608, tier: 'low_memory', fraction: 0.80, reserveMb: 768, hardMaxMb: 3072 },
  { maxSystemRamMb: 6144, tier: 'entry', fraction: 0.58, reserveMb: 1792, hardMaxMb: 3072 },
  { maxSystemRamMb: 8192, tier: 'standard', fraction: 0.55, reserveMb: 2048, hardMaxMb: 4096 },
  { maxSystemRamMb: 12_288, tier: 'performance', fraction: 0.55, reserveMb: 3072, hardMaxMb: 6144 },
  { maxSystemRamMb: 16_384, tier: 'performance', fraction: 0.55, reserveMb: 4096, hardMaxMb: 8192 },
  { maxSystemRamMb: Number.POSITIVE_INFINITY, tier: 'high_memory', fraction: 0.60, reserveMb: 6144, hardMaxMb: 10_240 },
];

const GENERATOR_REVISION_ARG = '-Dbestiary.jvm.profile=544';
const MIN_CLIENT_HEAP_MB = 3072;

function splitJvmArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/u.test(char)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (escaped) current += '\\';
  if (current) args.push(current);
  return args;
}

function normalizeProfile(profile: ClientProfileId | null): ClientProfileId {
  return profile === 'lite' ? 'lite' : 'full';
}

function profileRecommendation(profile: ClientProfileId, remote: RemoteReleaseInfo): { minimum: number; recommended: number } {
  const descriptor = remote.profiles.find((item) => item.id === profile);
  if (descriptor) {
    return {
      minimum: Math.max(1024, descriptor.minimumRamMb),
      recommended: Math.max(descriptor.minimumRamMb, descriptor.recommendedRamMb),
    };
  }
  return profile === 'lite'
    ? { minimum: 3072, recommended: 4096 }
    : { minimum: 6144, recommended: 8192 };
}

function roundDown256(value: number): number {
  return Math.floor(value / 256) * 256;
}

function memoryPolicy(systemRamMb: number): MemoryPolicy {
  return MEMORY_POLICIES.find((item) => systemRamMb <= item.maxSystemRamMb) ?? MEMORY_POLICIES[MEMORY_POLICIES.length - 1];
}

function safeHeapBudget(systemRamMb: number, policy: MemoryPolicy): number {
  const byFraction = roundDown256(systemRamMb * policy.fraction);
  const byReserve = roundDown256(systemRamMb - policy.reserveMb);
  return Math.max(MIN_CLIENT_HEAP_MB, Math.min(byFraction, byReserve, policy.hardMaxMb));
}

function jvmArgumentKey(argument: string): string {
  if (argument.startsWith('-D')) return argument.split('=', 1)[0];
  const xx = /^-XX:[+-]?([^=]+)(?:=.*)?$/u.exec(argument);
  if (xx) return `-XX:${xx[1]}`;
  return argument.split('=', 1)[0];
}

function mergeJvmArgs(...groups: string[][]): string[] {
  const ordered = new Map<string, string>();
  for (const group of groups) {
    for (const raw of group) {
      const argument = raw.trim();
      if (!argument || argument.includes('\0') || argument.length > 4096 || /^-Xm[sx]/u.test(argument)) continue;
      ordered.set(jvmArgumentKey(argument), argument);
    }
  }
  return [...ordered.values()];
}

export function isCurrentJvmProfile(args: string[]): boolean {
  return args.includes(GENERATOR_REVISION_ARG);
}

export function generateJvmProfileForHardware(
  settings: LauncherSettings,
  remote: RemoteReleaseInfo,
  hardware: HardwareSnapshot,
): GeneratedJvmProfile {
  const systemRamMb = Math.max(1024, Math.floor(hardware.systemRamMb));
  const cpuThreads = Math.max(1, Math.floor(hardware.cpuThreads));
  const profile = normalizeProfile(settings.clientProfile);
  const recommendation = profileRecommendation(profile, remote);
  const policy = memoryPolicy(systemRamMb);
  const safeBudgetMb = safeHeapBudget(systemRamMb, policy);
  const recommendedMaxRamMb = Math.max(MIN_CLIENT_HEAP_MB, roundDown256(Math.min(recommendation.recommended, safeBudgetMb)));
  const recommendedMinRamMb = Math.max(512, Math.min(2048, roundDown256(recommendedMaxRamMb * 0.25)));

  // Java 21 already has a mature adaptive G1 policy. Keep client defaults intentionally
  // small: the old Aikar/server-style tuning caused excess GC churn and reduced usable
  // heap on low-memory desktops. String dedup is retained only where memory pressure is
  // the dominant constraint.
  const adaptiveArgs = [
    GENERATOR_REVISION_ARG,
    '-Dfile.encoding=UTF-8',
    '-Dsun.stdout.encoding=UTF-8',
    '-Dsun.stderr.encoding=UTF-8',
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:+PerfDisableSharedMem',
  ];

  if (policy.tier === 'low_memory' || policy.tier === 'entry') {
    adaptiveArgs.push('-XX:+UseStringDeduplication');
  }

  const customArgs = settings.performancePreset === 'custom'
    ? splitJvmArgs(settings.customJvmArgs)
    : [];

  return {
    args: mergeJvmArgs(adaptiveArgs, customArgs),
    recommendedMinRamMb,
    recommendedMaxRamMb,
    systemRamMb,
    cpuThreads,
    memoryTier: policy.tier,
    profileMinimumRamMb: recommendation.minimum,
    belowProfileMinimum: recommendedMaxRamMb < recommendation.minimum,
  };
}

export function generateJvmProfile(settings: LauncherSettings, remote: RemoteReleaseInfo): GeneratedJvmProfile {
  return generateJvmProfileForHardware(settings, remote, {
    systemRamMb: Math.floor(os.totalmem() / 1024 / 1024),
    cpuThreads: os.cpus().length,
  });
}

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
  maxPauseMillis: number;
  g1NewSizePercent: number;
  g1MaxNewSizePercent: number;
}

const MEMORY_POLICIES: Array<MemoryPolicy & { maxSystemRamMb: number }> = [
  { maxSystemRamMb: 4608, tier: 'low_memory', fraction: 0.50, reserveMb: 2048, hardMaxMb: 2048, maxPauseMillis: 150, g1NewSizePercent: 20, g1MaxNewSizePercent: 30 },
  { maxSystemRamMb: 6144, tier: 'entry', fraction: 0.50, reserveMb: 2560, hardMaxMb: 3072, maxPauseMillis: 125, g1NewSizePercent: 20, g1MaxNewSizePercent: 35 },
  { maxSystemRamMb: 8192, tier: 'standard', fraction: 0.50, reserveMb: 3072, hardMaxMb: 4096, maxPauseMillis: 100, g1NewSizePercent: 25, g1MaxNewSizePercent: 40 },
  { maxSystemRamMb: 12_288, tier: 'performance', fraction: 0.55, reserveMb: 4096, hardMaxMb: 6144, maxPauseMillis: 90, g1NewSizePercent: 30, g1MaxNewSizePercent: 40 },
  { maxSystemRamMb: 16_384, tier: 'performance', fraction: 0.55, reserveMb: 5120, hardMaxMb: 8192, maxPauseMillis: 85, g1NewSizePercent: 30, g1MaxNewSizePercent: 40 },
  { maxSystemRamMb: Number.POSITIVE_INFINITY, tier: 'high_memory', fraction: 0.60, reserveMb: 6144, hardMaxMb: 10_240, maxPauseMillis: 80, g1NewSizePercent: 30, g1MaxNewSizePercent: 40 },
];

const GENERATOR_REVISION_ARG = '-Dbestiary.jvm.profile=539';

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
  return Math.max(1024, Math.min(byFraction, byReserve, policy.hardMaxMb));
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

function gcThreadArgs(cpuThreads: number): string[] {
  const parallel = cpuThreads <= 2
    ? 1
    : cpuThreads <= 4
      ? 2
      : cpuThreads <= 6
        ? 3
        : cpuThreads <= 8
          ? 4
          : Math.min(8, Math.max(4, Math.floor(cpuThreads / 2)));
  const concurrent = Math.max(1, Math.min(4, Math.floor(parallel / 2)));
  return [`-XX:ParallelGCThreads=${parallel}`, `-XX:ConcGCThreads=${concurrent}`];
}

function pauseTarget(policy: MemoryPolicy, preset: LauncherSettings['performancePreset']): number {
  if (preset === 'quality') return Math.max(150, policy.maxPauseMillis);
  if (preset === 'balanced') return Math.max(100, policy.maxPauseMillis);
  return policy.maxPauseMillis;
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
  const recommendedMaxRamMb = Math.max(1024, roundDown256(Math.min(recommendation.recommended, safeBudgetMb)));
  const recommendedMinRamMb = Math.max(512, Math.min(2048, roundDown256(recommendedMaxRamMb * 0.25)));

  const adaptiveArgs = [
    GENERATOR_REVISION_ARG,
    '-Dfile.encoding=UTF-8',
    '-Dsun.stdout.encoding=UTF-8',
    '-Dsun.stderr.encoding=UTF-8',
    '-XX:+UnlockExperimentalVMOptions',
    '-XX:+UseG1GC',
    '-XX:+ParallelRefProcEnabled',
    '-XX:+DisableExplicitGC',
    '-XX:+PerfDisableSharedMem',
    '-XX:+UseStringDeduplication',
    `-XX:MaxGCPauseMillis=${pauseTarget(policy, settings.performancePreset)}`,
    '-XX:G1HeapWastePercent=5',
    '-XX:G1MixedGCCountTarget=4',
    '-XX:InitiatingHeapOccupancyPercent=15',
    '-XX:G1MixedGCLiveThresholdPercent=90',
    '-XX:G1RSetUpdatingPauseTimePercent=5',
    '-XX:SurvivorRatio=32',
    '-XX:MaxTenuringThreshold=1',
    `-XX:G1NewSizePercent=${policy.g1NewSizePercent}`,
    `-XX:G1MaxNewSizePercent=${policy.g1MaxNewSizePercent}`,
    '-XX:G1ReservePercent=20',
    ...gcThreadArgs(cpuThreads),
  ];

  if (settings.performancePreset === 'performance' && systemRamMb >= 16_384 && recommendedMaxRamMb >= 6144) {
    adaptiveArgs.push('-XX:+AlwaysPreTouch');
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

import os from 'node:os';
import type { LauncherSettings } from '../../shared/ipc';

export interface PersonalMemoryPlan {
  minMb: number;
  maxMb: number;
  constrained: boolean;
  systemRamMb: number;
}

function down256(value: number): number {
  return Math.floor(value / 256) * 256;
}

/**
 * Personal modpacks are user-controlled, but inheriting the global 8192 MB
 * default on a 4 GB PC would starve the OS before the game can boot.
 * Do not touch personal options.txt, keybinds, mods or JVM custom arguments.
 */
export function planPersonalMemory(
  settings: Pick<LauncherSettings, 'minRamMb' | 'maxRamMb'>,
  systemRamMb = Math.floor(os.totalmem() / 1024 / 1024),
): PersonalMemoryPlan {
  const total = Math.max(1024, Math.floor(systemRamMb));
  const reserve = total <= 4608 ? 1536 : total <= 8192 ? 2048 : total <= 16384 ? 3072 : 4096;
  const upper = total <= 4608 ? 2560 : total <= 8192 ? 4096 : total <= 16384 ? 8192 : 12_288;
  const budget = Math.max(1024, down256(Math.min(total * 0.60, total - reserve, upper)));
  const requestedMax = Number.isFinite(settings.maxRamMb) ? Math.max(512, Math.floor(settings.maxRamMb)) : budget;
  const maxMb = Math.max(1024, Math.min(requestedMax, budget));
  const requestedMin = Number.isFinite(settings.minRamMb) ? Math.max(512, Math.floor(settings.minRamMb)) : 1024;
  // Xms is an initial reservation, not a minimum recommended runtime heap.
  const minMb = Math.max(512, Math.min(requestedMin, maxMb, down256(maxMb / 2)));
  return { minMb, maxMb, constrained: maxMb < requestedMax, systemRamMb: total };
}

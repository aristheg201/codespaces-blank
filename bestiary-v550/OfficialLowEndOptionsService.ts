import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type { ClientProfileId } from '../../shared/ipc';

interface Hardware {
  systemRamMb: number;
  cpuThreads: number;
}
interface PerformanceState {
  schema: 1;
  applied: Record<string, string>;
}
export interface PerformanceApplyResult {
  tier: 'low' | 'entry' | 'none';
  changed: number;
  preserved: number;
}

const STATE_PATH = path.join('.bestiary', 'performance-options-state.json');
const BACKUP_PATH = path.join('.bestiary', 'options-before-low-end.bak');

const LOW: Record<string, string> = {
  renderDistance: '6',
  simulationDistance: '5',
  entityDistanceScaling: '0.75',
  particles: '2',
  biomeBlendRadius: '0',
  mipmapLevels: '1',
  maxFps: '60',
  entityShadows: 'false',
  renderClouds: 'false',
};

const ENTRY: Record<string, string> = {
  renderDistance: '8',
  simulationDistance: '5',
  entityDistanceScaling: '0.85',
  particles: '1',
  biomeBlendRadius: '0',
  mipmapLevels: '2',
  maxFps: '75',
  entityShadows: 'false',
};

export function detectLowEndTier(
  profile: ClientProfileId | null,
  hardware: Hardware,
): PerformanceApplyResult['tier'] {
  // Deliberately scoped to SVFrame Official Lite. Full and personal packs
  // retain their own graphics choices.
  if (profile !== 'lite') return 'none';
  if (hardware.systemRamMb <= 4608 || hardware.cpuThreads <= 4) return 'low';
  if (hardware.systemRamMb <= 8192 || hardware.cpuThreads <= 6) return 'entry';
  return 'none';
}

export class OfficialLowEndOptionsService {
  public constructor(private readonly officialGameDirectory: string) {}

  public async apply(
    profile: ClientProfileId | null,
    hardware: Hardware = {
      systemRamMb: Math.floor(os.totalmem() / 1024 / 1024),
      cpuThreads: os.cpus().length,
    },
  ): Promise<PerformanceApplyResult> {
    const tier = detectLowEndTier(profile, hardware);
    if (tier === 'none') return { tier, changed: 0, preserved: 0 };
    const desired = tier === 'low' ? LOW : ENTRY;
    const optionsFile = path.join(this.officialGameDirectory, 'options.txt');
    const stateFile = path.join(this.officialGameDirectory, STATE_PATH);
    const exists = await fs.pathExists(optionsFile);
    const original = exists ? await fs.readFile(optionsFile, 'utf8') : '';
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const lines = original ? original.replace(/\r\n/gu, '\n').split('\n') : [];
    const current = new Map<string, string>();
    for (const line of lines) {
      const separator = line.indexOf(':');
      if (separator > 0) current.set(line.slice(0, separator), line.slice(separator + 1));
    }
    const old = await fs.readJson(stateFile).catch(() => null) as Partial<PerformanceState> | null;
    const applied: PerformanceState['applied'] = old?.schema === 1 && old.applied && typeof old.applied === 'object'
      && !Array.isArray(old.applied) ? old.applied : {};

    const updates = new Map<string, string>();
    let preserved = 0;
    for (const [id, value] of Object.entries(desired)) {
      const existing = current.get(id);
      const previouslyApplied = applied[id];
      if (previouslyApplied !== undefined && existing !== previouslyApplied) {
        // Player changed this setting since our prior Lite optimization.
        preserved += 1;
        continue;
      }
      if (existing !== value) updates.set(id, value);
      applied[id] = value;
    }

    if (updates.size) {
      const seen = new Set<string>();
      const next = lines.map((line) => {
        const at = line.indexOf(':');
        const id = at > 0 ? line.slice(0, at) : '';
        const value = updates.get(id);
        if (value === undefined) return line;
        seen.add(id);
        return id + ':' + value;
      });
      for (const [id, value] of updates) if (!seen.has(id)) next.push(id + ':' + value);
      await fs.ensureDir(path.dirname(stateFile));
      const backupFile = path.join(this.officialGameDirectory, BACKUP_PATH);
      if (exists && !(await fs.pathExists(backupFile))) await fs.copyFile(optionsFile, backupFile);
      const temp = optionsFile + '.bestiary-performance-' + process.pid + '.tmp';
      try {
        await fs.writeFile(temp, next.join(newline), 'utf8');
        await fs.move(temp, optionsFile, { overwrite: true });
      } finally {
        await fs.remove(temp).catch(() => undefined);
      }
    }
    await fs.ensureDir(path.dirname(stateFile));
    await fs.writeJson(stateFile, { schema: 1, applied } satisfies PerformanceState, { spaces: 2 });
    return { tier, changed: updates.size, preserved };
  }
}

import os from 'node:os';
import path from 'node:path';
import fs from 'fs-extra';
import type { LauncherSettings } from '../../shared/ipc';

const STATE_PATH = path.join('.bestiary', 'low-end-graphics-state.json');
const DEFAULTS: Record<string, string> = {
  renderDistance: '12',
  simulationDistance: '12',
  graphicsMode: '1',
  particles: '0',
  renderClouds: 'true',
  entityShadows: 'true',
  entityDistanceScaling: '1.0',
  biomeBlendRadius: '2',
  mipmapLevels: '4',
  enableVsync: 'true',
  maxFps: '120',
};

function recommendations(systemRamMb: number): Record<string, string> {
  const constrained = systemRamMb <= 4608;
  return {
    renderDistance: constrained ? '5' : systemRamMb <= 6144 ? '6' : '8',
    simulationDistance: '5',
    graphicsMode: '0',
    particles: constrained ? '2' : '1',
    renderClouds: 'false',
    entityShadows: 'false',
    entityDistanceScaling: '0.75',
    biomeBlendRadius: '0',
    mipmapLevels: constrained ? '0' : '2',
    enableVsync: 'false',
    maxFps: '60',
  };
}

/**
 * Non-destructive first-use graphics tuning for SVFrame Official 1.21.1.
 * Changes only missing or known vanilla-default keys; does not change any
 * player-customized values, keybinds, audio, resource packs or personal packs.
 * Once recorded, the launcher never writes graphics settings again.
 */
export class LowEndGraphicsService {
  public constructor(private readonly officialGameDirectory: string) {}

  public async apply(settings: Pick<LauncherSettings, 'clientProfile' | 'performancePreset'>): Promise<{ changed: number; reason: string }> {
    const systemRamMb = Math.floor(os.totalmem() / (1024 * 1024));
    const enabled = systemRamMb <= 6144
      || settings.clientProfile === 'lite'
      || settings.performancePreset === 'quality';
    if (!enabled) return { changed: 0, reason: 'normal-hardware' };

    const stateFile = path.join(this.officialGameDirectory, STATE_PATH);
    if (await fs.pathExists(stateFile)) return { changed: 0, reason: 'player-settings-preserved' };
    const optionsFile = path.join(this.officialGameDirectory, 'options.txt');
    const exists = await fs.pathExists(optionsFile);
    const original = exists ? await fs.readFile(optionsFile, 'utf8') : '';
    const newline = original.includes('\r\n') ? '\r\n' : '\n';
    const lines = original ? original.replace(/\r\n/gu, '\n').split('\n') : ['version:3955'];
    const recommended = recommendations(systemRamMb);
    const changedKeys: Record<string, string> = {};
    const seen = new Set<string>();
    const next = lines.map((line) => {
      const colon = line.indexOf(':');
      if (colon < 1) return line;
      const id = line.slice(0, colon);
      if (!(id in recommended) || seen.has(id)) return line;
      seen.add(id);
      const originalValue = line.slice(colon + 1);
      const defaultValue = DEFAULTS[id];
      if (originalValue !== defaultValue && originalValue !== recommended[id]) return line;
      if (originalValue === recommended[id]) return line;
      changedKeys[id] = recommended[id];
      return id + ':' + recommended[id];
    });
    for (const [key, value] of Object.entries(recommended)) {
      if (seen.has(key)) continue;
      next.push(key + ':' + value);
      changedKeys[key] = value;
    }

    if (!next.some((line) => /^version:\d+$/u.test(line)) && !original.trim()) {
      next.unshift('version:3955');
    }
    const target = next.join(newline).replace(/\n+$/u, '') + newline;
    if (target !== original) {
      await fs.ensureDir(path.dirname(optionsFile));
      if (exists) await fs.copy(optionsFile, optionsFile + '.bestiary-graphics.bak', { overwrite: true });
      const tmp = optionsFile + '.' + process.pid + '.graphics.tmp';
      await fs.writeFile(tmp, target, 'utf8');
      await fs.move(tmp, optionsFile, { overwrite: true });
    }
    await fs.ensureDir(path.dirname(stateFile));
    const tmp = stateFile + '.' + process.pid + '.tmp';
    await fs.writeJson(tmp, {
      schema: 1,
      appliedAt: Date.now(),
      systemRamMb,
      clientProfile: settings.clientProfile,
      preset: settings.performancePreset,
      changedKeys,
    }, { spaces: 2 });
    await fs.move(tmp, stateFile, { overwrite: true });
    return { changed: Object.keys(changedKeys).length, reason: 'first-use-low-end' };
  }
}

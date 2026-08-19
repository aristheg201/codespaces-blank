import path from 'node:path';
import fs from 'fs-extra';
import type { ClientProfileId, LauncherSettings, PerformancePreset } from '../../shared/ipc';

export const DEFAULT_SETTINGS: LauncherSettings = {
  username: '',
  minRamMb: 2048,
  maxRamMb: 8192,
  width: 1280,
  height: 720,
  fullscreen: false,
  performancePreset: 'performance',
  clientProfile: null,
  customJvmArgs: '',
  generatedJvmArgs: [],
};

const PRESETS = new Set<PerformancePreset>(['balanced', 'performance', 'quality', 'custom']);
const PROFILES = new Set<ClientProfileId>(['full', 'lite']);

export class SettingsStore {
  private readonly filePath: string;

  public constructor(dataRoot: string) {
    this.filePath = path.join(dataRoot, 'settings.json');
  }

  public async load(): Promise<LauncherSettings> {
    try {
      const raw = await fs.readJson(this.filePath);
      return this.validate(raw);
    } catch {
      return { ...DEFAULT_SETTINGS, generatedJvmArgs: [] };
    }
  }

  public async save(input: LauncherSettings): Promise<LauncherSettings> {
    const validated = this.validate(input);
    await fs.ensureDir(path.dirname(this.filePath));
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeJson(tempPath, validated, { spaces: 2 });
    await fs.move(tempPath, this.filePath, { overwrite: true });
    return validated;
  }

  private validate(raw: unknown): LauncherSettings {
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const username = typeof obj.username === 'string' ? obj.username.trim().slice(0, 16) : '';
    const minRamMb = this.int(obj.minRamMb, DEFAULT_SETTINGS.minRamMb, 512, 131_072);
    const maxRamMb = this.int(obj.maxRamMb, DEFAULT_SETTINGS.maxRamMb, minRamMb, 131_072);
    const width = this.int(obj.width, DEFAULT_SETTINGS.width, 640, 7680);
    const height = this.int(obj.height, DEFAULT_SETTINGS.height, 480, 4320);
    const fullscreen = typeof obj.fullscreen === 'boolean' ? obj.fullscreen : DEFAULT_SETTINGS.fullscreen;
    const preset = PRESETS.has(obj.performancePreset as PerformancePreset)
      ? (obj.performancePreset as PerformancePreset)
      : DEFAULT_SETTINGS.performancePreset;
    const clientProfile = PROFILES.has(obj.clientProfile as ClientProfileId)
      ? (obj.clientProfile as ClientProfileId)
      : null;
    const customJvmArgs = typeof obj.customJvmArgs === 'string'
      ? obj.customJvmArgs.replace(/\0/g, '').slice(0, 8192)
      : '';
    const generatedJvmArgs = Array.isArray(obj.generatedJvmArgs)
      ? obj.generatedJvmArgs
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.replace(/\0/g, '').trim())
          .filter((value) => value.length > 0 && value.length <= 4096 && !/^-Xm[sx]/u.test(value))
          .slice(0, 128)
      : [];

    return {
      username,
      minRamMb,
      maxRamMb,
      width,
      height,
      fullscreen,
      performancePreset: preset,
      clientProfile,
      customJvmArgs,
      generatedJvmArgs: [...new Set(generatedJvmArgs)],
    };
  }

  private int(value: unknown, fallback: number, min: number, max: number): number {
    return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
  }
}

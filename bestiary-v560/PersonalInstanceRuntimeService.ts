import path from 'node:path';
import os from 'node:os';
import fs from 'fs-extra';
import axios from 'axios';
import type { LauncherSettings, ModpackInfo, ModpackRuntimeSettings } from '../../shared/ipc';
import { validateModpackSelection } from './LoaderCatalog';
import { planPersonalMemory } from './PersonalMemory';

/**
 * Per-instance runtime configuration inspired by the *architecture* of
 * Prism's MinecraftInstance/PackProfile. This is original TypeScript, not
 * Prism source. Official SVFrame configuration is NEVER read or modified here.
 */
export type ManagedJavaMajor = 8 | 17 | 21 | 25;
export type PersonalInstanceRuntimeSettings = ModpackRuntimeSettings;
export interface PersonalRuntimePlan {
  gameDirectory: string;
  minecraftVersion: string;
  loader: ModpackInfo['loader'];
  loaderVersion: string | null;
  javaMajor: ManagedJavaMajor;
  javaSource: 'mojang' | 'instance' | 'fallback' | 'override';
  memory: { minMb: number; maxMb: number };
  constrained: boolean;
  jvmArgs: string[];
}

const DEFAULT_SETTINGS: PersonalInstanceRuntimeSettings = {
  schema: 1, javaMajor: null, minRamMb: null, maxRamMb: null,
};
const VERSION_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const HTTP_OPTIONS = { timeout: 15_000, maxContentLength: 4 * 1024 * 1024 };
const cache = new Map<string, { timestamp: number; javaMajor: number }>();

/** Explicit fallback only for versions with a known Java requirement. */
export function knownJavaMajor(version: string): ManagedJavaMajor {
  if (!/^(?:1\.\d{1,2}(?:\.\d{1,2})?|\d{2}\.\d{1,2}(?:\.\d{1,2})?)$/u.test(version)) {
    throw new Error('Minecraft version không hợp lệ.');
  }
  const parts = version.split('.').map((value) => Number.parseInt(value, 10));
  if (parts[0] !== 1) return 25; // 2026+ year-based releases; verify via Mojang metadata.
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  if (minor < 17) return 8;
  if (minor <= 20 && (minor !== 20 || patch <= 4)) return 17;
  return 21;
}

function acceptedJavaMajor(value: unknown): value is ManagedJavaMajor {
  return value === 8 || value === 17 || value === 21 || value === 25;
}
function acceptedMemory(value: unknown): value is number | null {
  return value === null || (Number.isInteger(value) && typeof value === 'number' && value >= 512 && value <= 32768);
}
export function normalizePersonalRuntimeSettings(input: unknown): PersonalInstanceRuntimeSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Cấu hình Java/RAM của modpack không hợp lệ.');
  }
  const value = input as Partial<PersonalInstanceRuntimeSettings>;
  if (value.schema !== 1 ||
      !(value.javaMajor === null || acceptedJavaMajor(value.javaMajor)) ||
      !acceptedMemory(value.minRamMb) || !acceptedMemory(value.maxRamMb)) {
    throw new Error('Cấu hình Java/RAM cần schema 1, Java auto/8/17/21/25 và RAM 512–32768 MB.');
  }
  if (value.minRamMb !== null && value.maxRamMb !== null && value.minRamMb > value.maxRamMb) {
    throw new Error('RAM tối thiểu không thể lớn hơn RAM tối đa.');
  }
  return { schema: 1, javaMajor: value.javaMajor!, minRamMb: value.minRamMb!, maxRamMb: value.maxRamMb! };
}
async function safeReadJavaMetadata(gameDirectory: string, version: string): Promise<number | null> {
  const file = path.join(gameDirectory, 'versions', version, version + '.json');
  if (!(await fs.pathExists(file))) return null;
  const local = await fs.readJson(file).catch(() => null) as { id?: string; javaVersion?: { majorVersion?: number } } | null;
  const major = local?.javaVersion?.majorVersion;
  return local?.id === version && Number.isInteger(major) ? major! : null;
}
async function remoteJavaMetadata(version: string): Promise<number | null> {
  const cached = cache.get(version);
  if (cached && Date.now() - cached.timestamp < 600_000) return cached.javaMajor;
  const manifest = (await axios.get<{ versions?: Array<{ id: string; type: string; url: string }> }>(
    VERSION_MANIFEST, HTTP_OPTIONS)).data;
  const entry = manifest?.versions?.find((x) => x.id === version && x.type === 'release');
  if (!entry || !/^https:\/\/(?:piston-meta|launchermeta)\.mojang\.com\//u.test(entry.url)) {
    throw new Error('Không có metadata Minecraft release hợp lệ từ Mojang: ' + version);
  }
  const meta = (await axios.get<{ id?: string; javaVersion?: { majorVersion?: number } }>(
    entry.url, HTTP_OPTIONS)).data;
  if (meta?.id !== version) throw new Error('Mojang metadata Minecraft version không khớp.');
  const major = meta.javaVersion?.majorVersion ?? null;
  if (major !== null) cache.set(version, { timestamp: Date.now(), javaMajor: major });
  return major;
}

export class PersonalInstanceRuntimeService {
  private readonly gameDirectory: string;
  private readonly configFile: string;
  public constructor(gameDirectory: string) {
    this.gameDirectory = path.resolve(gameDirectory);
    this.configFile = path.join(this.gameDirectory, '.bestiary', 'personal-runtime.json');
  }

  private async ensureNotSymlink(): Promise<void> {
    for (const candidate of [this.gameDirectory, path.dirname(this.configFile), this.configFile]) {
      if (await fs.pathExists(candidate) && (await fs.lstat(candidate)).isSymbolicLink()) {
        throw new Error('Runtime modpack không được dùng symlink để truy cập cấu hình ngoài instance.');
      }
    }
  }
  public async snapshot(): Promise<PersonalInstanceRuntimeSettings> {
    await this.ensureNotSymlink();
    if (!(await fs.pathExists(this.configFile))) return { ...DEFAULT_SETTINGS };
    const stat = await fs.stat(this.configFile);
    if (!stat.isFile() || stat.size > 8192) throw new Error('File personal-runtime.json không hợp lệ.');
    return normalizePersonalRuntimeSettings(await fs.readJson(this.configFile));
  }
  public async save(input: unknown): Promise<PersonalInstanceRuntimeSettings> {
    const options = normalizePersonalRuntimeSettings(input);
    await this.ensureNotSymlink();
    await fs.ensureDir(path.dirname(this.configFile));
    const temporary = this.configFile + '.' + process.pid + '.tmp';
    try {
      await fs.writeJson(temporary, options, { spaces: 2 });
      await fs.move(temporary, this.configFile, { overwrite: true });
    } finally {
      await fs.remove(temporary).catch(() => undefined);
    }
    return options;
  }

  public async prepare(
    pack: ModpackInfo,
    global: Pick<LauncherSettings, 'minRamMb' | 'maxRamMb' | 'generatedJvmArgs'>,
    hardwareMb = Math.floor(os.totalmem() / 1024 / 1024),
  ): Promise<PersonalRuntimePlan> {
    validateModpackSelection(pack);
    await this.ensureNotSymlink();
    const overrides = await this.snapshot();
    let rawMajor: number | null = await safeReadJavaMetadata(this.gameDirectory, pack.minecraftVersion);
    let javaSource: PersonalRuntimePlan['javaSource'] = rawMajor !== null ? 'instance' : 'mojang';
    if (rawMajor === null) {
      try {
        rawMajor = await remoteJavaMetadata(pack.minecraftVersion);
      } catch (error) {
        // Installed older packs must still open offline, but never invent a Java
        // major for unknown future Minecraft releases.
        if (/^1\.(?:[0-9]|1[0-9]|2[0-5])(?:\.|$)/u.test(pack.minecraftVersion)) {
          rawMajor = knownJavaMajor(pack.minecraftVersion);
          javaSource = 'fallback';
        } else {
          throw error;
        }
      }
    }
    if (rawMajor === null) {
      rawMajor = knownJavaMajor(pack.minecraftVersion);
      javaSource = 'fallback';
    }
    if (!acceptedJavaMajor(rawMajor)) {
      throw new Error('Minecraft ' + pack.minecraftVersion + ' yêu cầu Java ' + rawMajor +
        ', launcher hiện chưa có runtime quản lý tương ứng; không tự dùng Java sai phiên bản.');
    }
    const expectedMajor = rawMajor;
    const javaMajor = overrides.javaMajor ?? expectedMajor;
    if (javaMajor !== expectedMajor) {
      throw new Error('Java ' + javaMajor + ' không tương thích yêu cầu Mojang Java ' +
        expectedMajor + ' của Minecraft ' + pack.minecraftVersion + '. Chọn AUTO.');
    }
    if (overrides.javaMajor !== null) javaSource = 'override';

    const maxRamMb = overrides.maxRamMb ?? global.maxRamMb;
    const minRamMb = overrides.minRamMb ?? global.minRamMb;
    const budget = planPersonalMemory({ minRamMb, maxRamMb }, hardwareMb);
    // Never inherit Official JVM flags, manager policy, keybinds or
    // resource settings. Per-instance custom JVM args have their own editor.
    const args: string[] = [];
    return {
      gameDirectory: this.gameDirectory,
      minecraftVersion: pack.minecraftVersion,
      loader: pack.loader,
      loaderVersion: pack.loaderVersion,
      javaMajor,
      javaSource,
      memory: { minMb: budget.minMb, maxMb: budget.maxMb },
      constrained: budget.constrained,
      jvmArgs: args,
    };
  }
}

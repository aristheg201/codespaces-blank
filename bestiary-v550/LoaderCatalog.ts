import axios from 'axios';
import type { ModpackLoader, ModpackSelection } from '../../shared/ipc';

/**
 * Version catalogs are resolved only from Mojang and the official loader projects.
 * No user-provided URL or arbitrary project is executed.
 */
const MOJANG = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const NEOFORGE_META = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml';
const FORGE_META = 'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml';
const TTL_MS = 10 * 60_000;
const MC_PATTERN = /^(?:1\.\d{1,2}(?:\.\d{1,2})?|\d{2}\.\d{1,2}(?:\.\d{1,2})?)$/u;
const LOADER_VERSION_PATTERN = /^[0-9][0-9A-Za-z.+_-]{0,64}$/u;
const cache = new Map<string, { expiresAt: number; value: string[] }>();

interface MojangVersion { id: string; type: string; url: string; }
interface MojangManifest { versions: MojangVersion[]; }
interface LoaderEntry { loader?: { version?: string }; version?: string; }

function versionParts(value: string): number[] {
  return value.split(/[^0-9]+/u).filter(Boolean).map((v) => Number.parseInt(v, 10));
}
function newestFirst(a: string, b: string): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if ((left[i] ?? 0) !== (right[i] ?? 0)) return (right[i] ?? 0) - (left[i] ?? 0);
  }
  return a.localeCompare(b);
}
function preferStable(a: string, b: string): number {
  const aPreview = /(?:beta|alpha|snapshot|pre|rc)/iu.test(a);
  const bPreview = /(?:beta|alpha|snapshot|pre|rc)/iu.test(b);
  return aPreview === bPreview ? newestFirst(a, b) : aPreview ? 1 : -1;
}
function xmlVersions(raw: string): string[] {
  const matches = raw.matchAll(/<version>([^<]{1,120})<\/version>/gu);
  return Array.from(matches, (match) => match[1]);
}
function neoforgePrefix(minecraft: string): string {
  const segments = minecraft.split('.');
  if (segments[0] === '1') {
    return `${segments[1]}.${segments[2] ?? '0'}.`;
  }
  return `${segments[0]}.${segments[1] ?? '0'}.${segments[2] ?? '0'}.`;
}
function validateMc(minecraft: string): void {
  if (!MC_PATTERN.test(minecraft)) throw new Error('Minecraft version không hợp lệ.');
}
export function validateModpackSelection(selection: ModpackSelection): void {
  if (!selection || typeof selection.minecraftVersion !== 'string') throw new Error('Thiếu Minecraft version.');
  validateMc(selection.minecraftVersion);
  if (!['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'].includes(selection.loader)) {
    throw new Error('Mod loader không được hỗ trợ.');
  }
  if (selection.loader === 'vanilla') {
    if (selection.loaderVersion !== null && selection.loaderVersion !== '') {
      throw new Error('Vanilla không có mod loader version.');
    }
  } else if (typeof selection.loaderVersion !== 'string' || !LOADER_VERSION_PATTERN.test(selection.loaderVersion)) {
    throw new Error('Mod loader version không hợp lệ.');
  }
  if (selection.loader === 'neoforge') {
    if (!selection.loaderVersion?.startsWith(neoforgePrefix(selection.minecraftVersion))) {
      throw new Error('NeoForge version không khớp Minecraft version đã chọn.');
    }
  }
}

export class LoaderCatalog {
  private static async cached(key: string, fetcher: () => Promise<string[]>): Promise<string[]> {
    const value = cache.get(key);
    if (value && value.expiresAt > Date.now()) return [...value.value];
    const fresh = await fetcher();
    const deduplicated = Array.from(new Set(fresh));
    cache.set(key, { value: deduplicated, expiresAt: Date.now() + TTL_MS });
    return [...deduplicated];
  }

  public static async minecraftVersions(): Promise<string[]> {
    return this.cached('minecraft:release', async () => {
      const response = await axios.get<MojangManifest>(MOJANG, { timeout: 20_000, maxContentLength: 4_000_000 });
      if (!Array.isArray(response.data?.versions)) throw new Error('Mojang version manifest không hợp lệ.');
      return response.data.versions.filter((entry) =>
        entry.type === 'release' && MC_PATTERN.test(entry.id) && !entry.id.startsWith('1.0')
      ).map((entry) => entry.id);
    });
  }

  public static async loaderVersions(mc: string, loader: ModpackLoader): Promise<string[]> {
    validateMc(mc);
    if (loader === 'vanilla') return [];
    if (!['fabric', 'quilt', 'forge', 'neoforge'].includes(loader)) throw new Error('Loader không hợp lệ.');
    return this.cached(`loader:${loader}:${mc}`, async () => {
      let versions: string[];
      if (loader === 'fabric' || loader === 'quilt') {
        const base = loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
        const response = await axios.get<LoaderEntry[]>(`${base}/versions/loader/${encodeURIComponent(mc)}`, {
          timeout: 20_000, maxContentLength: 3_000_000,
          headers: { 'User-Agent': 'BestiaryLauncher/5.5.0' },
        });
        versions = Array.isArray(response.data) ? response.data.map((entry) => entry.loader?.version || entry.version || '') : [];
      } else if (loader === 'neoforge') {
        const response = await axios.get<string>(NEOFORGE_META, { timeout: 25_000, responseType: 'text', maxContentLength: 4_000_000 });
        const prefix = neoforgePrefix(mc);
        versions = xmlVersions(response.data).filter((value) => value.startsWith(prefix));
      } else {
        const response = await axios.get<string>(FORGE_META, { timeout: 25_000, responseType: 'text', maxContentLength: 4_000_000 });
        versions = xmlVersions(response.data).filter((value) => value.startsWith(mc + '-'))
          .map((value) => value.slice(mc.length + 1));
      }
      const filtered = versions.filter((value) => LOADER_VERSION_PATTERN.test(value));
      return filtered.sort(preferStable);
    });
  }

  public static async assertPublishedSelection(selection: ModpackSelection): Promise<void> {
    validateModpackSelection(selection);
    const versions = await this.minecraftVersions();
    if (!versions.includes(selection.minecraftVersion)) throw new Error('Minecraft version chưa được Mojang phát hành.');
    if (selection.loader !== 'vanilla') {
      const loaders = await this.loaderVersions(selection.minecraftVersion, selection.loader);
      if (!loaders.includes(selection.loaderVersion!)) {
        throw new Error('Loader version không tồn tại cho Minecraft version đã chọn.');
      }
    }
  }
}

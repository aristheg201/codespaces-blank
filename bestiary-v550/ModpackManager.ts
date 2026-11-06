import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import type { LibraryImportResult, LibrarySnapshot, ModpackInfo } from '../../shared/ipc';
import { ContentManager } from './ContentManager';
import { LoaderCatalog, validateModpackSelection, type ModpackSelection } from './LoaderCatalog';

const INSTANCE_VERSION = '1.21.1';
const FABRIC_LOADER = '0.18.4';
const ALLOWED_ROOTS = new Set([
  'mods', 'config', 'defaultconfigs', 'resourcepacks', 'shaderpacks',
  'kubejs', 'scripts', 'saves', 'datapacks',
]);
const MAX_ENTRIES = 5000;
const MAX_UNCOMPRESSED_BYTES = 3 * 1024 * 1024 * 1024;

function checkedId(value: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/iu.test(value)) {
    throw new Error('ID modpack không hợp lệ.');
  }
  return value;
}

function checkedName(value: string): string {
  if (typeof value !== 'string') throw new Error('Tên modpack không hợp lệ.');
  const name = value.trim().replace(/[\x00-\x1f]/gu, '');
  if (name.length < 2 || name.length > 64) throw new Error('Tên modpack phải có 2–64 ký tự.');
  return name;
}

function checkedRelative(value: string): string {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('\x00') || value.startsWith('/')) {
    throw new Error('Đường dẫn trong modpack không hợp lệ.');
  }
  const chunks = value.split('/');
  if (chunks.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('Đường dẫn trong modpack không hợp lệ.');
  }
  if (!ALLOWED_ROOTS.has(chunks[0]) || chunks.length < 2) {
    throw new Error('Nội dung modpack không thuộc thư mục hỗ trợ.');
  }
  return chunks.join('/');
}

function parseArchiveJson(zip: AdmZip, name: string): unknown {
  const entry = zip.getEntry(name);
  if (!entry) return null;
  if (entry.header.size > 128 * 1024) throw new Error('Manifest quá lớn.');
  return JSON.parse(entry.getData().toString('utf8')) as unknown;
}

function isFileEntry(entry: { isDirectory: boolean; entryName: string; header: { attr: number } }): boolean {
  const mode = (entry.header.attr >>> 16) & 0o170000;
  if (mode === 0o120000) throw new Error('Modpack ZIP chứa symbolic link không an toàn.');
  return !entry.isDirectory;
}

export class ModpackManager {
  private readonly root: string;

  constructor(dataRoot: string) {
    this.root = path.join(path.resolve(dataRoot), 'modpacks');
  }

  public async list(): Promise<ModpackInfo[]> {
    await fs.ensureDir(this.root);
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const packs: ModpackInfo[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/iu.test(entry.name)) continue;
      try { packs.push(await this.read(entry.name)); } catch { /* Ignore corrupt profiles; do not delete them. */ }
    }
    return packs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  public async read(id: string): Promise<ModpackInfo> {
    const json = await fs.readJson(this.metaPath(id)) as Partial<ModpackInfo>;
    if (json.id !== id || typeof json.createdAt !== 'string' ||
        typeof json.updatedAt !== 'string' || typeof json.name !== 'string') {
      throw new Error('Metadata modpack không hợp lệ.');
    }
    // Read previous 5.4.8/5.4.9 Fabric-only packs without resetting users' saves.
    const selected: ModpackSelection = {
      minecraftVersion: json.minecraftVersion || INSTANCE_VERSION,
      loader: json.loader || 'fabric',
      loaderVersion: json.loaderVersion ?? (json.loader === 'vanilla' ? null : json.fabricLoader ?? FABRIC_LOADER),
    };
    validateModpackSelection(selected);
    return { ...json, ...selected, id, name: json.name, createdAt: json.createdAt,
      updatedAt: json.updatedAt } as ModpackInfo;
  }

  public instanceDirectory(id: string): string {
    return path.join(this.root, checkedId(id), 'instance');
  }

  private metaPath(id: string): string {
    return path.join(this.root, checkedId(id), 'modpack.json');
  }

  private async content(id: string): Promise<ContentManager> {
    const pack = await this.read(id);
    return new ContentManager(this.instanceDirectory(id), path.join(this.root, id, '.managed-ownership.json'), pack.loader);
  }

  public async create(name: string, selection?: ModpackSelection): Promise<ModpackInfo> {
    const selected: ModpackSelection = selection ?? {
      minecraftVersion: INSTANCE_VERSION, loader: 'fabric', loaderVersion: FABRIC_LOADER,
    };
    if (selection) await LoaderCatalog.assertPublishedSelection(selected);
    return this.createUnchecked(name, selected);
  }

  private async createUnchecked(name: string, selected: ModpackSelection): Promise<ModpackInfo> {
    validateModpackSelection(selected);
    const now = new Date().toISOString();
    const pack: ModpackInfo = {
      id: crypto.randomUUID(), name: checkedName(name),
      ...selected,
      ...(selected.loader === 'fabric' ? { fabricLoader: selected.loaderVersion! } : {}),
      createdAt: now, updatedAt: now,
    };
    await fs.ensureDir(this.instanceDirectory(pack.id));
    for (const dir of ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves']) {
      await fs.ensureDir(path.join(this.instanceDirectory(pack.id), dir));
    }
    await this.save(pack);
    return pack;
  }

  public async rename(id: string, name: string): Promise<ModpackInfo> {
    const pack = await this.read(id);
    pack.name = checkedName(name);
    pack.updatedAt = new Date().toISOString();
    await this.save(pack);
    return pack;
  }

  public async duplicate(id: string, name?: string): Promise<ModpackInfo> {
    const original = await this.read(id);
    const clone = await this.createUnchecked(name ?? original.name.slice(0, 56) + ' (Copy)', {
      minecraftVersion: original.minecraftVersion,
      loader: original.loader, loaderVersion: original.loaderVersion,
    });
    try {
      await fs.copy(this.instanceDirectory(id), this.instanceDirectory(clone.id), {
        overwrite: true, filter: async (source) => !(await fs.lstat(source)).isSymbolicLink(),
      });
      return clone;
    } catch (error) {
      await fs.remove(path.dirname(this.instanceDirectory(clone.id)));
      throw error;
    }
  }

  public async remove(id: string): Promise<void> {
    await this.read(id);
    await fs.remove(path.dirname(this.instanceDirectory(id)));
  }

  public async snapshot(id: string): Promise<LibrarySnapshot> {
    await this.read(id);
    return (await this.content(id)).snapshot();
  }

  public async installFiles(id: string, paths: string[]): Promise<LibraryImportResult> {
    await this.read(id);
    if (!Array.isArray(paths) || paths.length > 100 || paths.some((value) => typeof value !== 'string')) {
      throw new Error('Danh sách file không hợp lệ.');
    }
    const result = await (await this.content(id)).importAuto(paths);
    await this.touch(id);
    return result;
  }

  public async toggleFile(id: string, relative: string): Promise<LibrarySnapshot> {
    await this.read(id);
    const result = await (await this.content(id)).toggle(relative);
    await this.touch(id);
    return result;
  }

  public async removeFile(id: string, relative: string): Promise<LibrarySnapshot> {
    await this.read(id);
    const result = await (await this.content(id)).remove(relative);
    await this.touch(id);
    return result;
  }

  public async importZip(sourcePath: string): Promise<ModpackInfo> {
    const zip = new AdmZip(sourcePath);
    const entries = zip.getEntries();
    if (entries.length > MAX_ENTRIES) throw new Error('ZIP có quá nhiều mục.');
    const localManifest = parseArchiveJson(zip, 'svframe-modpack.json') as Record<string, unknown> | null;
    const curseforgeManifest = parseArchiveJson(zip, 'manifest.json') as Record<string, unknown> | null;
    if (!localManifest && !curseforgeManifest) {
      throw new Error('ZIP thiếu svframe-modpack.json hoặc CurseForge manifest.json.');
    }
    let selection: ModpackSelection;
    if (curseforgeManifest && !localManifest) {
      const external = curseforgeManifest.files;
      if (Array.isArray(external) && external.length > 0) {
        throw new Error('ZIP CurseForge cần download projectID/fileID; không thể import thiếu mod.');
      }
      const minecraft = curseforgeManifest.minecraft as Record<string, unknown> | undefined;
      const modLoaders = Array.isArray(minecraft?.modLoaders)
        ? minecraft.modLoaders as Array<{ id?: string; primary?: boolean }> : [];
      const primary = modLoaders.find((item) => item.primary) ?? modLoaders[0];
      const id = primary?.id ?? '';
      const dash = id.indexOf('-');
      const loader = dash < 0 ? 'vanilla' : id.slice(0, dash);
      const version = dash < 0 ? null : id.slice(dash + 1);
      selection = {
        minecraftVersion: String(minecraft?.version ?? ''),
        loader: loader as ModpackInfo['loader'],
        loaderVersion: version,
      };
    } else {
      const meta = localManifest!;
      selection = {
        minecraftVersion: String(meta.minecraftVersion ?? ''),
        loader: (meta.loader ?? 'fabric') as ModpackInfo['loader'],
        loaderVersion: (meta.loaderVersion ?? meta.fabricLoader ?? null) as string | null,
      };
    }
    validateModpackSelection(selection);
    const meta = localManifest ?? curseforgeManifest!;
    const mapped: Array<{ relative: string; entry: (typeof entries)[number] }> = [];
    let total = 0;
    for (const entry of entries) {
      if (!isFileEntry(entry)) continue;
      if (['manifest.json', 'svframe-modpack.json'].includes(entry.entryName)) continue;
      if (!entry.entryName.startsWith('overrides/')) continue;
      const relative = checkedRelative(entry.entryName.slice('overrides/'.length));
      total += entry.header.size;
      if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('Modpack ZIP vượt 3 GB giải nén.');
      mapped.push({ relative, entry });
    }
    const pack = await this.createUnchecked(checkedName(String(meta.name ?? 'Imported Modpack')), selection);
    try {
      for (const item of mapped) {
        const target = path.resolve(this.instanceDirectory(pack.id), item.relative);
        if (!target.startsWith(this.instanceDirectory(pack.id) + path.sep)) throw new Error('ZIP traversal bị chặn.');
        await fs.ensureDir(path.dirname(target));
        await fs.writeFile(target, item.entry.getData());
      }
      await this.touch(pack.id);
      return await this.read(pack.id);
    } catch (error) {
      await fs.remove(path.dirname(this.instanceDirectory(pack.id)));
      throw error;
    }
  }

  public async exportZip(id: string, destinationPath: string, includeWorlds = false): Promise<void> {
    const pack = await this.read(id);
    if (!destinationPath.toLowerCase().endsWith('.zip')) throw new Error('File xuất phải có đuôi .zip.');
    if (path.resolve(destinationPath).startsWith(this.instanceDirectory(id) + path.sep)) {
      throw new Error('Không thể xuất ZIP vào chính thư mục game.');
    }
    const zip = new AdmZip();
    zip.addFile('svframe-modpack.json', Buffer.from(JSON.stringify({
      schema: 1, name: pack.name, minecraftVersion: pack.minecraftVersion,
      loader: pack.loader, loaderVersion: pack.loaderVersion,
      ...(pack.loader === 'fabric' ? { fabricLoader: pack.loaderVersion } : {}),
    }, null, 2)));
    // Self-contained private ZIP, not an official CurseForge-submission manifest.
    const walk = async (directory: string, prefix = ''): Promise<void> => {
      for (const item of await fs.readdir(directory, { withFileTypes: true })) {
        if (item.isSymbolicLink()) continue;
        const relative = prefix ? prefix + '/' + item.name : item.name;
        const root = relative.split('/')[0];
        if (!ALLOWED_ROOTS.has(root) || (!includeWorlds && root === 'saves')) continue;
        const absolute = path.join(directory, item.name);
        if (item.isDirectory()) await walk(absolute, relative);
        else if (item.isFile()) zip.addLocalFile(absolute, path.posix.join('overrides', path.posix.dirname(relative)));
      }
    };
    await walk(this.instanceDirectory(id));
    await fs.ensureDir(path.dirname(path.resolve(destinationPath)));
    const temp = destinationPath + '.' + process.pid + '.tmp';
    try {
      zip.writeZip(temp);
      await fs.move(temp, destinationPath, { overwrite: true });
    } finally {
      await fs.remove(temp);
    }
  }

  private async touch(id: string): Promise<void> {
    const pack = await this.read(id);
    pack.updatedAt = new Date().toISOString();
    await this.save(pack);
  }

  private async save(pack: ModpackInfo): Promise<void> {
    const target = this.metaPath(pack.id);
    await fs.ensureDir(path.dirname(target));
    const temp = target + '.' + process.pid + '.tmp';
    await fs.writeJson(temp, pack, { spaces: 2 });
    await fs.move(temp, target, { overwrite: true });
  }
}

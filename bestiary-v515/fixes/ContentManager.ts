import path from 'node:path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import type { LibraryImportResult, LibraryItem, LibraryKind, LibrarySnapshot } from '../../shared/ipc';

interface OwnershipFile { paths?: string[] }
interface FabricModJson { id?: string; name?: string; version?: string | number }

function normalizeRelative(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\/+/, '');
}

function safeFileName(value: string): string {
  const base = path.basename(value).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  if (!base || base === '.' || base === '..') throw new Error('Tên file không hợp lệ.');
  return base.slice(0, 240);
}

function normalizedArchiveEntries(filePath: string): string[] {
  const zip = new AdmZip(filePath);
  const raw = zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => entry.entryName.replaceAll('\\', '/').replace(/^\/+/, ''));
  if (!raw.length) return [];
  const first = raw[0]?.split('/')[0] ?? '';
  const sharedTop = first && raw.every((name) => name.startsWith(`${first}/`));
  return sharedTop ? raw.map((name) => name.slice(first.length + 1)) : raw;
}

export class ContentManager {
  private readonly gameDirectory: string;
  private readonly ownershipFilePath: string;

  public constructor(gameDirectory: string, ownershipFilePath: string) {
    this.gameDirectory = path.resolve(gameDirectory);
    this.ownershipFilePath = path.resolve(ownershipFilePath);
  }

  public async snapshot(): Promise<LibrarySnapshot> {
    const managed = await this.loadManaged();
    const [mods, resourcepacks, shaderpacks] = await Promise.all([
      this.listKind('mods', managed),
      this.listKind('resourcepacks', managed),
      this.listKind('shaderpacks', managed),
    ]);
    return { mods, resourcepacks, shaderpacks };
  }

  public async importAuto(sourcePaths: string[]): Promise<LibraryImportResult> {
    const imported: LibraryImportResult['imported'] = [];
    const skipped: LibraryImportResult['skipped'] = [];
    for (const raw of [...new Set(sourcePaths.map((item) => path.resolve(item)))]) {
      const fileName = path.basename(raw);
      try {
        const stat = await fs.stat(raw).catch(() => null);
        if (!stat?.isFile()) throw new Error('Không phải file hợp lệ.');
        const kind = await this.classify(raw);
        if (!kind) throw new Error('Không nhận diện được. Chỉ hỗ trợ Fabric mod .jar, resource pack .zip và shader pack .zip.');
        const before = await this.findExistingPersonal(kind, raw);
        if (before === 'same') {
          skipped.push({ fileName, reason: 'Đã cài đúng file này.' });
          continue;
        }
        await this.install(kind, [raw], true);
        const mod = kind === 'mods' ? await this.readMod(raw).catch(() => null) : null;
        imported.push({ fileName, kind, displayName: mod?.name || fileName.replace(/\.(jar|zip)$/i, '') });
      } catch (error) {
        skipped.push({ fileName, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return { snapshot: await this.snapshot(), imported, skipped };
  }

  public async install(kind: LibraryKind, sourcePaths: string[], replacePersonal = false): Promise<LibrarySnapshot> {
    const directory = this.kindDirectory(kind);
    await fs.ensureDir(directory);
    const managed = await this.loadManaged();
    const managedModIds = kind === 'mods' ? await this.readManagedModIds(managed) : new Map<string, string>();

    for (const raw of [...new Set(sourcePaths.map((item) => path.resolve(item)))]) {
      const stat = await fs.stat(raw).catch(() => null);
      if (!stat?.isFile()) continue;
      const lower = raw.toLowerCase();
      if (kind === 'mods' && !lower.endsWith('.jar')) continue;
      if ((kind === 'resourcepacks' || kind === 'shaderpacks') && !lower.endsWith('.zip')) continue;

      const fileName = safeFileName(path.basename(raw));
      const relative = `${kind}/${fileName}`;
      if (managed.has(relative)) throw new Error(`${fileName} đang được Bestiary quản lý, không thể ghi đè bằng file cá nhân.`);

      if (kind === 'mods') {
        const mod = await this.readMod(raw);
        if (!mod?.id) throw new Error(`${fileName} không có fabric.mod.json hợp lệ.`);
        if (managedModIds.has(mod.id)) throw new Error(`${mod.name || mod.id} trùng mod Bestiary (${mod.id}). Hãy dùng đúng phiên bản do server phát hành.`);
        const personal = await this.findPersonalModById(mod.id);
        if (personal && personal !== relative) {
          if (!replacePersonal) throw new Error(`${mod.name} đã tồn tại trong thư viện cá nhân.`);
          await fs.remove(this.resolveInside(personal));
        }
      }

      const target = path.join(directory, fileName);
      if (await fs.pathExists(target)) {
        if (!replacePersonal) throw new Error(`${fileName} đã tồn tại.`);
        await fs.remove(target);
      }
      await fs.copyFile(raw, target);
    }

    return this.snapshot();
  }

  public async toggle(relativePath: string): Promise<LibrarySnapshot> {
    const normalized = normalizeRelative(relativePath);
    const managed = await this.loadManaged();
    if (managed.has(normalized)) throw new Error('File Bestiary managed không thể tắt từ thư viện cá nhân.');
    if (!normalized.startsWith('mods/')) throw new Error('Chỉ mod cá nhân mới hỗ trợ bật/tắt. Resource pack và shader bật trong Minecraft.');
    const absolute = this.resolveInside(normalized);
    if (!(await fs.pathExists(absolute))) throw new Error('Mod không còn tồn tại.');
    let target: string;
    if (normalized.toLowerCase().endsWith('.jar.disabled')) target = absolute.slice(0, -'.disabled'.length);
    else if (normalized.toLowerCase().endsWith('.jar')) target = `${absolute}.disabled`;
    else throw new Error('Định dạng mod không hỗ trợ bật/tắt.');
    if (await fs.pathExists(target)) throw new Error('Đã có file cùng tên ở trạng thái đích.');
    await fs.move(absolute, target);
    return this.snapshot();
  }

  public async remove(relativePath: string): Promise<LibrarySnapshot> {
    const normalized = normalizeRelative(relativePath);
    const managed = await this.loadManaged();
    if (managed.has(normalized)) throw new Error('File Bestiary managed không thể gỡ từ thư viện cá nhân.');
    await fs.remove(this.resolveInside(normalized));
    return this.snapshot();
  }

  public folder(kind: LibraryKind): string { return this.kindDirectory(kind); }

  private async classify(filePath: string): Promise<LibraryKind | null> {
    const lower = filePath.toLowerCase();
    if (lower.endsWith('.jar')) return (await this.readMod(filePath)) ? 'mods' : null;
    if (!lower.endsWith('.zip')) return null;
    const entries = normalizedArchiveEntries(filePath).map((name) => name.toLowerCase());
    const has = (value: string) => entries.includes(value) || entries.some((name) => name.startsWith(value));
    if (has('shaders/') || entries.includes('shaders.properties') || entries.includes('shaderpack.properties')) return 'shaderpacks';
    if (entries.includes('pack.mcmeta') && has('assets/')) return 'resourcepacks';
    if (entries.includes('pack.mcmeta') && has('data/')) throw new Error('Đây là datapack. Datapack phải cài theo world/server, không phải thư viện client toàn cục.');
    return null;
  }

  private async findExistingPersonal(kind: LibraryKind, sourcePath: string): Promise<'same' | 'different' | null> {
    const target = path.join(this.kindDirectory(kind), safeFileName(path.basename(sourcePath)));
    if (!(await fs.pathExists(target))) return null;
    const [a, b] = await Promise.all([fs.readFile(sourcePath), fs.readFile(target)]);
    return a.equals(b) ? 'same' : 'different';
  }

  private async findPersonalModById(modId: string): Promise<string | null> {
    const managed = await this.loadManaged();
    for (const item of await this.listKind('mods', managed)) if (!item.managed && item.modId === modId) return item.path;
    return null;
  }

  private async listKind(kind: LibraryKind, managed: Set<string>): Promise<LibraryItem[]> {
    const directory = this.kindDirectory(kind);
    await fs.ensureDir(directory);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const items: LibraryItem[] = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (kind === 'mods' && !lower.endsWith('.jar') && !lower.endsWith('.jar.disabled')) continue;
      if ((kind === 'resourcepacks' || kind === 'shaderpacks') && !lower.endsWith('.zip')) continue;
      const relative = `${kind}/${entry.name}`;
      const absolute = path.join(directory, entry.name);
      const stat = await fs.stat(absolute);
      const mod = kind === 'mods' ? await this.readMod(absolute).catch(() => null) : null;
      const isManaged = managed.has(relative) || (lower.endsWith('.jar.disabled') && managed.has(relative.slice(0, -'.disabled'.length)));
      items.push({ id: relative, kind, path: relative, fileName: entry.name, displayName: mod?.name || entry.name.replace(/\.(jar(?:\.disabled)?|zip)$/i, ''), version: mod?.version, modId: mod?.id, size: stat.size, managed: isManaged, enabled: kind !== 'mods' || !lower.endsWith('.disabled'), status: isManaged ? 'managed' : kind === 'mods' ? (lower.endsWith('.disabled') ? 'disabled' : 'active') : 'installed' });
    }
    return items.sort((a, b) => Number(b.managed) - Number(a.managed) || a.displayName.localeCompare(b.displayName, 'vi'));
  }

  private async loadManaged(): Promise<Set<string>> {
    try {
      const raw = (await fs.readJson(this.ownershipFilePath)) as OwnershipFile;
      return new Set((raw.paths ?? []).filter((item): item is string => typeof item === 'string').map(normalizeRelative));
    } catch { return new Set<string>(); }
  }

  private async readManagedModIds(managed: Set<string>): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const relative of managed) {
      if (!relative.startsWith('mods/') || !relative.toLowerCase().endsWith('.jar')) continue;
      const absolute = this.resolveInside(relative);
      if (!(await fs.pathExists(absolute))) continue;
      const mod = await this.readMod(absolute).catch(() => null);
      if (mod?.id) map.set(mod.id, relative);
    }
    return map;
  }

  private async readMod(filePath: string): Promise<{ id: string; name: string; version: string } | null> {
    try {
      const zip = new AdmZip(filePath);
      const entry = zip.getEntry('fabric.mod.json');
      if (!entry) return null;
      const raw = JSON.parse(entry.getData().toString('utf8')) as FabricModJson;
      if (typeof raw.id !== 'string' || !raw.id.trim()) return null;
      return { id: raw.id.trim(), name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : raw.id.trim(), version: raw.version === undefined ? '' : String(raw.version) };
    } catch { return null; }
  }

  private kindDirectory(kind: LibraryKind): string { return path.join(this.gameDirectory, kind); }
  private resolveInside(relative: string): string {
    const absolute = path.resolve(this.gameDirectory, ...normalizeRelative(relative).split('/'));
    const rel = path.relative(this.gameDirectory, absolute);
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Đường dẫn không hợp lệ.');
    return absolute;
  }
}

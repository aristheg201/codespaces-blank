import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import type { ClientProfileId, ImportStatus, ManagedFile, PackageImportItem, PackageImportResult, ProgressState, StagedChange, WorkspaceSnapshot } from '../../shared/types';
import { parseFabricMod, resolveInside, safeFileName, scanManagedFiles, sha256File } from './utils';

interface StageDiskState { changes: StagedChange[]; }
const MAX_PACKAGE_JAR_BYTES = 512 * 1024 * 1024;

function hashBuffer(buffer: Buffer): string { return createHash('sha256').update(buffer).digest('hex'); }
function profileFromArchive(filePath: string): ClientProfileId {
  const name = path.basename(filePath, path.extname(filePath)).toLowerCase().replace(/[ _]+/g, '-');
  if (name.includes('android')) return 'android';
  if (name.includes('pc-lite') || /(^|-)lite($|-)/u.test(name)) return 'lite';
  if (/(^|-)full($|-)/u.test(name)) return 'full';
  throw new Error(`${path.basename(filePath)}: tên ZIP phải chứa mods-full, mods-pc-lite hoặc mods-android để Manager biết profile.`);
}
function unionProfiles(a: ClientProfileId[] | undefined, b: ClientProfileId[]): ClientProfileId[] {
  return [...new Set([...(a ?? []), ...b])];
}
function suffixTarget(fileName: string, profile: ClientProfileId): string {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, -ext.length);
  return `mods/${safeFileName(`${stem}-${profile}${ext}`)}`;
}

export class WorkspaceService {
  private root: string | null = null;
  private files: ManagedFile[] = [];
  private staged: StagedChange[] = [];
  private scanning = false;
  private progress?: ProgressState;
  private readonly onProgress?: (progress: ProgressState) => void;

  constructor(onProgress?: (progress: ProgressState) => void) { this.onProgress = onProgress; }
  getRoot(): string | null { return this.root; }
  snapshot(): WorkspaceSnapshot { return { root: this.root, files: this.files, staged: this.staged, scanning: this.scanning, scanProgress: this.progress }; }

  async open(root: string): Promise<WorkspaceSnapshot> {
    const normalized = path.resolve(root);
    await fs.ensureDir(normalized);
    for (const area of ['mods', 'config', 'resourcepacks']) await fs.ensureDir(path.join(normalized, area));
    this.root = normalized;
    await fs.ensureDir(this.metaDir());
    await this.loadStaging();
    return this.rescan();
  }

  async rescan(): Promise<WorkspaceSnapshot> {
    this.assertRoot();
    this.scanning = true;
    this.progress = { phase: 'scan', completed: 0, total: 0, message: 'Đang quét client...' };
    this.onProgress?.(this.progress);
    try {
      this.files = await scanManagedFiles(this.root!, (progress) => { this.progress = progress; this.onProgress?.(progress); });
      return this.snapshot();
    } finally { this.scanning = false; this.progress = undefined; }
  }

  async stageJarFiles(inputPaths: string[]): Promise<WorkspaceSnapshot> {
    this.assertRoot();
    if (!inputPaths.length) return this.snapshot();
    const unique = [...new Set(inputPaths.map((p) => path.resolve(p)))];
    let completed = 0;
    for (const sourcePath of unique) {
      const stat = await fs.stat(sourcePath).catch(() => null);
      if (!stat?.isFile() || !sourcePath.toLowerCase().endsWith('.jar')) continue;
      const mod = await parseFabricMod(sourcePath);
      if (!mod?.id) throw new Error(`${path.basename(sourcePath)} không phải Fabric mod hợp lệ.`);
      const hash = await sha256File(sourcePath);
      const current = this.files.find((file) => file.area === 'mods' && file.mod?.id === mod.id);
      const existingStage = this.staged.find((change) => change.mod?.id === mod.id && change.kind !== 'remove');
      if (existingStage?.stagedPath) await fs.remove(existingStage.stagedPath).catch(() => undefined);
      if (existingStage) this.staged = this.staged.filter((change) => change.id !== existingStage.id);
      await this.pushStagedJar(sourcePath, stat.size, hash, mod, current, undefined, undefined, path.basename(sourcePath));
      completed += 1;
      this.onProgress?.({ phase: 'stage', current: path.basename(sourcePath), completed, total: unique.length, message: `Đã đưa ${path.basename(sourcePath)} vào staging` });
    }
    await this.saveStaging();
    return this.snapshot();
  }

  async stagePackageArchives(inputPaths: string[]): Promise<PackageImportResult> {
    this.assertRoot();
    const archives = [...new Set(inputPaths.map((item) => path.resolve(item)))];
    const items: PackageImportItem[] = [];
    const warnings: string[] = [];
    let packageIndex = 0;
    for (const archivePath of archives) {
      const stat = await fs.stat(archivePath).catch(() => null);
      if (!stat?.isFile() || !archivePath.toLowerCase().endsWith('.zip')) { warnings.push(`${path.basename(archivePath)}: bỏ qua, không phải ZIP.`); continue; }
      const profile = profileFromArchive(archivePath);
      const packageName = path.basename(archivePath);
      const zip = new AdmZip(archivePath);
      const jarEntries = zip.getEntries().filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.jar'));
      if (!jarEntries.length) { warnings.push(`${packageName}: không có file JAR bên trong.`); continue; }
      let entryIndex = 0;
      for (const entry of jarEntries) {
        entryIndex += 1;
        const fileName = safeFileName(path.basename(entry.entryName));
        const declaredSize = Number(entry.header.size || 0);
        if (declaredSize > MAX_PACKAGE_JAR_BYTES) { warnings.push(`${packageName}/${fileName}: JAR quá lớn, bỏ qua.`); continue; }
        const buffer = entry.getData();
        if (!buffer.length || buffer.length > MAX_PACKAGE_JAR_BYTES) { warnings.push(`${packageName}/${fileName}: dữ liệu JAR không hợp lệ.`); continue; }
        const cacheDir = path.join(this.metaDir(), 'imports', randomUUID());
        await fs.ensureDir(cacheDir);
        const extracted = path.join(cacheDir, fileName);
        await fs.writeFile(extracted, buffer);
        const mod = await parseFabricMod(extracted);
        if (!mod?.id) { warnings.push(`${packageName}/${fileName}: không có fabric.mod.json hợp lệ.`); await fs.remove(cacheDir); continue; }
        const hash = hashBuffer(buffer);
        const current = this.files.find((file) => file.area === 'mods' && file.mod?.id === mod.id);
        const status: ImportStatus = !current ? 'new' : current.hash === hash ? 'up_to_date' : current.mod?.version !== mod.version ? 'update' : 'changed';

        if (status === 'up_to_date' && current) {
          items.push({ packageName, profile, fileName, targetPath: current.path, mod, status, currentVersion: current.mod?.version, importedVersion: mod.version, size: buffer.length });
          await fs.remove(cacheDir);
        } else {
          const sameHashStage = this.staged.find((change) => change.kind !== 'remove' && change.mod?.id === mod.id && change.hash === hash);
          let targetPath: string;
          if (sameHashStage) {
            sameHashStage.suggestedProfiles = unionProfiles(sameHashStage.suggestedProfiles, [profile]);
            sameHashStage.packageName = sameHashStage.packageName ? `${sameHashStage.packageName}, ${packageName}` : packageName;
            targetPath = sameHashStage.targetPath;
            await fs.remove(cacheDir);
          } else {
            const preferred = `mods/${fileName}`;
            const collision = this.staged.some((change) => change.kind !== 'remove' && change.targetPath === preferred && change.hash !== hash)
              || (current && current.path === preferred && this.staged.some((change) => change.mod?.id === mod.id && change.hash !== hash));
            targetPath = collision ? suffixTarget(fileName, profile) : preferred;
            await this.pushStagedJar(extracted, buffer.length, hash, mod, current, [profile], status, packageName, targetPath);
            await fs.remove(cacheDir).catch(() => undefined);
          }
          items.push({ packageName, profile, fileName, targetPath, mod, status, currentVersion: current?.mod?.version, importedVersion: mod.version, size: buffer.length });
        }
        this.onProgress?.({ phase: 'package-import', current: `${packageName}/${fileName}`, completed: entryIndex, total: jarEntries.length, message: `${profile.toUpperCase()} · ${mod.name} · ${status}` });
      }
      packageIndex += 1;
      this.onProgress?.({ phase: 'package', current: packageName, completed: packageIndex, total: archives.length, message: `Đã đọc ${packageName}` });
    }
    await this.saveStaging();
    return { snapshot: this.snapshot(), items, warnings };
  }

  async stageRemove(relativePath: string): Promise<WorkspaceSnapshot> {
    this.assertRoot();
    const current = this.files.find((file) => file.path === relativePath);
    if (!current) throw new Error('File không còn tồn tại trong client hiện tại.');
    this.staged = this.staged.filter((change) => change.previousPath !== relativePath && change.targetPath !== relativePath);
    this.staged.push({ id: randomUUID(), kind: 'remove', targetPath: relativePath, previousPath: relativePath, size: current.size, previousMod: current.mod });
    await this.saveStaging();
    return this.snapshot();
  }

  async unstage(id: string): Promise<WorkspaceSnapshot> {
    const change = this.staged.find((item) => item.id === id);
    if (change?.stagedPath) await fs.remove(change.stagedPath).catch(() => undefined);
    this.staged = this.staged.filter((item) => item.id !== id);
    await this.saveStaging();
    return this.snapshot();
  }

  async clearStaging(): Promise<WorkspaceSnapshot> {
    this.assertRoot();
    await fs.remove(path.join(this.metaDir(), 'staging')).catch(() => undefined);
    await fs.remove(path.join(this.metaDir(), 'imports')).catch(() => undefined);
    this.staged = [];
    await this.saveStaging();
    return this.snapshot();
  }

  async applyStaging(): Promise<WorkspaceSnapshot> {
    this.assertRoot();
    if (!this.staged.length) return this.snapshot();
    const transactionId = `${Date.now()}-${randomUUID()}`;
    const transactionRoot = path.join(this.metaDir(), 'history', transactionId);
    const backupRoot = path.join(transactionRoot, 'backup');
    await fs.ensureDir(backupRoot);
    const backups: Array<{ original: string; backup: string }> = [];
    const backedUpPaths = new Set<string>();
    const created = new Set<string>();

    try {
      let completed = 0;
      for (const change of this.staged) {
        const pathsToBackup = new Set<string>();
        if (change.previousPath) pathsToBackup.add(change.previousPath);
        if (change.kind !== 'remove' && change.targetPath !== change.previousPath) {
          const targetAbs = resolveInside(this.root!, change.targetPath);
          if (await fs.pathExists(targetAbs)) pathsToBackup.add(change.targetPath);
        }
        for (const relative of pathsToBackup) {
          if (backedUpPaths.has(relative)) continue;
          const original = resolveInside(this.root!, relative);
          if (!(await fs.pathExists(original))) continue;
          const backup = path.join(backupRoot, ...relative.split('/'));
          await fs.ensureDir(path.dirname(backup));
          await fs.move(original, backup, { overwrite: true });
          backups.push({ original, backup });
          backedUpPaths.add(relative);
        }
        if (change.kind !== 'remove') {
          if (!change.stagedPath || !(await fs.pathExists(change.stagedPath))) throw new Error(`Thiếu file staging: ${change.targetPath}`);
          const target = resolveInside(this.root!, change.targetPath);
          await fs.ensureDir(path.dirname(target));
          await fs.copyFile(change.stagedPath, target);
          created.add(target);
        }
        completed += 1;
        this.onProgress?.({ phase: 'apply', current: change.targetPath, completed, total: this.staged.length, message: `Đang áp dụng ${change.targetPath}` });
      }
      await fs.writeJson(path.join(transactionRoot, 'changes.json'), { appliedAt: Date.now(), changes: this.staged }, { spaces: 2 });
      await fs.remove(path.join(this.metaDir(), 'staging')).catch(() => undefined);
      await fs.remove(path.join(this.metaDir(), 'imports')).catch(() => undefined);
      this.staged = [];
      await this.saveStaging();
      return await this.rescan();
    } catch (error) {
      for (const createdPath of created) await fs.remove(createdPath).catch(() => undefined);
      for (const item of backups.reverse()) {
        if (await fs.pathExists(item.backup)) { await fs.ensureDir(path.dirname(item.original)); await fs.move(item.backup, item.original, { overwrite: true }).catch(() => undefined); }
      }
      throw error;
    }
  }

  private async pushStagedJar(sourcePath: string, size: number, hash: string, mod: NonNullable<ManagedFile['mod']>, current: ManagedFile | undefined, profiles?: ClientProfileId[], status?: ImportStatus, packageName?: string, forcedTarget?: string): Promise<StagedChange> {
    const id = randomUUID();
    const stageDir = path.join(this.metaDir(), 'staging', 'files');
    await fs.ensureDir(stageDir);
    const stagedPath = path.join(stageDir, `${id}-${safeFileName(path.basename(sourcePath))}`);
    await fs.copyFile(sourcePath, stagedPath);
    const targetPath = forcedTarget ?? `mods/${safeFileName(path.basename(sourcePath))}`;
    const change: StagedChange = { id, kind: current ? 'replace' : 'add', targetPath, sourcePath, stagedPath, previousPath: current?.path, size, hash, mod, previousMod: current?.mod, suggestedProfiles: profiles, importStatus: status, packageName };
    this.staged.push(change);
    return change;
  }

  private metaDir(): string { this.assertRoot(); return path.join(this.root!, '.bestiary'); }
  private stageStatePath(): string { return path.join(this.metaDir(), 'staging.json'); }
  private async loadStaging(): Promise<void> {
    try { const state = await fs.readJson(this.stageStatePath()) as StageDiskState; this.staged = Array.isArray(state.changes) ? state.changes.filter((change) => !change.stagedPath || fs.existsSync(change.stagedPath)) : []; }
    catch { this.staged = []; }
  }
  private async saveStaging(): Promise<void> { await fs.ensureDir(this.metaDir()); await fs.writeJson(this.stageStatePath(), { changes: this.staged } satisfies StageDiskState, { spaces: 2 }); }
  private assertRoot(): void { if (!this.root) throw new Error('Chưa chọn thư mục client.'); }
}

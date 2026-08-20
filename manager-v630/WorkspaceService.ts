import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import type {
  ClientProfileId,
  DistributionProfileId,
  ImportStatus,
  ManagedFile,
  ModAuditSummary,
  ModPolicy,
  ModSideDetection,
  PackageImportItem,
  PackageImportResult,
  ProgressState,
  StagedChange,
  WorkspaceSnapshot,
} from '../../shared/types';
import { parseFabricMod, resolveInside, safeFileName, scanManagedFiles, sha256File } from './utils';
import { defaultProfiles, detectModSide, effectiveSide } from './ModAuditService';

interface StageDiskState { changes: StagedChange[]; }
interface DetectionCacheRecord { hash: string; detection: ModSideDetection; }
interface PolicyDiskState {
  schema: 1;
  policies: Record<string, ModPolicy>;
  detections: Record<string, DetectionCacheRecord>;
}

const MAX_PACKAGE_JAR_BYTES = 512 * 1024 * 1024;
const ALL_PROFILES = new Set<DistributionProfileId>(['full', 'lite', 'android', 'server']);

function hashBuffer(buffer: Buffer): string { return createHash('sha256').update(buffer).digest('hex'); }
function profileFromArchive(filePath: string): ClientProfileId {
  const name = path.basename(filePath, path.extname(filePath)).toLowerCase().replace(/[ _]+/g, '-');
  if (name.includes('android')) return 'android';
  if (name.includes('pc-lite') || /(^|-)lite($|-)/u.test(name)) return 'lite';
  if (/(^|-)full($|-)/u.test(name)) return 'full';
  throw new Error(`${path.basename(filePath)}: tên ZIP phải chứa mods-full, mods-pc-lite hoặc mods-android để Manager biết profile.`);
}
function unionProfiles(a: DistributionProfileId[] | undefined, b: DistributionProfileId[]): DistributionProfileId[] {
  return [...new Set([...(a ?? []), ...b])].filter((profile): profile is DistributionProfileId => ALL_PROFILES.has(profile));
}
function suffixTarget(fileName: string, profile: ClientProfileId): string {
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, -ext.length);
  return `mods/${safeFileName(`${stem}-${profile}${ext}`)}`;
}
function policyKey(file: Pick<ManagedFile, 'path' | 'mod'> | Pick<StagedChange, 'targetPath' | 'mod'>): string {
  const mod = 'mod' in file ? file.mod : undefined;
  const relative = 'path' in file ? file.path : file.targetPath;
  return mod?.id ? `mod:${mod.id.toLowerCase()}` : `path:${relative.toLowerCase()}`;
}
function normalizePolicy(value: Partial<ModPolicy> | undefined, detection?: ModSideDetection): ModPolicy {
  const sideOverride = value?.sideOverride === 'client' || value?.sideOverride === 'server' || value?.sideOverride === 'both' ? value.sideOverride : 'auto';
  const side = effectiveSide(detection, sideOverride);
  const requested = Array.isArray(value?.profiles) ? value!.profiles!.filter((profile): profile is DistributionProfileId => ALL_PROFILES.has(profile)) : [];
  return {
    enabled: value?.enabled !== false,
    sideOverride,
    profiles: requested.length ? [...new Set(requested)] : defaultProfiles(side),
    androidCompatibility: value?.androidCompatibility === 'compatible' || value?.androidCompatibility === 'blocked' ? value.androidCompatibility : 'auto',
    reviewed: value?.reviewed === true,
  };
}
function summarize(files: ManagedFile[]): ModAuditSummary {
  const mods = files.filter((file) => file.area === 'mods' && file.path.toLowerCase().endsWith('.jar'));
  const result: ModAuditSummary = { total: mods.length, client: 0, server: 0, both: 0, unknown: 0, disabled: 0, android: 0, warnings: 0 };
  for (const file of mods) {
    const side = effectiveSide(file.sideDetection, file.policy?.sideOverride ?? 'auto');
    result[side] += 1;
    if (file.policy?.enabled === false) result.disabled += 1;
    if (file.policy?.profiles.includes('android')) result.android += 1;
    if (side === 'unknown' || !file.policy?.reviewed || (file.policy?.profiles.includes('android') && file.policy.androidCompatibility === 'blocked')) result.warnings += 1;
  }
  return result;
}

export class WorkspaceService {
  private root: string | null = null;
  private files: ManagedFile[] = [];
  private staged: StagedChange[] = [];
  private scanning = false;
  private progress?: ProgressState;
  private policies: Record<string, ModPolicy> = {};
  private detections: Record<string, DetectionCacheRecord> = {};
  private readonly onProgress?: (progress: ProgressState) => void;

  constructor(onProgress?: (progress: ProgressState) => void) { this.onProgress = onProgress; }
  getRoot(): string | null { return this.root; }
  snapshot(): WorkspaceSnapshot { return { root: this.root, files: this.files, staged: this.staged, scanning: this.scanning, scanProgress: this.progress, audit: summarize(this.files) }; }

  async open(root: string): Promise<WorkspaceSnapshot> {
    const normalized = path.resolve(root);
    await fs.ensureDir(normalized);
    for (const area of ['mods', 'config', 'resourcepacks']) await fs.ensureDir(path.join(normalized, area));
    this.root = normalized;
    await fs.ensureDir(this.metaDir());
    await this.loadPolicyState();
    await this.loadStaging();
    return this.rescan();
  }

  async rescan(): Promise<WorkspaceSnapshot> {
    this.assertRoot();
    this.scanning = true;
    this.progress = { phase: 'scan', completed: 0, total: 0, message: 'Đang quét workspace...' };
    this.onProgress?.(this.progress);
    try {
      const raw = await scanManagedFiles(this.root!, (progress) => { this.progress = progress; this.onProgress?.(progress); });
      this.files = [];
      const modFiles = raw.filter((file) => file.area === 'mods' && file.path.toLowerCase().endsWith('.jar'));
      let audited = 0;
      for (const file of raw) {
        if (file.area !== 'mods' || !file.path.toLowerCase().endsWith('.jar')) { this.files.push(file); continue; }
        audited += 1;
        const key = policyKey(file);
        const cached = this.detections[key];
        let detection = cached?.hash === file.hash ? cached.detection : undefined;
        if (!detection) {
          try { detection = await detectModSide(resolveInside(this.root!, file.path)); }
          catch (error) {
            detection = { side: 'unknown', confidence: 'low', source: 'unknown', reasons: [error instanceof Error ? error.message : String(error)], analyzedAt: Date.now() };
          }
          this.detections[key] = { hash: file.hash, detection };
        }
        const policy = normalizePolicy(this.policies[key], detection);
        this.policies[key] = policy;
        this.files.push({ ...file, sideDetection: detection, policy });
        this.onProgress?.({ phase: 'mod-audit', current: file.mod?.name ?? file.path, completed: audited, total: modFiles.length, message: `Đang phân loại ${file.mod?.name ?? path.basename(file.path)}` });
      }
      await this.savePolicyState();
      return this.snapshot();
    } finally { this.scanning = false; this.progress = undefined; }
  }

  async setModPolicy(relativePath: string, patch: Partial<ModPolicy>): Promise<WorkspaceSnapshot> {
    this.assertRoot();
    const file = this.files.find((item) => item.path === relativePath && item.area === 'mods');
    if (!file) throw new Error('Không tìm thấy mod trong workspace.');
    const key = policyKey(file);
    const current = normalizePolicy(this.policies[key], file.sideDetection);
    const next = normalizePolicy({ ...current, ...patch, profiles: patch.profiles ?? current.profiles }, file.sideDetection);
    this.policies[key] = next;
    file.policy = next;
    await this.savePolicyState();
    return this.snapshot();
  }

  async redetectMod(relativePath?: string): Promise<WorkspaceSnapshot> {
    this.assertRoot();
    if (relativePath) {
      const file = this.files.find((item) => item.path === relativePath && item.area === 'mods');
      if (!file) throw new Error('Không tìm thấy mod cần soi lại.');
      delete this.detections[policyKey(file)];
    } else {
      this.detections = {};
    }
    await this.savePolicyState();
    return this.rescan();
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
      const detection = await detectModSide(sourcePath).catch((error): ModSideDetection => ({ side: 'unknown', confidence: 'low', source: 'unknown', reasons: [error instanceof Error ? error.message : String(error)], analyzedAt: Date.now() }));
      const key = `mod:${mod.id.toLowerCase()}`;
      const policy = normalizePolicy(this.policies[key], detection);
      const current = this.files.find((file) => file.area === 'mods' && file.mod?.id === mod.id);
      const existingStage = this.staged.find((change) => change.mod?.id === mod.id && change.kind !== 'remove');
      if (existingStage?.stagedPath) await fs.remove(existingStage.stagedPath).catch(() => undefined);
      if (existingStage) this.staged = this.staged.filter((change) => change.id !== existingStage.id);
      await this.pushStagedJar(sourcePath, stat.size, hash, mod, current, policy.profiles, undefined, undefined, path.basename(sourcePath), undefined, detection, policy);
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
        const detection = await detectModSide(extracted).catch((error): ModSideDetection => ({ side: 'unknown', confidence: 'low', source: 'unknown', reasons: [error instanceof Error ? error.message : String(error)], analyzedAt: Date.now() }));
        const key = `mod:${mod.id.toLowerCase()}`;
        const basePolicy = normalizePolicy(this.policies[key], detection);
        const policy = { ...basePolicy, profiles: unionProfiles(basePolicy.profiles, [profile]) };
        const current = this.files.find((file) => file.area === 'mods' && file.mod?.id === mod.id);
        const status: ImportStatus = !current ? 'new' : current.hash === hash ? 'up_to_date' : current.mod?.version !== mod.version ? 'update' : 'changed';

        if (status === 'up_to_date' && current) {
          const currentKey = policyKey(current);
          this.policies[currentKey] = { ...normalizePolicy(this.policies[currentKey], current.sideDetection), profiles: unionProfiles(this.policies[currentKey]?.profiles, [profile]) };
          current.policy = this.policies[currentKey];
          items.push({ packageName, profile, fileName, targetPath: current.path, mod, status, currentVersion: current.mod?.version, importedVersion: mod.version, size: buffer.length });
          await fs.remove(cacheDir);
        } else {
          const sameHashStage = this.staged.find((change) => change.kind !== 'remove' && change.mod?.id === mod.id && change.hash === hash);
          let targetPath: string;
          if (sameHashStage) {
            sameHashStage.suggestedProfiles = unionProfiles(sameHashStage.suggestedProfiles, [profile]);
            sameHashStage.policy = { ...normalizePolicy(sameHashStage.policy, sameHashStage.sideDetection), profiles: unionProfiles(sameHashStage.policy?.profiles, [profile]) };
            sameHashStage.packageName = sameHashStage.packageName ? `${sameHashStage.packageName}, ${packageName}` : packageName;
            targetPath = sameHashStage.targetPath;
            await fs.remove(cacheDir);
          } else {
            const preferred = `mods/${fileName}`;
            const collision = this.staged.some((change) => change.kind !== 'remove' && change.targetPath === preferred && change.hash !== hash)
              || (current && current.path === preferred && this.staged.some((change) => change.mod?.id === mod.id && change.hash !== hash));
            targetPath = collision ? suffixTarget(fileName, profile) : preferred;
            await this.pushStagedJar(extracted, buffer.length, hash, mod, current, policy.profiles, status, packageName, targetPath, detection, policy);
            await fs.remove(cacheDir).catch(() => undefined);
          }
          items.push({ packageName, profile, fileName, targetPath, mod, status, currentVersion: current?.mod?.version, importedVersion: mod.version, size: buffer.length });
        }
        this.onProgress?.({ phase: 'package-import', current: `${packageName}/${fileName}`, completed: entryIndex, total: jarEntries.length, message: `${profile.toUpperCase()} · ${mod.name} · ${status}` });
      }
      packageIndex += 1;
      this.onProgress?.({ phase: 'package', current: packageName, completed: packageIndex, total: archives.length, message: `Đã đọc ${packageName}` });
    }
    await this.savePolicyState();
    await this.saveStaging();
    return { snapshot: this.snapshot(), items, warnings };
  }

  async stageRemove(relativePath: string): Promise<WorkspaceSnapshot> {
    this.assertRoot();
    const current = this.files.find((file) => file.path === relativePath);
    if (!current) throw new Error('File không còn tồn tại trong workspace.');
    this.staged = this.staged.filter((change) => change.previousPath !== relativePath && change.targetPath !== relativePath);
    this.staged.push({ id: randomUUID(), kind: 'remove', targetPath: relativePath, previousPath: relativePath, size: current.size, previousMod: current.mod, sideDetection: current.sideDetection, policy: current.policy });
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
          if (change.mod) {
            const key = `mod:${change.mod.id.toLowerCase()}`;
            if (change.sideDetection && change.hash) this.detections[key] = { hash: change.hash, detection: change.sideDetection };
            this.policies[key] = normalizePolicy(change.policy ?? { profiles: change.suggestedProfiles }, change.sideDetection);
          }
        }
        completed += 1;
        this.onProgress?.({ phase: 'apply', current: change.targetPath, completed, total: this.staged.length, message: `Đang áp dụng ${change.targetPath}` });
      }
      await fs.writeJson(path.join(transactionRoot, 'changes.json'), { appliedAt: Date.now(), changes: this.staged }, { spaces: 2 });
      await this.savePolicyState();
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

  private async pushStagedJar(
    sourcePath: string,
    size: number,
    hash: string,
    mod: NonNullable<ManagedFile['mod']>,
    current: ManagedFile | undefined,
    profiles?: DistributionProfileId[],
    status?: ImportStatus,
    packageName?: string,
    forcedTarget?: string,
    detection?: ModSideDetection,
    policy?: ModPolicy,
  ): Promise<StagedChange> {
    const id = randomUUID();
    const stageDir = path.join(this.metaDir(), 'staging', 'files');
    await fs.ensureDir(stageDir);
    const stagedPath = path.join(stageDir, `${id}-${safeFileName(path.basename(sourcePath))}`);
    await fs.copyFile(sourcePath, stagedPath);
    const targetPath = forcedTarget ?? `mods/${safeFileName(path.basename(sourcePath))}`;
    const change: StagedChange = {
      id,
      kind: current ? 'replace' : 'add',
      targetPath,
      sourcePath,
      stagedPath,
      previousPath: current?.path,
      size,
      hash,
      mod,
      previousMod: current?.mod,
      suggestedProfiles: profiles,
      importStatus: status,
      packageName,
      sideDetection: detection,
      policy: policy ?? normalizePolicy({ profiles }, detection),
    };
    this.staged.push(change);
    return change;
  }

  private metaDir(): string { this.assertRoot(); return path.join(this.root!, '.bestiary'); }
  private stageStatePath(): string { return path.join(this.metaDir(), 'staging.json'); }
  private policyStatePath(): string { return path.join(this.metaDir(), 'mod-policies.json'); }

  private async loadPolicyState(): Promise<void> {
    try {
      const state = await fs.readJson(this.policyStatePath()) as Partial<PolicyDiskState>;
      this.policies = state.schema === 1 && state.policies && typeof state.policies === 'object' ? state.policies : {};
      this.detections = state.schema === 1 && state.detections && typeof state.detections === 'object' ? state.detections : {};
    } catch { this.policies = {}; this.detections = {}; }
  }
  private async savePolicyState(): Promise<void> {
    await fs.ensureDir(this.metaDir());
    await fs.writeJson(this.policyStatePath(), { schema: 1, policies: this.policies, detections: this.detections } satisfies PolicyDiskState, { spaces: 2 });
  }
  private async loadStaging(): Promise<void> {
    try { const state = await fs.readJson(this.stageStatePath()) as StageDiskState; this.staged = Array.isArray(state.changes) ? state.changes.filter((change) => !change.stagedPath || fs.existsSync(change.stagedPath)) : []; }
    catch { this.staged = []; }
  }
  private async saveStaging(): Promise<void> { await fs.ensureDir(this.metaDir()); await fs.writeJson(this.stageStatePath(), { changes: this.staged } satisfies StageDiskState, { spaces: 2 }); }
  private assertRoot(): void { if (!this.root) throw new Error('Chưa chọn thư mục workspace.'); }
}

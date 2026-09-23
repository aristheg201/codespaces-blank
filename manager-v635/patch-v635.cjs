const fs = require('node:fs');
const req = (ok, msg) => { if (!ok) throw new Error(msg); };

// BESTIARY_MANAGER_REMOTE_SYNC_V635
{
  const p = 'manager/src/main/services/WorkspaceService.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

  const interfaceMarker = 'const MAX_PACKAGE_JAR_BYTES = 512 * 1024 * 1024;';
  req(s.includes(interfaceMarker), 'Workspace policy interface marker missing');
  if (!s.includes('interface PublishedManagerPolicyEntry')) {
    s = s.replace(interfaceMarker, [
      "interface PublishedManagerPolicyEntry {",
      "  path: string;",
      "  hash?: string;",
      "  enabled?: boolean;",
      "  profiles?: DistributionProfileId[];",
      "  side?: 'client' | 'server' | 'both' | 'unknown';",
      "  androidCompatibility?: 'auto' | 'compatible' | 'blocked';",
      "}",
      "",
      interfaceMarker,
    ].join('\n'));
  }

  const methodMarker = '  async setModPolicy(relativePath: string, patch: Partial<ModPolicy>): Promise<WorkspaceSnapshot> {';
  req(s.includes(methodMarker), 'Workspace setModPolicy marker missing');
  if (!s.includes('async mergePublishedState(')) {
    const method = [
      "  async mergePublishedState(entries: PublishedManagerPolicyEntry[]): Promise<WorkspaceSnapshot> {",
      "    this.assertRoot();",
      "    if (!Array.isArray(entries) || entries.length === 0) return this.snapshot();",
      "    const byPath = new Map(entries.filter((entry) => entry && typeof entry.path === 'string').map((entry) => [entry.path.toLowerCase(), entry]));",
      "    const byHash = new Map(entries.filter((entry) => entry && typeof entry.hash === 'string' && entry.hash).map((entry) => [String(entry.hash).toLowerCase(), entry]));",
      "    let changed = false;",
      "    for (const file of this.files) {",
      "      if (file.area !== 'mods' || !file.path.toLowerCase().endsWith('.jar')) continue;",
      "      const remote = byPath.get(file.path.toLowerCase()) ?? byHash.get(file.hash.toLowerCase());",
      "      if (!remote) continue;",
      "      const key = policyKey(file);",
      "      const current = normalizePolicy(this.policies[key], file.sideDetection);",
      "      if (current.reviewed) continue;",
      "      const profiles = Array.isArray(remote.profiles) ? remote.profiles.filter((profile): profile is DistributionProfileId => ALL_PROFILES.has(profile)) : [];",
      "      const sideOverride = remote.side === 'client' || remote.side === 'server' || remote.side === 'both' ? remote.side : current.sideOverride;",
      "      const androidCompatibility = remote.androidCompatibility === 'compatible' || remote.androidCompatibility === 'blocked' ? remote.androidCompatibility : 'auto';",
      "      const next = normalizePolicy({",
      "        ...current,",
      "        enabled: remote.enabled !== false,",
      "        profiles: profiles.length > 0 ? profiles : current.profiles,",
      "        sideOverride,",
      "        androidCompatibility,",
      "        reviewed: true,",
      "      }, file.sideDetection);",
      "      this.policies[key] = next;",
      "      file.policy = next;",
      "      changed = true;",
      "    }",
      "    if (changed) await this.savePolicyState();",
      "    return this.snapshot();",
      "  }",
      "",
    ].join('\n');
    s = s.replace(methodMarker, method + methodMarker);
  }

  req(s.includes('async mergePublishedState('), 'published policy merge method missing');
  fs.writeFileSync(p, s);
}

{
  const p = 'manager/src/main/services/GithubDistributionService.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

  const filesMarker = "      files: publishFiles.map((file) => ({";
  req(s.includes(filesMarker), 'manifest files marker missing');
  if (!s.includes('managerPolicy: files.filter')) {
    s = s.replace(filesMarker, [
      "      managerPolicy: files.filter((file) => /^mods\\/.+\\.jar$/iu.test(file.path)).map((file) => ({",
      "        path: file.path,",
      "        hash: file.hash,",
      "        enabled: enabledByPath[file.path] !== false,",
      "        profiles: normalizeProfiles(profilesByPath[file.path]),",
      "        side: sideByPath[file.path] ?? 'unknown',",
      "        androidCompatibility: androidCompatibilityByPath[file.path] ?? 'auto',",
      "      })),",
      filesMarker,
    ].join('\n'));
  }

  const helperMarker = '  private async objectReleaseId(repository: string): Promise<number> {';
  req(s.includes(helperMarker), 'remote helper insertion marker missing');
  if (!s.includes('async listRemoteReleases()')) {
    const helpers = [
      "  private async repositoryDefaultBranch(repository: string): Promise<string> {",
      "    const result = await this.runGh(['api', 'repos/' + repository, '--jq', '.default_branch'], { allowFailure: true, timeoutMs: 30_000 });",
      "    const branch = result.code === 0 ? result.stdout.trim() : '';",
      "    return branch || 'main';",
      "  }",
      "",
      "  private async readRepositoryJson<T>(repository: string, filePath: string): Promise<T | null> {",
      "    const result = await this.runGh(['api', 'repos/' + repository + '/contents/' + filePath, '--jq', '.content'], { allowFailure: true, timeoutMs: 30_000 });",
      "    if (result.code !== 0 || !result.stdout.trim()) return null;",
      "    try {",
      "      const raw = Buffer.from(result.stdout.replace(/\\s+/gu, ''), 'base64').toString('utf8');",
      "      return JSON.parse(raw) as T;",
      "    } catch { return null; }",
      "  }",
      "",
      "  private async writeRepositoryJson(repository: string, filePath: string, value: unknown, message: string): Promise<void> {",
      "    const branch = await this.repositoryDefaultBranch(repository);",
      "    const endpoint = 'repos/' + repository + '/contents/' + filePath;",
      "    const existing = await this.runGh(['api', endpoint, '--jq', '.sha'], { allowFailure: true, timeoutMs: 30_000 });",
      "    const content = Buffer.from(JSON.stringify(value, null, 2) + '\\n', 'utf8').toString('base64');",
      "    const args = ['api', '--method', 'PUT', endpoint, '-f', 'message=' + message, '-f', 'content=' + content, '-f', 'branch=' + branch];",
      "    if (existing.code === 0 && existing.stdout.trim()) args.push('-f', 'sha=' + existing.stdout.trim());",
      "    const result = await this.runGh(args, { allowFailure: true, timeoutMs: 60_000 });",
      "    if (result.code !== 0) throw new Error(('Không ghi được remote state ' + filePath + '. ' + (result.stderr || result.stdout)).trim());",
      "  }",
      "",
      "  async listRemoteReleases(): Promise<ReleaseRecord[]> {",
      "    const local = await this.listLocalReleases();",
      "    const repository = this.settings.repository.trim();",
      "    if (!repository) return local;",
      "    const listing = await this.runGh(['api', 'repos/' + repository + '/contents/bestiary-distribution/releases', '--jq', '.[] | select(.type == \"dir\") | .name'], { allowFailure: true, timeoutMs: 30_000 });",
      "    if (listing.code !== 0) return local;",
      "    const names = [...new Set(listing.stdout.split(/\\r?\\n/u).map((value) => value.trim()).filter(Boolean))];",
      "    if (names.length === 0) return local;",
      "    const stable = await this.readRepositoryJson<{ version?: string }>(repository, 'bestiary-distribution/channels/stable.json');",
      "    const testing = await this.readRepositoryJson<{ version?: string }>(repository, 'bestiary-distribution/channels/testing.json');",
      "    const defaultBranch = await this.repositoryDefaultBranch(repository);",
      "    const remote: ReleaseRecord[] = [];",
      "    for (const version of names) {",
      "      const meta = await this.readRepositoryJson<{ version?: string; title?: string; changelog?: string; createdAt?: number; fileCount?: number; totalBytes?: number }>(repository, 'bestiary-distribution/releases/' + version + '/release.json');",
      "      if (!meta) continue;",
      "      remote.push({",
      "        version: meta.version || version,",
      "        title: meta.title || version,",
      "        changelog: meta.changelog || '',",
      "        createdAt: Number(meta.createdAt || 0),",
      "        manifestUrl: 'https://raw.githubusercontent.com/' + repository + '/' + defaultBranch + '/bestiary-distribution/releases/' + version + '/manifest.json',",
      "        fileCount: Number(meta.fileCount || 0),",
      "        totalBytes: Number(meta.totalBytes || 0),",
      "        channel: testing?.version === version ? 'testing' : 'stable',",
      "      });",
      "    }",
      "    remote.sort((a, b) => b.createdAt - a.createdAt);",
      "    return remote.length > 0 ? remote : local;",
      "  }",
      "",
      "  async remotePublishedState(): Promise<{ version: string; files: Array<{ path: string; hash?: string; enabled?: boolean; profiles?: Array<'full' | 'lite' | 'android' | 'server'>; side?: 'client' | 'server' | 'both' | 'unknown'; androidCompatibility?: 'auto' | 'compatible' | 'blocked' }> } | null> {",
      "    const repository = this.settings.repository.trim();",
      "    if (!repository) return null;",
      "    const stable = await this.readRepositoryJson<{ version?: string }>(repository, 'bestiary-distribution/channels/stable.json');",
      "    const testing = stable?.version ? null : await this.readRepositoryJson<{ version?: string }>(repository, 'bestiary-distribution/channels/testing.json');",
      "    const version = stable?.version || testing?.version;",
      "    if (!version) return null;",
      "    const manifest = await this.readRepositoryJson<{ managerPolicy?: unknown[]; files?: unknown[] }>(repository, 'bestiary-distribution/releases/' + version + '/manifest.json');",
      "    if (!manifest) return null;",
      "    const source = Array.isArray(manifest.managerPolicy) && manifest.managerPolicy.length > 0 ? manifest.managerPolicy : (Array.isArray(manifest.files) ? manifest.files : []);",
      "    const files = source.filter((entry): entry is { path: string; hash?: string; enabled?: boolean; profiles?: Array<'full' | 'lite' | 'android' | 'server'>; side?: 'client' | 'server' | 'both' | 'unknown'; androidCompatibility?: 'auto' | 'compatible' | 'blocked' } => Boolean(entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string' && /^mods\\/.+\\.jar$/iu.test(String((entry as { path: string }).path))));",
      "    return { version, files };",
      "  }",
      "",
      "  async promoteRemoteStable(version: string): Promise<void> {",
      "    const repository = this.settings.repository.trim();",
      "    if (!repository) throw new Error('Chưa cấu hình distribution repository.');",
      "    const meta = await this.readRepositoryJson<{ version?: string }>(repository, 'bestiary-distribution/releases/' + version + '/release.json');",
      "    const manifest = await this.readRepositoryJson<unknown>(repository, 'bestiary-distribution/releases/' + version + '/manifest.json');",
      "    if (!meta || !manifest) throw new Error('Không tìm thấy release ' + version + ' trên GitHub.');",
      "    const defaultBranch = await this.repositoryDefaultBranch(repository);",
      "    await this.writeRepositoryJson(repository, 'bestiary-distribution/channels/stable.json', {",
      "      version,",
      "      manifestUrl: 'https://raw.githubusercontent.com/' + repository + '/' + defaultBranch + '/bestiary-distribution/releases/' + version + '/manifest.json',",
      "      timestamp: Date.now(),",
      "    }, 'Promote Bestiary ' + version + ' to stable');",
      "  }",
      "",
    ].join('\n');
    s = s.replace(helperMarker, helpers + helperMarker);
  }

  req(s.includes('managerPolicy: files.filter'), 'manager policy publish block missing');
  req(s.includes('async listRemoteReleases()'), 'remote release catalog missing');
  req(s.includes('async remotePublishedState()'), 'remote published state missing');
  req(s.includes('async promoteRemoteStable('), 'remote stable promotion missing');
  fs.writeFileSync(p, s);
}

{
  const p = 'manager/src/main/index.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

  const bindMarker = 'function bindIpc(): void {';
  req(s.includes(bindMarker), 'main bindIpc marker missing');
  if (!s.includes('async function syncWorkspaceFromRemote()')) {
    s = s.replace(bindMarker, [
      "async function syncWorkspaceFromRemote(): Promise<void> {",
      "  if (!workspaceService?.getRoot()) return;",
      "  try {",
      "    const remote = await distributionService.remotePublishedState();",
      "    if (remote?.files?.length) await workspaceService.mergePublishedState(remote.files);",
      "  } catch {",
      "    // Remote sync is best-effort; local workspace remains usable offline.",
      "  }",
      "}",
      "",
      bindMarker,
    ].join('\n'));
  }

  const chooseMarker = "    await workspaceService.open(result.filePaths[0]);\n    return result.filePaths[0];";
  req(s.includes(chooseMarker), 'workspace choose sync marker missing');
  s = s.replace(chooseMarker, "    await workspaceService.open(result.filePaths[0]);\n    await syncWorkspaceFromRemote();\n    return result.filePaths[0];");

  const openMarker = "    return workspaceService.open(root);";
  req(s.includes(openMarker), 'workspace open sync marker missing');
  s = s.replace(openMarker, "    await workspaceService.open(root);\n    await syncWorkspaceFromRemote();\n    return workspaceService.snapshot();");

  const connectMarker = "  ipcMain.handle('distribution:connect', () => distributionService.connectGithub());";
  req(s.includes(connectMarker), 'distribution connect marker missing');
  s = s.replace(connectMarker, "  ipcMain.handle('distribution:connect', async () => { const status = await distributionService.connectGithub(); await syncWorkspaceFromRemote(); return status; });");

  const listMarker = "  ipcMain.handle('release:list', () => distributionService.listLocalReleases());";
  req(s.includes(listMarker), 'release list marker missing');
  s = s.replace(listMarker, "  ipcMain.handle('release:list', () => distributionService.listRemoteReleases());");

  const promoteMarker = "  ipcMain.handle('release:promote', (_event, version: string) => distributionService.promoteStable(version));";
  req(s.includes(promoteMarker), 'release promote marker missing');
  s = s.replace(promoteMarker, "  ipcMain.handle('release:promote', (_event, version: string) => distributionService.promoteRemoteStable(version));");

  const startupMarker = "      await workspaceService.open(settings.workspaceRoot);";
  req(s.includes(startupMarker), 'startup workspace marker missing');
  s = s.replace(startupMarker, startupMarker + "\n      await syncWorkspaceFromRemote();");

  req(s.includes('distributionService.listRemoteReleases()'), 'remote release IPC missing');
  req(s.includes('distributionService.promoteRemoteStable(version)'), 'remote promote IPC missing');
  req(s.includes('await syncWorkspaceFromRemote();'), 'workspace remote sync hook missing');
  fs.writeFileSync(p, s);
}

{
  const p = 'manager/src/renderer/src/store.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

  const connectOld = "  connectGithub: async () => { await guarded(set, async () => set({ distribution: await window.bestiary.connectGithub(), progress: null })); },";
  req(s.includes(connectOld), 'renderer connectGithub marker missing');
  s = s.replace(connectOld, "  connectGithub: async () => { await guarded(set, async () => { const distribution = await window.bestiary.connectGithub(); const [releases, snapshot] = await Promise.all([window.bestiary.listReleases(), window.bestiary.getSnapshot()]); set({ distribution, releases, snapshot, progress: null }); }); },");

  const ensureOld = "  ensureRepository: async (preferred) => { await guarded(set, async () => { const distribution = await window.bestiary.ensureDistributionRepository(preferred); const settings = await window.bestiary.getSettings(); set({ distribution, settings }); }); },";
  req(s.includes(ensureOld), 'renderer ensureRepository marker missing');
  s = s.replace(ensureOld, "  ensureRepository: async (preferred) => { await guarded(set, async () => { const distribution = await window.bestiary.ensureDistributionRepository(preferred); const [settings, releases, snapshot] = await Promise.all([window.bestiary.getSettings(), window.bestiary.listReleases(), window.bestiary.getSnapshot()]); set({ distribution, settings, releases, snapshot }); }); },");

  req(s.includes('const [releases, snapshot] = await Promise.all'), 'GitHub connect remote refresh missing');
  fs.writeFileSync(p, s);
}

{
  const p = 'manager/src/renderer/src/App.tsx';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  s = s.replaceAll('Release Console 6.3.4', 'Release Console 6.3.5');
  s = s.replaceAll("currentVersion:'6.3.4'", "currentVersion:'6.3.5'");
  fs.writeFileSync(p, s);
}

console.log('Manager 6.3.5 remote release and published-policy sync applied.');

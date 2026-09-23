const fs = require('node:fs');
const req = (ok, msg) => { if (!ok) throw new Error(msg); };
const DEFAULT_REPOSITORY = 'aristheg201/bestiary-distribution';
const DEFAULT_MICROSOFT_CLIENT_ID = 'e4e89832-4229-46c3-90b1-a808ea750ec1';

// Manager 6.3.6: fresh-machine bootstrap + actual stable workspace sync.
{
  const p = 'manager/src/main/services/SettingsService.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  req(s.includes("  repository: '',"), 'Settings repository default marker missing');
  s = s.replace("  repository: '',", "  repository: '" + DEFAULT_REPOSITORY + "',");
  req(s.includes("  microsoftClientId: '',"), 'Settings Microsoft client default marker missing');
  s = s.replace("  microsoftClientId: '',", "  microsoftClientId: '" + DEFAULT_MICROSOFT_CLIENT_ID + "',");
  fs.writeFileSync(p, s);
}

{
  const p = 'manager/src/shared/types.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  if (!s.includes('export interface WorkspaceSyncResult')) {
    const marker = 'export interface PublishResult { release:ReleaseRecord; uploadedObjects:number; reusedObjects:number; }';
    req(s.includes(marker), 'PublishResult marker missing');
    s = s.replace(marker, marker + "\nexport interface WorkspaceSyncResult { version:string; downloaded:number; reused:number; total:number; }\n");
  }
  const apiMarker = '  promoteStable(version:string): Promise<void>;';
  req(s.includes(apiMarker), 'ManagerApi promote marker missing');
  if (!s.includes('syncStableWorkspace(): Promise<WorkspaceSyncResult>;')) {
    s = s.replace(apiMarker, apiMarker + "\n  syncStableWorkspace(): Promise<WorkspaceSyncResult>;");
  }
  fs.writeFileSync(p, s);
}

{
  const p = 'manager/src/preload/index.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const marker = "  promoteStable: (version: string) => ipcRenderer.invoke('release:promote', version),";
  req(s.includes(marker), 'preload promote marker missing');
  if (!s.includes("workspace:sync-stable")) {
    s = s.replace(marker, marker + "\n  syncStableWorkspace: () => ipcRenderer.invoke('workspace:sync-stable'),");
  }
  fs.writeFileSync(p, s);
}

{
  const p = 'manager/src/main/services/GithubDistributionService.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

  const importBlock = [
    "import { net as bestiarySyncNet } from 'electron';",
    "import { promises as bestiarySyncFs } from 'node:fs';",
    "import bestiarySyncPath from 'node:path';",
    "import { createHash as bestiarySyncCreateHash } from 'node:crypto';",
  ];
  for (const line of importBlock.reverse()) {
    if (!s.includes(line)) s = line + '\n' + s;
  }

  const helperMarker = '  private async repositoryDefaultBranch(repository: string): Promise<string> {';
  req(s.includes(helperMarker), 'remote helper marker missing');
  if (!s.includes('async pullStableToWorkspace()')) {
    const helpers = [
      "  private effectiveRepository(): string {",
      "    return this.settings.repository.trim() || '" + DEFAULT_REPOSITORY + "';",
      "  }",
      "",
      "  private async fetchPublicJson<T>(url: string): Promise<T> {",
      "    const response = await bestiarySyncNet.fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Bestiary-Pack-Manager/6.3.6', 'Accept': 'application/json', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } });",
      "    if (!response.ok) throw new Error('HTTP ' + response.status + ' khi đồng bộ ' + url);",
      "    return await response.json() as T;",
      "  }",
      "",
      "  async fetchRemoteRuntimeConfig(): Promise<Partial<DistributionSettings> | null> {",
      "    const repository = this.effectiveRepository();",
      "    const url = 'https://raw.githubusercontent.com/' + repository + '/main/bestiary-distribution/config.json?ts=' + Date.now();",
      "    try {",
      "      const config = await this.fetchPublicJson<Partial<DistributionSettings>>(url);",
      "      return { ...config, repository, microsoftClientId: String(config.microsoftClientId || '" + DEFAULT_MICROSOFT_CLIENT_ID + "') };",
      "    } catch {",
      "      return { repository, microsoftClientId: '" + DEFAULT_MICROSOFT_CLIENT_ID + "' };",
      "    }",
      "  }",
      "",
      "  async pullStableToWorkspace(workspaceRoot?: string): Promise<{ version: string; downloaded: number; reused: number; total: number }> {",
      "    const root = workspaceRoot ? bestiarySyncPath.resolve(workspaceRoot) : null;",
      "    if (!root) throw new Error('Hãy chọn workspace trước khi đồng bộ.');",
      "    const repository = this.effectiveRepository();",
      "    const channelUrl = 'https://raw.githubusercontent.com/' + repository + '/main/bestiary-distribution/channels/stable.json?ts=' + Date.now();",
      "    const channel = await this.fetchPublicJson<{ version?: string; manifestUrl?: string }>(channelUrl);",
      "    const version = String(channel.version || '').trim();",
      "    if (!version) throw new Error('Stable channel không có version hợp lệ.');",
      "    const manifestUrl = channel.manifestUrl || ('https://raw.githubusercontent.com/' + repository + '/main/bestiary-distribution/releases/' + version + '/manifest.json');",
      "    const manifest = await this.fetchPublicJson<{ files?: Array<{ path?: string; hash?: string; size?: number; downloadUrl?: string }> }>(manifestUrl + (manifestUrl.includes('?') ? '&' : '?') + 'ts=' + Date.now());",
      "    const files = (manifest.files || []).filter((item): item is { path: string; hash: string; size: number; downloadUrl: string } => Boolean(item && typeof item.path === 'string' && /^[0-9a-f]{64}$/iu.test(String(item.hash || '')) && Number.isFinite(Number(item.size)) && Number(item.size) >= 0 && typeof item.downloadUrl === 'string' && /^https:\\/\\//iu.test(item.downloadUrl)));",
      "    if (files.length === 0) throw new Error('Manifest stable không có file hợp lệ để đồng bộ.');",
      "    let downloaded = 0;",
      "    let reused = 0;",
      "    let completed = 0;",
      "    for (const item of files) {",
      "      const rel = bestiarySyncPath.posix.normalize(item.path.replace(/\\\\/gu, '/'));",
      "      if (!rel || rel === '.' || rel.startsWith('../') || bestiarySyncPath.posix.isAbsolute(rel)) throw new Error('Manifest chứa path không an toàn: ' + item.path);",
      "      const target = bestiarySyncPath.resolve(root, ...rel.split('/'));",
      "      const relativeCheck = bestiarySyncPath.relative(root, target);",
      "      if (!relativeCheck || relativeCheck.startsWith('..') || bestiarySyncPath.isAbsolute(relativeCheck)) {",
      "        if (target !== root) throw new Error('Manifest thoát khỏi workspace: ' + item.path);",
      "      }",
      "      let matches = false;",
      "      try {",
      "        const stat = await bestiarySyncFs.stat(target);",
      "        if (stat.isFile() && stat.size === Number(item.size)) {",
      "          const local = await bestiarySyncFs.readFile(target);",
      "          const localHash = bestiarySyncCreateHash('sha256').update(local).digest('hex');",
      "          matches = localHash.toLowerCase() === item.hash.toLowerCase();",
      "        }",
      "      } catch { matches = false; }",
      "      if (matches) {",
      "        reused += 1;",
      "        completed += 1;",
      "        this.onProgress?.({ phase: 'sync-stable', current: rel, completed, total: files.length, message: 'Giữ file đã đúng: ' + rel });",
      "        continue;",
      "      }",
      "      this.onProgress?.({ phase: 'sync-stable', current: rel, completed, total: files.length, message: 'Đang tải: ' + rel });",
      "      const response = await bestiarySyncNet.fetch(item.downloadUrl, { redirect: 'follow', headers: { 'User-Agent': 'Bestiary-Pack-Manager/6.3.6', 'Accept': 'application/octet-stream', 'Cache-Control': 'no-cache' } });",
      "      if (!response.ok) throw new Error('HTTP ' + response.status + ' khi tải ' + rel);",
      "      const buffer = Buffer.from(await response.arrayBuffer());",
      "      if (buffer.length !== Number(item.size)) throw new Error('Sai dung lượng khi tải ' + rel + ': ' + buffer.length + ' != ' + item.size);",
      "      const hash = bestiarySyncCreateHash('sha256').update(buffer).digest('hex');",
      "      if (hash.toLowerCase() !== item.hash.toLowerCase()) throw new Error('SHA256 không khớp khi tải ' + rel);",
      "      await bestiarySyncFs.mkdir(bestiarySyncPath.dirname(target), { recursive: true });",
      "      const temp = target + '.bestiary-sync-' + process.pid + '.tmp';",
      "      await bestiarySyncFs.writeFile(temp, buffer);",
      "      await bestiarySyncFs.rm(target, { force: true }).catch(() => undefined);",
      "      await bestiarySyncFs.rename(temp, target);",
      "      downloaded += 1;",
      "      completed += 1;",
      "      this.onProgress?.({ phase: 'sync-stable', current: rel, completed, total: files.length, message: 'Đã đồng bộ: ' + rel });",
      "    }",
      "    this.onProgress?.({ phase: 'sync-stable-complete', completed: files.length, total: files.length, message: 'Đã đồng bộ stable ' + version + ': ' + downloaded + ' tải mới, ' + reused + ' giữ nguyên.' });",
      "    return { version, downloaded, reused, total: files.length };",
      "  }",
      "",
    ].join('\n');
    s = s.replace(helperMarker, helpers + helperMarker);
  }

  // 6.3.5 used gh api for this path, which still required local auth/repository state.
  const remoteStart = s.indexOf('  async remotePublishedState(): Promise<');
  const remoteEnd = s.indexOf('\n  async promoteRemoteStable(', remoteStart);
  req(remoteStart >= 0 && remoteEnd > remoteStart, 'remotePublishedState block missing');
  const remoteReplacement = [
    "  async remotePublishedState(): Promise<{ version: string; files: Array<{ path: string; hash?: string; enabled?: boolean; profiles?: Array<'full' | 'lite' | 'android' | 'server'>; side?: 'client' | 'server' | 'both' | 'unknown'; androidCompatibility?: 'auto' | 'compatible' | 'blocked' }> } | null> {",
    "    const repository = this.effectiveRepository();",
    "    try {",
    "      const stable = await this.fetchPublicJson<{ version?: string }>('https://raw.githubusercontent.com/' + repository + '/main/bestiary-distribution/channels/stable.json?ts=' + Date.now());",
    "      const version = String(stable.version || '').trim();",
    "      if (!version) return null;",
    "      const manifest = await this.fetchPublicJson<{ managerPolicy?: unknown[]; files?: unknown[] }>('https://raw.githubusercontent.com/' + repository + '/main/bestiary-distribution/releases/' + version + '/manifest.json?ts=' + Date.now());",
    "      const source = Array.isArray(manifest.managerPolicy) && manifest.managerPolicy.length > 0 ? manifest.managerPolicy : (Array.isArray(manifest.files) ? manifest.files : []);",
    "      const files = source.filter((entry): entry is { path: string; hash?: string; enabled?: boolean; profiles?: Array<'full' | 'lite' | 'android' | 'server'>; side?: 'client' | 'server' | 'both' | 'unknown'; androidCompatibility?: 'auto' | 'compatible' | 'blocked' } => Boolean(entry && typeof entry === 'object' && typeof (entry as { path?: unknown }).path === 'string' && /^mods\\/.+\\.jar$/iu.test(String((entry as { path: string }).path))));",
    "      return { version, files };",
    "    } catch { return null; }",
    "  }",
  ].join('\n');
  s = s.slice(0, remoteStart) + remoteReplacement + s.slice(remoteEnd);

  req(s.includes('async pullStableToWorkspace('), 'actual stable workspace sync missing');
  req(s.includes('bestiarySyncNet.fetch(item.downloadUrl'), 'object download transport missing');
  req(s.includes("bestiarySyncCreateHash('sha256')"), 'sync SHA256 verification missing');
  req(s.includes('async fetchRemoteRuntimeConfig()'), 'remote config bootstrap missing');
  fs.writeFileSync(p, s);
}

{
  const p = 'manager/src/main/index.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

  const syncFnMarker = 'async function syncWorkspaceFromRemote(): Promise<void> {';
  req(s.includes(syncFnMarker), 'metadata sync helper missing');
  if (!s.includes('async function pullStableIfEmpty()')) {
    const bindMarker = 'function bindIpc(): void {';
    req(s.includes(bindMarker), 'bindIpc marker missing');
    const helper = [
      "async function pullStableIfEmpty(): Promise<void> {",
      "  const snapshot = workspaceService.snapshot();",
      "  if (!snapshot.root || snapshot.files.length > 0) return;",
      "  await distributionService.pullStableToWorkspace(workspaceService.getRoot() || undefined);",
      "  await workspaceService.rescan();",
      "  await syncWorkspaceFromRemote();",
      "}",
      "",
    ].join('\n');
    s = s.replace(bindMarker, helper + bindMarker);
  }

  const chooseSync = "    await workspaceService.open(result.filePaths[0]);\n    await syncWorkspaceFromRemote();\n    return result.filePaths[0];";
  req(s.includes(chooseSync), 'workspace choose remote sync marker missing');
  s = s.replace(chooseSync, "    await workspaceService.open(result.filePaths[0]);\n    await pullStableIfEmpty();\n    await syncWorkspaceFromRemote();\n    return result.filePaths[0];");

  const openSync = "    await workspaceService.open(root);\n    await syncWorkspaceFromRemote();\n    return workspaceService.snapshot();";
  req(s.includes(openSync), 'workspace open remote sync marker missing');
  s = s.replace(openSync, "    await workspaceService.open(root);\n    await pullStableIfEmpty();\n    await syncWorkspaceFromRemote();\n    return workspaceService.snapshot();");

  const promoteIpc = "  ipcMain.handle('release:promote', (_event, version: string) => distributionService.promoteRemoteStable(version));";
  req(s.includes(promoteIpc), 'remote promote IPC marker missing');
  if (!s.includes("ipcMain.handle('workspace:sync-stable'")) {
    s = s.replace(promoteIpc, promoteIpc + "\n  ipcMain.handle('workspace:sync-stable', async () => { const result = await distributionService.pullStableToWorkspace(workspaceService.getRoot() || undefined); await workspaceService.rescan(); await syncWorkspaceFromRemote(); return result; });");
  }

  const initMarker = "  distributionService = new GithubDistributionService(app.getPath('userData'), settings.distribution, sendProgress);";
  req(s.includes(initMarker), 'distribution service init marker missing');
  if (!s.includes('fetchRemoteRuntimeConfig')) {
    s = s.replace(initMarker, initMarker + [
      "",
      "  try {",
      "    const remote = await distributionService.fetchRemoteRuntimeConfig();",
      "    const current = settingsService.get().distribution;",
      "    const next = await settingsService.setDistribution({",
      "      ...current,",
      "      repository: current.repository.trim() || remote?.repository || '" + DEFAULT_REPOSITORY + "',",
      "      microsoftClientId: current.microsoftClientId.trim() || String(remote?.microsoftClientId || '" + DEFAULT_MICROSOFT_CLIENT_ID + "'),",
      "    });",
      "    distributionService.setSettings(next.distribution);",
      "  } catch {",
      "    // Local settings remain usable when GitHub is offline.",
      "  }",
    ].join('\n'));
  }

  const startupSync = "      await workspaceService.open(settings.workspaceRoot);\n      await syncWorkspaceFromRemote();";
  req(s.includes(startupSync), 'startup workspace sync marker missing');
  s = s.replace(startupSync, "      await workspaceService.open(settings.workspaceRoot);\n      await pullStableIfEmpty();\n      await syncWorkspaceFromRemote();");

  req(s.includes("workspace:sync-stable"), 'manual stable sync IPC missing');
  req(s.includes('await pullStableIfEmpty();'), 'empty workspace auto pull missing');
  fs.writeFileSync(p, s);
}

{
  const p = 'manager/src/renderer/src/store.ts';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const interfaceMarker = '  promote(version: string): Promise<void>;';
  req(s.includes(interfaceMarker), 'store promote interface marker missing');
  if (!s.includes('syncStable(): Promise<void>;')) {
    s = s.replace(interfaceMarker, interfaceMarker + "\n  syncStable(): Promise<void>;");
  }
  const implMarker = "  promote: async (version) => { await guarded(set, async () => { await window.bestiary.promoteStable(version); set({ releases: await window.bestiary.listReleases() }); }); },";
  req(s.includes(implMarker), 'store promote implementation marker missing');
  if (!s.includes('syncStable: async () =>')) {
    s = s.replace(implMarker, implMarker + "\n  syncStable: async () => { await guarded(set, async () => { await window.bestiary.syncStableWorkspace(); const [snapshot, releases] = await Promise.all([window.bestiary.getSnapshot(), window.bestiary.listReleases()]); set({ snapshot, releases }); }); },");
  }
  fs.writeFileSync(p, s);
}

{
  const p = 'manager/src/renderer/src/App.tsx';
  let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  s = s.replaceAll('Release Console 6.3.5', 'Release Console 6.3.6');
  s = s.replaceAll("currentVersion:'6.3.5'", "currentVersion:'6.3.6'");

  const settingsHead = "function Settings(){const {settings,saveDistribution,connectGithub,ensureRepository,distribution,busy}=useManager();";
  req(s.includes(settingsHead), 'Settings hook marker missing');
  s = s.replace(settingsHead, "function Settings(){const {settings,saveDistribution,connectGithub,ensureRepository,syncStable,snapshot,distribution,busy}=useManager();");

  const repoButtons = '<div className="mt-4 flex gap-2"><button onClick={()=>void connectGithub()} disabled={busy} className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-[9px] font-black">{distribution?.authenticated?\'ĐÃ ĐĂNG NHẬP\':\'ĐĂNG NHẬP GITHUB\'}</button><button onClick={()=>void ensureRepository(form.repository)} disabled={busy} className="rounded-xl bg-white px-4 py-3 text-[9px] font-black text-black">KIỂM TRA / TẠO REPO</button></div>';
  req(s.includes(repoButtons), 'Settings repository button row marker missing');
  const syncButton = repoButtons + '<button onClick={()=>void syncStable()} disabled={busy||!snapshot.root} className="mt-3 w-full rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-[9px] font-black text-emerald-300">ĐỒNG BỘ STABLE → WORKSPACE</button><div className="mt-2 text-[9px] leading-4 text-zinc-600">Máy mới: chọn workspace trống rồi Manager tự kéo stable từ GitHub, kiểm SHA256 từng file và khôi phục mod/config/resourcepack.</div>';
  s = s.replace(repoButtons, syncButton);

  req(s.includes('ĐỒNG BỘ STABLE → WORKSPACE'), 'stable sync UI button missing');
  fs.writeFileSync(p, s);
}

console.log('Manager 6.3.6 real cross-machine sync patch applied.');

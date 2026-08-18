import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import fsNative from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import axios from 'axios';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import pLimit from 'p-limit';

const { Client } = require('minecraft-launcher-core') as { Client: new () => any };

const PRODUCT = 'Bestiary Launcher';
const DEFAULT_MC = '1.21.1';
const DEFAULT_FABRIC = '0.18.4';
const USER_AGENT = 'BestiaryLauncher/5.0.0';
const MANAGED_DIRS = ['mods', 'config', 'resourcepacks'] as const;
const HASH_RE = /^[a-f0-9]{64}$/i;
const USER_RE = /^[A-Za-z0-9_]{3,16}$/;
const MAX_MANIFEST_FILES = 100000;
const DOWNLOAD_CONCURRENCY = 5;
const HASH_CONCURRENCY = 3;
const DOWNLOAD_RETRIES = 3;
const HTTP_TIMEOUT = 30000;

type PerformancePreset = 'low' | 'balanced' | 'performance' | 'custom';
type RuntimeMode = 'managed' | 'system' | 'custom';

type Settings = {
  username: string;
  minRamMb: number;
  maxRamMb: number;
  width: number;
  height: number;
  fullscreen: boolean;
  preset: PerformancePreset;
  runtimeMode: RuntimeMode;
  customJavaPath: string;
  extraJvmArgs: string[];
};

type DefaultConfig = {
  brand: string;
  configUrl: string;
  fallbackChannelUrl: string;
  fallbackAnnouncementsUrl: string;
  minecraftVersion: string;
  fabricLoader: string;
};

type RemoteConfig = {
  brand?: string;
  channelUrl?: string;
  manifestUrl?: string;
  announcementsUrl?: string;
  discordUrl?: string;
  serverHost?: string;
  serverPort?: number;
  defaultMinecraftVersion?: string;
  defaultFabricLoader?: string;
};

type Channel = { version?: string; manifest?: string; manifestUrl?: string };
type Announcement = { title?: string; body?: string; text?: string; date?: string; createdAt?: string };

type ManifestEntry = {
  path: string;
  hash: string;
  size: number;
  url: string;
};

type Manifest = {
  version: string;
  minecraftVersion: string;
  fabricLoader: string;
  files: ManifestEntry[];
};

type ProgressPayload = {
  phase: string;
  percent: number;
  currentFile?: string;
  speedMBps?: number;
  etaSeconds?: number | null;
  completedBytes?: number;
  totalBytes?: number;
  completedFiles?: number;
  totalFiles?: number;
  message?: string;
};

let mainWindow: BrowserWindow | null = null;
let gameProcess: any = null;
let activeStart: Promise<unknown> | null = null;

const http = axios.create({
  timeout: HTTP_TIMEOUT,
  maxRedirects: 8,
  headers: { 'User-Agent': USER_AGENT }
});

function localRoot(): string {
  const base = process.env.LOCALAPPDATA || app.getPath('userData');
  return path.join(base, 'BestiaryLauncher');
}

function gameRoot(): string { return path.join(localRoot(), 'game'); }
function settingsPath(): string { return path.join(localRoot(), 'settings.json'); }
function statePath(): string { return path.join(localRoot(), 'pack-state.json'); }
function jreRoot(): string { return path.join(localRoot(), 'jre'); }

function emit(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function defaultSettings(): Settings {
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
  const max = Math.max(4096, Math.min(8192, Math.floor(totalMb * 0.6)));
  return {
    username: '', minRamMb: 1024, maxRamMb: max,
    width: 1280, height: 720, fullscreen: false,
    preset: 'balanced', runtimeMode: 'managed', customJavaPath: '', extraJvmArgs: []
  };
}

async function loadSettings(): Promise<Settings> {
  const base = defaultSettings();
  try {
    const raw = await fs.readJson(settingsPath());
    return sanitizeSettings({ ...base, ...raw });
  } catch { return base; }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function sanitizeSettings(raw: any): Settings {
  const base = defaultSettings();
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
  const maxRam = clampInt(raw.maxRamMb, 1024, Math.max(1024, totalMb), base.maxRamMb);
  const minRam = Math.min(maxRam, clampInt(raw.minRamMb, 512, maxRam, base.minRamMb));
  const username = typeof raw.username === 'string' ? raw.username.trim().slice(0, 16) : '';
  const preset: PerformancePreset = ['low','balanced','performance','custom'].includes(raw.preset) ? raw.preset : 'balanced';
  const runtimeMode: RuntimeMode = ['managed','system','custom'].includes(raw.runtimeMode) ? raw.runtimeMode : 'managed';
  const extraJvmArgs = Array.isArray(raw.extraJvmArgs)
    ? raw.extraJvmArgs.filter((x: unknown) => typeof x === 'string' && x.length <= 2048).slice(0, 64)
    : [];
  return {
    username, minRamMb: minRam, maxRamMb: maxRam,
    width: clampInt(raw.width, 854, 7680, 1280),
    height: clampInt(raw.height, 480, 4320, 720),
    fullscreen: Boolean(raw.fullscreen), preset, runtimeMode,
    customJavaPath: typeof raw.customJavaPath === 'string' ? raw.customJavaPath.trim() : '',
    extraJvmArgs
  };
}

async function saveSettings(input: unknown): Promise<Settings> {
  const settings = sanitizeSettings(input);
  await fs.ensureDir(localRoot());
  const temp = `${settingsPath()}.${process.pid}.tmp`;
  await fs.writeJson(temp, settings, { spaces: 2 });
  await fs.move(temp, settingsPath(), { overwrite: true });
  return settings;
}

function resourcePath(relative: string): string {
  return app.isPackaged ? path.join(process.resourcesPath, relative) : path.join(__dirname, '..', '..', 'resources', relative);
}

async function loadDefaultConfig(): Promise<DefaultConfig> {
  return fs.readJson(resourcePath('default-config.json'));
}

function asHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 8192) return undefined;
  try {
    const u = new URL(value);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1','localhost','::1'].includes(u.hostname))) return u.toString();
  } catch { /* ignored */ }
  return undefined;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await http.get(url, { responseType: 'json', validateStatus: s => s >= 200 && s < 300 });
  return response.data as T;
}

async function resolveRemote(): Promise<{ defaults: DefaultConfig; config: RemoteConfig; channel: Channel | null; announcements: Announcement[]; manifestUrl: string | null }> {
  const defaults = await loadDefaultConfig();
  let config: RemoteConfig = {};
  try { config = await getJson<RemoteConfig>(defaults.configUrl); } catch { config = {}; }
  const channelUrl = asHttpsUrl(config.channelUrl) || defaults.fallbackChannelUrl;
  let channel: Channel | null = null;
  try { channel = await getJson<Channel>(channelUrl); } catch { channel = null; }
  const manifestUrl = asHttpsUrl(config.manifestUrl) || asHttpsUrl(channel?.manifestUrl) || asHttpsUrl(channel?.manifest) || null;
  const announcementUrl = asHttpsUrl(config.announcementsUrl) || defaults.fallbackAnnouncementsUrl;
  let announcements: Announcement[] = [];
  try {
    const raw: any = await getJson<any>(announcementUrl);
    announcements = Array.isArray(raw) ? raw : Array.isArray(raw?.announcements) ? raw.announcements : [];
    announcements = announcements.slice(0, 20);
  } catch { announcements = []; }
  return { defaults, config, channel, announcements, manifestUrl };
}

function normalizeManagedPath(input: unknown): string {
  if (typeof input !== 'string' || input.length < 3 || input.length > 1024 || input.includes('\0')) throw new Error('Manifest chứa đường dẫn không hợp lệ.');
  const slash = input.replaceAll('\\', '/').replace(/^\/+/, '');
  const parts = slash.split('/');
  if (slash !== input.replaceAll('\\','/') || !MANAGED_DIRS.includes(parts[0] as any) || parts.some(p => !p || p === '.' || p === '..')) throw new Error(`Đường dẫn ngoài vùng quản lý: ${input}`);
  const absolute = path.resolve(gameRoot(), ...parts);
  const rel = path.relative(gameRoot(), absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Đường dẫn không an toàn: ${input}`);
  return slash;
}

function normalizeManifest(raw: any, remote: Awaited<ReturnType<typeof resolveRemote>>): Manifest {
  if (!raw || typeof raw !== 'object') throw new Error('Manifest không hợp lệ.');
  const version = String(raw.packVersion || raw.version || remote.channel?.version || '').trim();
  if (!version) throw new Error('Manifest thiếu version.');
  const mc = String(raw.minecraft?.version || raw.minecraftVersion || remote.config.defaultMinecraftVersion || remote.defaults.minecraftVersion || DEFAULT_MC);
  const fabric = String(raw.minecraft?.fabricLoader || raw.fabricLoader || remote.config.defaultFabricLoader || remote.defaults.fabricLoader || DEFAULT_FABRIC);
  if (!Array.isArray(raw.files) || raw.files.length > MAX_MANIFEST_FILES) throw new Error('Manifest files không hợp lệ.');
  const seen = new Set<string>();
  const files: ManifestEntry[] = raw.files.map((entry: any) => {
    const p = normalizeManagedPath(entry.path);
    if (seen.has(p)) throw new Error(`Manifest trùng file: ${p}`);
    seen.add(p);
    const hash = String(entry.hash || entry.sha256 || '').toLowerCase();
    const size = Number(entry.size);
    const url = asHttpsUrl(entry.downloadUrl || entry.url);
    if (!HASH_RE.test(hash) || !Number.isSafeInteger(size) || size < 0 || !url) throw new Error(`Manifest entry lỗi: ${p}`);
    return { path: p, hash, size, url };
  });
  return { version, minecraftVersion: mc, fabricLoader: fabric, files };
}

async function fetchManifest(remote: Awaited<ReturnType<typeof resolveRemote>>): Promise<Manifest> {
  if (!remote.manifestUrl) throw new Error('Kênh phát hành chưa có manifest.');
  const raw = await getJson<any>(remote.manifestUrl);
  return normalizeManifest(raw, remote);
}

async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  const stream = fsNative.createReadStream(file, { highWaterMark: 1024 * 1024 });
  for await (const chunk of stream) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function scanManaged(): Promise<Map<string, { path: string; size: number; hash: string }>> {
  const candidates: Array<{ rel: string; abs: string; size: number }> = [];
  for (const top of MANAGED_DIRS) {
    const root = path.join(gameRoot(), top);
    await fs.ensureDir(root);
    const queue = [root];
    while (queue.length) {
      const current = queue.pop()!;
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        const abs = path.join(current, entry.name);
        if (entry.isSymbolicLink()) { await fs.remove(abs); continue; }
        if (entry.isDirectory()) { queue.push(abs); continue; }
        if (!entry.isFile()) continue;
        const stat = await fs.stat(abs);
        candidates.push({ rel: path.relative(gameRoot(), abs).split(path.sep).join('/'), abs, size: stat.size });
      }
    }
  }
  const out = new Map<string, { path: string; size: number; hash: string }>();
  const limit = pLimit(HASH_CONCURRENCY);
  await Promise.all(candidates.map(c => limit(async () => out.set(c.rel, { path: c.abs, size: c.size, hash: await hashFile(c.abs) }))));
  return out;
}

async function downloadOne(entry: ManifestEntry, destination: string, onBytes: (n: number) => void): Promise<void> {
  let last: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_RETRIES; attempt++) {
    const temp = `${destination}.${randomUUID()}.part`;
    let counted = 0;
    try {
      await fs.ensureDir(path.dirname(destination));
      const response = await http.get(entry.url, { responseType: 'stream', timeout: 60000, validateStatus: s => s >= 200 && s < 300 });
      const digest = createHash('sha256');
      let received = 0;
      const meter = new Transform({ transform(chunk: Buffer, _enc, cb) {
        received += chunk.length; counted += chunk.length; onBytes(chunk.length);
        if (received > entry.size) return cb(new Error(`File lớn hơn manifest: ${entry.path}`));
        digest.update(chunk); cb(null, chunk);
      }});
      await pipeline(response.data, meter, fsNative.createWriteStream(temp, { flags: 'wx' }));
      if (received !== entry.size) throw new Error(`Sai dung lượng: ${entry.path}`);
      if (digest.digest('hex') !== entry.hash) throw new Error(`Sai SHA-256: ${entry.path}`);
      await fs.move(temp, destination, { overwrite: true });
      return;
    } catch (error) {
      last = error; await fs.remove(temp).catch(() => undefined); onBytes(-counted);
      if (attempt < DOWNLOAD_RETRIES) await new Promise(r => setTimeout(r, 500 * 2 ** (attempt - 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

async function syncClient(manifest: Manifest): Promise<{ changed: number; removed: number }> {
  if (manifest.files.length === 0) throw new Error('Bản phát hành hiện tại chưa chứa file client. Hãy publish client từ Pack Manager trước.');
  emit('sync:progress', { phase: 'scanning', percent: 0, message: 'Đang kiểm tra client…' } satisfies ProgressPayload);
  const local = await scanManaged();
  const desired = new Map(manifest.files.map(f => [f.path, f]));
  const orphans = [...local.keys()].filter(p => !desired.has(p));
  const queue = manifest.files.filter(f => {
    const l = local.get(f.path); return !l || l.size !== f.size || l.hash !== f.hash;
  });
  const session = path.join(localRoot(), '.sync', randomUUID());
  const staged = path.join(session, 'staged');
  const backup = path.join(session, 'backup');
  await fs.ensureDir(staged); await fs.ensureDir(backup);
  const totalBytes = queue.reduce((s, f) => s + f.size, 0);
  let completedBytes = 0; let completedFiles = 0; const started = Date.now();
  const publishProgress = (file?: string) => {
    const elapsed = Math.max(0.2, (Date.now() - started) / 1000);
    const speed = completedBytes / elapsed;
    const eta = speed > 1 ? Math.max(0, (totalBytes - completedBytes) / speed) : null;
    emit('sync:progress', { phase: 'downloading', percent: totalBytes ? Math.min(100, completedBytes / totalBytes * 100) : 100,
      currentFile: file, speedMBps: speed / 1024 / 1024, etaSeconds: eta, completedBytes, totalBytes, completedFiles, totalFiles: queue.length } satisfies ProgressPayload);
  };
  try {
    const limit = pLimit(DOWNLOAD_CONCURRENCY);
    await Promise.all(queue.map(entry => limit(async () => {
      const dest = path.join(staged, ...entry.path.split('/'));
      await downloadOne(entry, dest, n => { completedBytes = Math.max(0, completedBytes + n); publishProgress(entry.path); });
      completedFiles++; publishProgress(entry.path);
    })));
    for (const rel of [...orphans, ...queue.map(q => q.path)]) {
      const target = path.join(gameRoot(), ...rel.split('/'));
      if (await fs.pathExists(target)) {
        const b = path.join(backup, ...rel.split('/')); await fs.ensureDir(path.dirname(b)); await fs.move(target, b, { overwrite: true });
      }
    }
    for (const entry of queue) {
      const src = path.join(staged, ...entry.path.split('/')); const dest = path.join(gameRoot(), ...entry.path.split('/'));
      await fs.ensureDir(path.dirname(dest)); await fs.move(src, dest, { overwrite: true });
    }
    for (const entry of manifest.files) {
      const abs = path.join(gameRoot(), ...entry.path.split('/')); const stat = await fs.stat(abs);
      if (!stat.isFile() || stat.size !== entry.size || await hashFile(abs) !== entry.hash) throw new Error(`Verify thất bại: ${entry.path}`);
    }
    await fs.writeJson(statePath(), { version: manifest.version, updatedAt: Date.now() }, { spaces: 2 });
    await fs.remove(session);
    emit('sync:progress', { phase: 'complete', percent: 100, completedBytes: totalBytes, totalBytes, completedFiles: queue.length, totalFiles: queue.length, message: 'Client đã sẵn sàng.' } satisfies ProgressPayload);
    return { changed: queue.length, removed: orphans.length };
  } catch (error) {
    for (const rel of [...orphans, ...queue.map(q => q.path)]) {
      const b = path.join(backup, ...rel.split('/')); const target = path.join(gameRoot(), ...rel.split('/'));
      if (await fs.pathExists(b)) { await fs.ensureDir(path.dirname(target)); await fs.remove(target).catch(() => undefined); await fs.move(b, target, { overwrite: true }); }
    }
    await fs.remove(session).catch(() => undefined); throw error;
  }
}

function javaMajorFor(mc: string): 8 | 17 | 21 {
  const parts = mc.split('.').map(v => Number.parseInt(v, 10)); const minor = parts[0] === 1 ? parts[1] || 0 : 99;
  if (minor <= 16) return 8; if (minor <= 19) return 17; return 21;
}

async function findJava(root: string): Promise<string | null> {
  if (!(await fs.pathExists(root))) return null;
  const queue = [root]; let seen = 0;
  while (queue.length && seen < 100000) {
    const dir = queue.shift()!; const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) { seen++; const abs = path.join(dir, e.name); if (e.isDirectory()) queue.push(abs); else if (e.isFile() && e.name.toLowerCase() === 'java.exe' && path.basename(path.dirname(abs)).toLowerCase() === 'bin') return abs; }
  }
  return null;
}

async function managedJava(major: 8 | 17 | 21): Promise<string> {
  const root = path.join(jreRoot(), String(major)); const existing = await findJava(root); if (existing) return existing;
  emit('jre:progress', { phase: 'downloading', percent: 0, message: `Đang cài Java ${major}…` });
  await fs.ensureDir(jreRoot()); const zipPath = path.join(jreRoot(), `.java-${major}-${randomUUID()}.zip`);
  const url = `https://api.adoptium.net/v3/binary/latest/${major}/ga/windows/x64/jre/hotspot/normal/eclipse`;
  try {
    const response = await http.get(url, { responseType: 'stream', timeout: 60000, maxRedirects: 10 });
    const total = Number(response.headers['content-length']) || 0; let done = 0;
    const meter = new Transform({ transform(chunk: Buffer, _e, cb) { done += chunk.length; emit('jre:progress', { phase:'downloading', percent: total ? Math.min(99, done / total * 100) : 0, message:`Đang tải Java ${major}…` }); cb(null, chunk); } });
    await pipeline(response.data, meter, fsNative.createWriteStream(zipPath, { flags: 'wx' }));
    const temp = `${root}.install-${randomUUID()}`; await fs.ensureDir(temp); new AdmZip(zipPath).extractAllTo(temp, true);
    const java = await findJava(temp); if (!java) throw new Error(`Không tìm thấy java.exe trong Java ${major}.`);
    const runtimeRoot = path.dirname(path.dirname(java)); await fs.remove(root); await fs.move(runtimeRoot, root, { overwrite: true });
    const installed = await findJava(root); if (!installed) throw new Error('Cài Java thất bại.');
    emit('jre:progress', { phase:'complete', percent:100, message:`Java ${major} đã sẵn sàng.` }); return installed;
  } finally { await fs.remove(zipPath).catch(() => undefined); }
}

async function resolveJava(settings: Settings, mc: string): Promise<string> {
  if (settings.runtimeMode === 'custom') {
    if (!settings.customJavaPath || !(await fs.pathExists(settings.customJavaPath))) throw new Error('Java custom không tồn tại.');
    return settings.customJavaPath;
  }
  if (settings.runtimeMode === 'system') return 'java';
  return managedJava(javaMajorFor(mc));
}

async function ensureFabricProfile(mc: string, loader: string): Promise<string> {
  const id = `fabric-loader-${loader}-${mc}`; const dir = path.join(gameRoot(), 'versions', id); const json = path.join(dir, `${id}.json`);
  if (await fs.pathExists(json)) return id;
  await fs.ensureDir(dir);
  const url = `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(loader)}/profile/json`;
  const profile = await getJson<any>(url); if (!profile || typeof profile !== 'object') throw new Error('Fabric profile không hợp lệ.');
  profile.id = id; await fs.writeJson(json, profile, { spaces: 2 }); return id;
}

function offlineUuid(username: string): string {
  const digest = createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest(); digest[6] = (digest[6] & 0x0f) | 0x30; digest[8] = (digest[8] & 0x3f) | 0x80; return digest.toString('hex');
}

function jvmArgs(settings: Settings): string[] {
  const base = ['-XX:+UseG1GC','-XX:+ParallelRefProcEnabled','-XX:+DisableExplicitGC','-XX:+PerfDisableSharedMem','-Dfile.encoding=UTF-8'];
  if (settings.preset === 'low') base.push('-XX:MaxGCPauseMillis=150');
  if (settings.preset === 'balanced') base.push('-XX:MaxGCPauseMillis=100');
  if (settings.preset === 'performance') base.push('-XX:MaxGCPauseMillis=75','-XX:+AlwaysPreTouch');
  return [...base, ...(settings.preset === 'custom' ? settings.extraJvmArgs : [])].filter(x => !/^-Xm[sx]/.test(x));
}

async function launchGame(manifest: Manifest, remote: Awaited<ReturnType<typeof resolveRemote>>, settings: Settings): Promise<void> {
  if (!USER_RE.test(settings.username)) throw new Error('Tên người chơi phải có 3-16 ký tự: chữ, số hoặc dấu gạch dưới.');
  if (gameProcess && gameProcess.exitCode == null) throw new Error('Minecraft đang chạy.');
  const javaPath = await resolveJava(settings, manifest.minecraftVersion);
  const fabricId = await ensureFabricProfile(manifest.minecraftVersion, manifest.fabricLoader);
  const uuid = offlineUuid(settings.username);
  const client = new Client();
  const forward = (channel: string) => (value: unknown) => emit(channel, typeof value === 'string' ? value : String(value ?? ''));
  client.on('data', forward('game:stdout')); client.on('debug', forward('game:debug')); client.on('download', forward('game:debug'));
  client.on('progress', (payload: unknown) => emit('game:progress', payload));
  const quickPlay = remote.config.serverHost ? { type: 'multiplayer', identifier: `${remote.config.serverHost}:${remote.config.serverPort || 25565}` } : undefined;
  emit('launcher:state', { state: 'launching' });
  const child = await client.launch({
    authorization: { access_token: '0', client_token: uuid, uuid, name: settings.username, user_properties: '{}', meta: { type: 'mojang', demo: false } },
    root: gameRoot(), cache: path.join(localRoot(), 'cache'), javaPath,
    version: { number: manifest.minecraftVersion, type: 'release', custom: fabricId },
    memory: { min: `${settings.minRamMb}M`, max: `${settings.maxRamMb}M` },
    window: { width: String(settings.width), height: String(settings.height), fullscreen: settings.fullscreen },
    customArgs: jvmArgs(settings), timeout: 120000, ...(quickPlay ? { quickPlay } : {})
  });
  gameProcess = child; emit('launcher:state', { state:'running', pid: child.pid || null });
  child.stderr?.on('data', (v: Buffer | string) => emit('game:stderr', String(v)));
  child.once('close', (code: number | null, signal: string | null) => { gameProcess = null; emit('launcher:state', { state:'stopped', code, signal }); });
  child.once('error', (error: Error) => emit('launcher:error', { message: error.message }));
}

async function localStatus(remote: Awaited<ReturnType<typeof resolveRemote>>): Promise<any> {
  let state: any = null; try { state = await fs.readJson(statePath()); } catch { state = null; }
  let mods = 0; try { mods = (await fs.readdir(path.join(gameRoot(),'mods'))).filter(x => x.toLowerCase().endsWith('.jar')).length; } catch { mods = 0; }
  return { installed: mods > 0, modCount: mods, localVersion: state?.version || null, remoteVersion: remote.channel?.version || null };
}

async function bootstrap(): Promise<any> {
  const remote = await resolveRemote(); const settings = await loadSettings(); const status = await localStatus(remote);
  return { settings, status, remote: { brand: remote.config.brand || remote.defaults.brand, discordUrl: remote.config.discordUrl || '', serverHost: remote.config.serverHost || '', announcements: remote.announcements, channelConnected: Boolean(remote.manifestUrl), minecraftVersion: remote.config.defaultMinecraftVersion || remote.defaults.minecraftVersion, fabricLoader: remote.config.defaultFabricLoader || remote.defaults.fabricLoader } };
}

async function startOrRepair(launchAfter: boolean): Promise<any> {
  if (activeStart) return activeStart;
  const task = (async () => {
    try {
      emit('launcher:state', { state:'syncing' }); const remote = await resolveRemote(); const manifest = await fetchManifest(remote); const result = await syncClient(manifest);
      if (launchAfter) { const settings = await loadSettings(); await launchGame(manifest, remote, settings); }
      return { ok:true, ...result, version:manifest.version };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error); emit('launcher:error', { message }); throw error;
    }
  })(); activeStart = task; try { return await task; } finally { if (activeStart === task) activeStart = null; }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180, height: 760, minWidth: 980, minHeight: 650, show: false,
    frame: false, backgroundColor: '#08090d', title: PRODUCT,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  void mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerIpc(): void {
  ipcMain.handle('app:bootstrap', () => bootstrap());
  ipcMain.handle('settings:save', (_e, value) => saveSettings(value));
  ipcMain.handle('launcher:start', () => startOrRepair(true));
  ipcMain.handle('launcher:repair', () => startOrRepair(false));
  ipcMain.handle('external:open', async (_e, url: unknown) => { const safe = asHttpsUrl(url); if (!safe) throw new Error('URL không hợp lệ.'); await shell.openExternal(safe); return true; });
  ipcMain.on('window:minimize', () => mainWindow?.minimize());
  ipcMain.on('window:maximize', () => { if (!mainWindow) return; mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); });
  ipcMain.on('window:close', () => mainWindow?.close());
}

app.setName(PRODUCT);
app.whenReady().then(async () => { await fs.ensureDir(localRoot()); await fs.ensureDir(gameRoot()); registerIpc(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

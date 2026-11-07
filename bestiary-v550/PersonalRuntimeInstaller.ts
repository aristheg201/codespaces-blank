import axios from 'axios';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'fs-extra';
import { spawn } from 'node:child_process';
import type { ModpackInfo } from '../../shared/ipc';
import { validateModpackSelection } from './LoaderCatalog';

const MOJANG_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MAX_DOWNLOAD = 400 * 1024 * 1024;
const INSTALL_TIMEOUT_MS = 12 * 60_000;
interface MojangItem { id: string; type: string; url: string }
interface MojangManifest { versions: MojangItem[] }
interface VersionMetadata { id: string; downloads: { client: { url: string; sha1: string; size?: number } } }
type Progress = (detail: string) => void;

async function downloadVerified(url: string, target: string, expectedSha1: string | null, maximum = MAX_DOWNLOAD): Promise<void> {
  if (!url.startsWith('https://')) throw new Error('Runtime download phải dùng HTTPS.');
  if (expectedSha1 && !/^[0-9a-f]{40}$/iu.test(expectedSha1)) throw new Error('Checksum metadata không hợp lệ.');
  if (await fs.pathExists(target) && expectedSha1) {
    const current = crypto.createHash('sha1').update(await fs.readFile(target)).digest('hex');
    if (current.toLowerCase() === expectedSha1.toLowerCase()) return;
  }
  await fs.ensureDir(path.dirname(target));
  const temp = target + '.' + process.pid + '.' + crypto.randomBytes(4).toString('hex') + '.part';
  try {
    const response = await axios.get<Buffer>(url, {
      timeout: 90_000, responseType: 'arraybuffer', maxContentLength: maximum,
      maxBodyLength: maximum,
    });
    const data = Buffer.from(response.data);
    if (!data.length || data.length > maximum) throw new Error('Runtime download không hợp lệ hoặc quá lớn.');
    if (expectedSha1) {
      const actual = crypto.createHash('sha1').update(data).digest('hex');
      if (actual.toLowerCase() !== expectedSha1.toLowerCase()) throw new Error('Runtime download SHA-1 không khớp.');
    }
    await fs.writeFile(temp, data);
    await fs.move(temp, target, { overwrite: true });
  } finally {
    await fs.remove(temp);
  }
}

async function seedVanillaClient(root: string, version: string, onProgress: Progress): Promise<void> {
  const manifest = (await axios.get<MojangManifest>(MOJANG_MANIFEST, {
    timeout: 30_000, maxContentLength: 5_000_000,
  })).data;
  const entry = manifest?.versions?.find((item) => item.id === version && item.type === 'release');
  if (!entry) throw new Error('Không tìm thấy Minecraft version trên Mojang.');
  if (!entry.url.startsWith('https://piston-meta.mojang.com/') &&
      !entry.url.startsWith('https://launchermeta.mojang.com/')) {
    throw new Error('Nguồn Minecraft version JSON không đáng tin cậy.');
  }
  const meta = (await axios.get<VersionMetadata>(entry.url, { timeout: 30_000, maxContentLength: 4_000_000 })).data;
  if (meta?.id !== version || !meta.downloads?.client?.url) throw new Error('Mojang version metadata thiếu client.');
  const versionDir = path.join(root, 'versions', version);
  const versionJson = path.join(versionDir, version + '.json');
  const clientJar = path.join(versionDir, version + '.jar');
  await fs.ensureDir(versionDir);
  // Official client JSON is kept with its original metadata so the launcher can resolve its dependencies.
  await fs.writeJson(versionJson, meta, { spaces: 2 });
  onProgress('Đang chuẩn bị Minecraft ' + version + ' client.jar...');
  if (!meta.downloads.client.url.startsWith('https://piston-data.mojang.com/') &&
      !meta.downloads.client.url.startsWith('https://launcher.mojang.com/')) {
    throw new Error('Nguồn tải Minecraft client JAR không đáng tin cậy.');
  }
  await downloadVerified(meta.downloads.client.url, clientJar, meta.downloads.client.sha1);
}

async function installForgeFamily(pack: ModpackInfo, root: string, javaPath: string, onProgress: Progress): Promise<string> {
  const version = pack.loaderVersion!;
  const neoforge = pack.loader === 'neoforge';
  const base = neoforge
    ? `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`
    : `https://maven.minecraftforge.net/net/minecraftforge/forge/${pack.minecraftVersion}-${version}/forge-${pack.minecraftVersion}-${version}-installer.jar`;
  const installRoot = path.join(root, '.bestiary-installers');
  const jar = path.join(installRoot, (neoforge ? 'neoforge-' : 'forge-') + version + '-installer.jar');
  const expectedProfile = neoforge ? 'neoforge-' + version : pack.minecraftVersion + '-forge-' + version;
  const versionJson = path.join(root, 'versions', expectedProfile, expectedProfile + '.json');
  if (await fs.pathExists(versionJson)) return expectedProfile;

  await seedVanillaClient(root, pack.minecraftVersion, onProgress);
  // NeoForge/Forge's official --installClient requires the Minecraft Launcher
  // profile file to exist, even when installing into a fresh private instance.
  // Only initialize an empty profile registry; never overwrite a player's
  // existing launcher_profiles.json or inject fabricated account credentials.
  const profilesPath = path.join(root, 'launcher_profiles.json');
  if (!(await fs.pathExists(profilesPath))) {
    await fs.writeJson(profilesPath, {
      profiles: {},
      settings: {},
      version: 3,
    }, { spaces: 2 });
  }
  await fs.ensureDir(installRoot);
  onProgress('Đang tải trình cài ' + (neoforge ? 'NeoForge ' : 'Forge ') + version + '...');
  const shaUrl = base + '.sha1';
  let sha: string | null = null;
  try {
    const response = await axios.get<string>(shaUrl, { timeout: 15_000, responseType: 'text', maxContentLength: 1024 });
    sha = response.data.trim().split(/\s+/u)[0] ?? null;
  } catch {
    throw new Error('Không kiểm tra được SHA-1 của NeoForge/Forge installer trên Maven chính thức.');
  }
  await downloadVerified(base, jar, sha, 200 * 1024 * 1024);

  onProgress('Đang cài ' + pack.loader + ' ' + version + ' vào instance riêng...');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(javaPath, ['-jar', jar, '--installClient', root], {
      cwd: root, windowsHide: true, shell: false,
      env: { ...process.env, APPDATA: root, HOME: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let recentOutput = '';
    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      recentOutput = (recentOutput + text).slice(-8_000);
      const last = text.split(/\r?\n/u).filter(Boolean).slice(-1)[0];
      if (last) onProgress(last.slice(0, 220));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('Installer ' + pack.loader + ' thất bại (exit ' + String(code) + '): ' + recentOutput.slice(-1000)));
    });
  });
  if (await fs.pathExists(versionJson)) return expectedProfile;

  // Some Forge builds use a different profile ID. Accept only profiles tied to the selected version.
  const versionsDir = path.join(root, 'versions');
  for (const candidate of await fs.readdir(versionsDir)) {
    if (!candidate.includes(version) || !(neoforge ? candidate.includes('neoforge') : candidate.includes('forge'))) continue;
    const candidateJson = path.join(versionsDir, candidate, candidate + '.json');
    if (await fs.pathExists(candidateJson)) {
      const json = await fs.readJson(candidateJson) as { id?: string; inheritsFrom?: string };
      if (json.id === candidate) return candidate;
    }
  }
  throw new Error('Installer hoàn tất nhưng không tạo Minecraft profile ' + expectedProfile + '.');
}

async function ensureLightweightProfile(root: string, pack: ModpackInfo): Promise<string> {
  const loader = pack.loader;
  const loaderVersion = pack.loaderVersion!;
  const id = (loader === 'fabric' ? 'fabric-loader-' : 'quilt-loader-') + loaderVersion + '-' + pack.minecraftVersion;
  const directory = path.join(root, 'versions', id);
  const jsonPath = path.join(directory, id + '.json');
  if (await fs.pathExists(jsonPath)) return id;
  const url = loader === 'fabric'
    ? `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(pack.minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`
    : `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(pack.minecraftVersion)}/${encodeURIComponent(loaderVersion)}/profile/json`;
  const result = (await axios.get<Record<string, unknown>>(url, { timeout: 30_000, maxContentLength: 4_000_000 })).data;
  if (!result || typeof result !== 'object' || !Array.isArray(result.libraries) || typeof result.mainClass !== 'string') {
    throw new Error('Loader profile JSON không hợp lệ.');
  }
  const actualId = typeof result.id === 'string' && /^[A-Za-z0-9._-]{1,100}$/u.test(result.id) ? result.id : id;
  const versionDir = path.join(root, 'versions', actualId);
  await fs.ensureDir(versionDir);
  await fs.writeJson(path.join(versionDir, actualId + '.json'), result, { spaces: 2 });
  return actualId;
}

export class PersonalRuntimeInstaller {
  public static async ensure(pack: ModpackInfo, root: string, javaPath: string, onProgress: Progress): Promise<string> {
    validateModpackSelection(pack);
    if (pack.loader === 'vanilla') return pack.minecraftVersion;
    if (pack.loader === 'fabric' || pack.loader === 'quilt') return ensureLightweightProfile(root, pack);
    if (pack.loader === 'neoforge' || pack.loader === 'forge') return installForgeFamily(pack, root, javaPath, onProgress);
    throw new Error('Loader chưa được hỗ trợ.');
  }
}

import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import https from 'node:https';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AppUpdateState } from '../../shared/ipc';

const CHANNEL_URL = 'https://raw.githubusercontent.com/aristheg201/bestiary-distribution/main/bestiary-distribution/app-updates.json';

type Product = 'launcher' | 'manager';
interface ProductUpdate { version: string; installerUrl: string; sha256: string; releaseNotes?: string; }
interface UpdateChannel { schema: number; products?: Partial<Record<Product, ProductUpdate>>; }

function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/iu, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/iu, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function getBuffer(url: string, redirects = 0, progress?: (current: number, total: number) => void): Promise<Buffer> {
  if (redirects > 6) return Promise.reject(new Error('Quá nhiều redirect khi tải bản cập nhật.'));
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') return Promise.reject(new Error('Updater chỉ chấp nhận HTTPS.'));
  return new Promise((resolve, reject) => {
    const request = https.get(parsed, { headers: { 'User-Agent': 'Bestiary-Updater/1.0', Accept: '*/*' } }, (response) => {
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, parsed).toString();
        void getBuffer(next, redirects + 1, progress).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`HTTP ${status} khi tải updater.`));
        return;
      }
      const total = Number(response.headers['content-length'] ?? 0) || 0;
      let current = 0;
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => { chunks.push(chunk); current += chunk.length; progress?.(current, total); });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.setTimeout(30_000, () => request.destroy(new Error('Updater timeout.')));
    request.on('error', reject);
  });
}

export class AppUpdater {
  private state: AppUpdateState;
  private readonly product: Product;
  private readonly root: string;
  private readonly emit: (state: AppUpdateState) => void;
  private installerPath: string | null = null;
  private running: Promise<AppUpdateState> | null = null;

  public constructor(product: Product, root: string, emit: (state: AppUpdateState) => void) {
    this.product = product;
    this.root = path.join(root, 'app-updates');
    this.emit = emit;
    this.state = { currentVersion: app.getVersion(), latestVersion: null, status: 'idle', progress: 0, message: 'Chưa kiểm tra cập nhật.' };
  }

  public snapshot(): AppUpdateState { return { ...this.state }; }

  public checkAndDownload(): Promise<AppUpdateState> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  public installReady(): boolean {
    if (this.state.status !== 'ready' || !this.installerPath || !fs.existsSync(this.installerPath)) return false;
    const child = spawn(this.installerPath, [], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    setTimeout(() => app.quit(), 250);
    return true;
  }

  private set(next: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...next };
    this.emit(this.snapshot());
  }

  private async run(): Promise<AppUpdateState> {
    try {
      this.set({ status: 'checking', progress: 0, message: 'Đang kiểm tra bản ứng dụng mới...' });
      const channel = JSON.parse((await getBuffer(CHANNEL_URL)).toString('utf8')) as UpdateChannel;
      const record = channel.products?.[this.product];
      if (!record?.version || !record.installerUrl || !/^[a-f0-9]{64}$/iu.test(record.sha256 || '')) {
        this.set({ status: 'up_to_date', latestVersion: null, progress: 100, message: 'Chưa có bản cập nhật ứng dụng được phát hành.' });
        return this.snapshot();
      }
      this.set({ latestVersion: record.version, releaseNotes: record.releaseNotes ?? '' });
      if (compareVersions(record.version, app.getVersion()) <= 0) {
        this.set({ status: 'up_to_date', progress: 100, message: `Đang dùng bản mới nhất ${app.getVersion()}.` });
        return this.snapshot();
      }

      this.set({ status: 'available', progress: 0, message: `Có bản ${record.version}. Đang tải trong nền...` });
      await fs.ensureDir(this.root);
      const target = path.join(this.root, path.basename(new URL(record.installerUrl).pathname) || `${this.product}-${record.version}.exe`);
      const part = `${target}.part`;
      await fs.remove(part);
      this.set({ status: 'downloading', progress: 0, message: `Đang tải ${record.version}...` });
      const data = await getBuffer(record.installerUrl, 0, (current, total) => {
        const pct = total > 0 ? Math.min(99, Math.floor((current / total) * 100)) : this.state.progress;
        if (pct !== this.state.progress) this.set({ progress: pct });
      });
      const actual = crypto.createHash('sha256').update(data).digest('hex').toLowerCase();
      if (actual !== record.sha256.toLowerCase()) throw new Error('SHA-256 của bản cập nhật không khớp. Đã hủy cài đặt.');
      await fs.writeFile(part, data);
      await fs.move(part, target, { overwrite: true });
      this.installerPath = target;
      this.set({ status: 'ready', progress: 100, message: `Bản ${record.version} đã sẵn sàng. Cập nhật khi bạn chọn.` });
      return this.snapshot();
    } catch (error) {
      this.set({ status: 'error', progress: 0, message: error instanceof Error ? error.message : String(error) });
      return this.snapshot();
    }
  }
}

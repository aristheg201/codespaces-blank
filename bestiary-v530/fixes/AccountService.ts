import { clipboard, safeStorage, shell } from 'electron';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import path from 'node:path';
import type { AccountSnapshot, AuthStatusEvent, MinecraftAuthorization, SkinVariant } from '../../shared/ipc';

const MS_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const MS_SCOPE = 'XboxLive.signin offline_access';
const USER_AGENT = 'BestiaryLauncher/5.3.0';
const MAX_SKIN_BYTES = 1024 * 1024;

interface PersistedAccount {
  mode: 'offline' | 'microsoft';
  microsoft?: {
    homeAccountId?: string;
    email?: string;
    uuid: string;
    username: string;
    xuid: string;
    skinUrl?: string;
    skinVariant?: SkinVariant;
  };
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval?: number;
  message?: string;
}

interface MinecraftProfile {
  id: string;
  name: string;
  skins?: Array<{ state?: string; url?: string; variant?: string }>;
}

export class AccountService {
  private readonly accountPath: string;
  private readonly tokenPath: string;
  private readonly gameDirectory: string;
  private readonly emit: (event: AuthStatusEvent) => void;
  private current: PersistedAccount = { mode: 'offline' };
  private refreshToken: string | null = null;
  private microsoftClientId = '';
  private loginPromise: Promise<AccountSnapshot> | null = null;

  public constructor(dataRoot: string, gameDirectory: string, emit: (event: AuthStatusEvent) => void) {
    this.accountPath = path.join(dataRoot, 'account.json');
    this.tokenPath = path.join(dataRoot, 'account-token.bin');
    this.gameDirectory = gameDirectory;
    this.emit = emit;
  }

  public async initialize(): Promise<void> {
    this.current = await fs.readJson(this.accountPath).catch(() => ({ mode: 'offline' as const }));
    this.refreshToken = await this.readEncryptedToken();
  }

  public setMicrosoftClientId(value: string | undefined): void {
    this.microsoftClientId = typeof value === 'string' ? value.trim() : '';
  }

  public snapshot(offlineUsername: string): AccountSnapshot {
    const ms = this.current.microsoft;
    return {
      mode: this.current.mode,
      offline: { username: offlineUsername },
      microsoftConfigured: Boolean(this.microsoftClientId),
      microsoft: ms ? {
        email: ms.email ?? '',
        username: ms.username,
        uuid: ms.uuid,
        xuid: ms.xuid,
        skinUrl: ms.skinUrl ?? '',
        skinVariant: ms.skinVariant ?? 'classic',
      } : null,
    };
  }

  public async selectMode(mode: 'offline' | 'microsoft'): Promise<void> {
    if (mode === 'microsoft' && !this.current.microsoft) throw new Error('Chưa đăng nhập tài khoản Microsoft.');
    this.current.mode = mode;
    await this.persist();
  }

  public async loginMicrosoft(): Promise<AccountSnapshot> {
    if (this.loginPromise) return this.loginPromise;
    const task = this.loginMicrosoftInternal();
    this.loginPromise = task;
    try { return await task; } finally { if (this.loginPromise === task) this.loginPromise = null; }
  }

  public async logoutMicrosoft(): Promise<void> {
    delete this.current.microsoft;
    this.current.mode = 'offline';
    this.refreshToken = null;
    await fs.remove(this.tokenPath);
    await this.persist();
    this.emit({ stage: 'idle', message: 'Đã đăng xuất Microsoft.' });
  }

  public async getLaunchAuthorization(offlineUsername: string): Promise<MinecraftAuthorization | null> {
    if (this.current.mode !== 'microsoft') return null;
    if (!this.current.microsoft) throw new Error('Tài khoản Microsoft không còn trong Launcher. Hãy đăng nhập lại.');
    const token = await this.acquireMicrosoftToken(false);
    const auth = await this.exchangeMinecraft(token.access_token);
    await this.updateMicrosoftProfile(auth.profile, auth.xuid);
    return this.toAuthorization(auth.accessToken, auth.profile, auth.xuid);
  }

  public async setSkin(filePath: string, variant: SkinVariant): Promise<AccountSnapshot> {
    const data = await this.readAndValidateSkin(filePath);
    await this.writeBridgeSkin(data, variant);

    if (this.current.mode === 'microsoft') {
      if (!this.current.microsoft) throw new Error('Chưa đăng nhập Microsoft.');
      const ms = await this.acquireMicrosoftToken(false);
      const auth = await this.exchangeMinecraft(ms.access_token);
      const form = new FormData();
      form.append('variant', variant);
      form.append('file', new Blob([new Uint8Array(data)], { type: 'image/png' }), path.basename(filePath));
      const response = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
        method: 'POST', headers: { Authorization: `Bearer ${auth.accessToken}`, 'User-Agent': USER_AGENT }, body: form,
      });
      if (!response.ok) throw new Error(`Minecraft Services từ chối skin (${response.status}).`);
      const profile = await this.fetchProfile(auth.accessToken);
      await this.updateMicrosoftProfile(profile, auth.xuid);
      this.emit({ stage: 'success', message: 'Đã đổi skin Minecraft chính chủ và đồng bộ Bestiary.' });
    } else {
      this.emit({ stage: 'success', message: 'Đã lưu skin Bestiary. Skin crack sẽ được áp dụng khi vào server.' });
    }
    return this.snapshot('');
  }

  public async resetSkin(): Promise<void> {
    await fs.remove(path.join(this.gameDirectory, '.bestiary', 'player-skin.png'));
    await fs.ensureDir(path.join(this.gameDirectory, '.bestiary'));
    await fs.writeJson(path.join(this.gameDirectory, '.bestiary', 'player-skin.json'), {
      action: 'reset', updatedAt: Date.now(),
    }, { spaces: 2 });
    if (this.current.mode === 'microsoft' && this.current.microsoft) {
      const ms = await this.acquireMicrosoftToken(false);
      const auth = await this.exchangeMinecraft(ms.access_token);
      const response = await fetch('https://api.minecraftservices.com/minecraft/profile/skins/active', {
        method: 'DELETE', headers: { Authorization: `Bearer ${auth.accessToken}`, 'User-Agent': USER_AGENT },
      });
      if (!response.ok && response.status !== 204) throw new Error(`Không thể reset skin chính chủ (${response.status}).`);
      const profile = await this.fetchProfile(auth.accessToken);
      await this.updateMicrosoftProfile(profile, auth.xuid);
    }
    this.emit({ stage: 'success', message: 'Đã đặt yêu cầu reset skin. Bestiary sẽ áp dụng ở lần vào server tiếp theo.' });
  }

  public async installClientBridge(sourceJar: string): Promise<void> {
    const stat = await fs.stat(sourceJar).catch(() => null);
    if (!stat?.isFile()) throw new Error('Bestiary Skin Bridge bundled jar is missing.');
    const mods = path.join(this.gameDirectory, 'mods');
    await fs.ensureDir(mods);
    for (const file of await fs.readdir(mods)) {
      if (/^bestiary-skin-bridge-.*\.jar$/iu.test(file)) await fs.remove(path.join(mods, file));
    }
    await fs.copyFile(sourceJar, path.join(mods, 'bestiary-skin-bridge-1.0.0.jar'));
  }

  private async loginMicrosoftInternal(): Promise<AccountSnapshot> {
    this.requireClientId();
    this.emit({ stage: 'requesting_code', message: 'Đang lấy mã đăng nhập Microsoft...' });
    const device = await this.postForm<DeviceCodeResponse>(`${MS_AUTHORITY}/devicecode`, {
      client_id: this.microsoftClientId, scope: MS_SCOPE,
    });
    clipboard.writeText(device.user_code);
    void shell.openExternal(device.verification_uri);
    this.emit({
      stage: 'device_code',
      message: device.message || 'Mở Microsoft và nhập mã để đăng nhập.',
      userCode: device.user_code,
      verificationUri: device.verification_uri,
      expiresAt: Date.now() + device.expires_in * 1000,
    });

    const deadline = Date.now() + device.expires_in * 1000;
    let interval = Math.max(5, device.interval ?? 5) * 1000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      const response = await this.postForm<TokenResponse>(`${MS_AUTHORITY}/token`, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: this.microsoftClientId, device_code: device.device_code,
      }, true);
      if (response.error === 'authorization_pending') continue;
      if (response.error === 'slow_down') { interval += 5000; continue; }
      if (response.error) throw new Error(this.friendlyMicrosoftError(response.error, response.error_description));
      if (!response.access_token) throw new Error('Microsoft không trả access token.');
      const auth = await this.exchangeMinecraft(response.access_token);
      if (response.refresh_token) await this.saveEncryptedToken(response.refresh_token);
      this.refreshToken = response.refresh_token ?? null;
      this.current.microsoft = {
        username: auth.profile.name,
        uuid: auth.profile.id,
        xuid: auth.xuid,
        skinUrl: this.activeSkin(auth.profile)?.url,
        skinVariant: this.skinVariant(auth.profile),
      };
      this.current.mode = 'microsoft';
      await this.persist();
      this.emit({ stage: 'success', message: `Đã đăng nhập Minecraft: ${auth.profile.name}` });
      return this.snapshot('');
    }
    throw new Error('Mã đăng nhập Microsoft đã hết hạn.');
  }

  private async acquireMicrosoftToken(interactive: boolean): Promise<TokenResponse> {
    this.requireClientId();
    if (this.refreshToken) {
      const refreshed = await this.postForm<TokenResponse>(`${MS_AUTHORITY}/token`, {
        grant_type: 'refresh_token', client_id: this.microsoftClientId, refresh_token: this.refreshToken, scope: MS_SCOPE,
      }, true);
      if (!refreshed.error && refreshed.access_token) {
        if (refreshed.refresh_token) { this.refreshToken = refreshed.refresh_token; await this.saveEncryptedToken(refreshed.refresh_token); }
        return refreshed;
      }
    }
    if (interactive) return this.acquireMicrosoftTokenAfterLogin();
    throw new Error('Phiên Microsoft đã hết hạn. Mở Quản lý tài khoản và đăng nhập lại.');
  }

  private async acquireMicrosoftTokenAfterLogin(): Promise<TokenResponse> {
    await this.loginMicrosoft();
    if (!this.refreshToken) throw new Error('Không lưu được phiên Microsoft.');
    return this.acquireMicrosoftToken(false);
  }

  private async exchangeMinecraft(msAccessToken: string): Promise<{ accessToken: string; xuid: string; profile: MinecraftProfile }> {
    this.emit({ stage: 'xbox', message: 'Đang xác thực Xbox Live...' });
    const xbl = await this.fetchJson<any>('https://user.auth.xboxlive.com/user/authenticate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' }),
    });
    const xsts = await this.fetchJson<any>('https://xsts.auth.xboxlive.com/xsts/authorize', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' }),
    });
    const claim = xsts.DisplayClaims?.xui?.[0];
    if (!claim?.uhs || !xsts.Token) throw new Error('Xbox XSTS không trả thông tin hợp lệ.');
    this.emit({ stage: 'minecraft', message: 'Đang xác minh Minecraft Java...' });
    const mc = await this.fetchJson<any>('https://api.minecraftservices.com/authentication/login_with_xbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ identityToken: `XBL3.0 x=${claim.uhs};${xsts.Token}` }),
    });
    const accessToken = String(mc.access_token || '');
    if (!accessToken) throw new Error('Minecraft Services không trả access token.');
    const entitlements = await this.fetchJson<any>('https://api.minecraftservices.com/entitlements/mcstore', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!Array.isArray(entitlements.items) || entitlements.items.length === 0) throw new Error('Tài khoản Microsoft này không sở hữu Minecraft Java Edition.');
    const profile = await this.fetchProfile(accessToken);
    return { accessToken, xuid: String(claim.xid || mc.username || ''), profile };
  }

  private async fetchProfile(accessToken: string): Promise<MinecraftProfile> {
    return this.fetchJson<MinecraftProfile>('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  private toAuthorization(accessToken: string, profile: MinecraftProfile, xuid: string): MinecraftAuthorization {
    return {
      access_token: accessToken,
      client_token: this.microsoftClientId,
      uuid: profile.id,
      name: profile.name,
      user_properties: '{}',
      meta: { type: 'msa', demo: false, xuid, clientId: this.microsoftClientId },
    };
  }

  private async updateMicrosoftProfile(profile: MinecraftProfile, xuid: string): Promise<void> {
    if (!this.current.microsoft) return;
    this.current.microsoft.username = profile.name;
    this.current.microsoft.uuid = profile.id;
    this.current.microsoft.xuid = xuid;
    this.current.microsoft.skinUrl = this.activeSkin(profile)?.url;
    this.current.microsoft.skinVariant = this.skinVariant(profile);
    await this.persist();
  }

  private activeSkin(profile: MinecraftProfile): { url?: string; variant?: string } | undefined {
    return profile.skins?.find((skin) => skin.state === 'ACTIVE') ?? profile.skins?.[0];
  }
  private skinVariant(profile: MinecraftProfile): SkinVariant { return this.activeSkin(profile)?.variant?.toUpperCase() === 'SLIM' ? 'slim' : 'classic'; }

  private async readAndValidateSkin(filePath: string): Promise<Buffer> {
    const resolved = path.resolve(filePath);
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isFile() || stat.size <= 0 || stat.size > MAX_SKIN_BYTES) throw new Error('Skin PNG phải là file dưới 1 MB.');
    const data = await fs.readFile(resolved);
    if (data.length < 24 || data.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error('File skin không phải PNG hợp lệ.');
    const width = data.readUInt32BE(16); const height = data.readUInt32BE(20);
    if (width !== 64 || (height !== 64 && height !== 32)) throw new Error(`Skin phải có kích thước 64x64 hoặc 64x32, hiện tại ${width}x${height}.`);
    return data;
  }

  private async writeBridgeSkin(data: Buffer, variant: SkinVariant): Promise<void> {
    const dir = path.join(this.gameDirectory, '.bestiary');
    await fs.ensureDir(dir);
    const hash = crypto.createHash('sha256').update(data).digest('hex');
    const tmp = path.join(dir, 'player-skin.png.tmp');
    await fs.writeFile(tmp, data);
    await fs.move(tmp, path.join(dir, 'player-skin.png'), { overwrite: true });
    await fs.writeJson(path.join(dir, 'player-skin.json'), { action: 'apply', variant, sha256: hash, updatedAt: Date.now() }, { spaces: 2 });
  }

  private async persist(): Promise<void> { await fs.ensureDir(path.dirname(this.accountPath)); await fs.writeJson(this.accountPath, this.current, { spaces: 2 }); }

  private async readEncryptedToken(): Promise<string | null> {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      const data = await fs.readFile(this.tokenPath);
      return safeStorage.decryptString(data);
    } catch { return null; }
  }

  private async saveEncryptedToken(value: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure storage không khả dụng, Launcher từ chối lưu refresh token dạng plaintext.');
    await fs.ensureDir(path.dirname(this.tokenPath));
    await fs.writeFile(this.tokenPath, safeStorage.encryptString(value));
  }

  private requireClientId(): void {
    if (!this.microsoftClientId) throw new Error('Microsoft Login chưa được cấu hình Client ID trong Bestiary Manager.');
    if (!/^[0-9a-f-]{20,64}$/iu.test(this.microsoftClientId)) throw new Error('Microsoft Client ID trong distribution không hợp lệ.');
  }

  private friendlyMicrosoftError(code: string, detail?: string): string {
    if (code === 'access_denied') return 'Đăng nhập Microsoft đã bị hủy.';
    if (code === 'expired_token') return 'Mã đăng nhập Microsoft đã hết hạn.';
    return `Microsoft OAuth lỗi ${code}${detail ? `: ${detail}` : ''}`;
  }

  private async postForm<T>(url: string, fields: Record<string, string>, allowError = false): Promise<T> {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': USER_AGENT },
      body: new URLSearchParams(fields),
    });
    const text = await response.text();
    let json: any; try { json = JSON.parse(text); } catch { throw new Error(`OAuth trả dữ liệu không hợp lệ (${response.status}).`); }
    if (!response.ok && !allowError) throw new Error(json.error_description || json.error || `HTTP ${response.status}`);
    return json as T;
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, headers: { 'User-Agent': USER_AGENT, ...(init.headers || {}) } });
    const text = await response.text();
    let json: any; try { json = JSON.parse(text); } catch { throw new Error(`Dịch vụ xác thực trả dữ liệu không hợp lệ (${response.status}).`); }
    if (!response.ok) {
      const xerr = json?.XErr ? ` XErr=${json.XErr}` : '';
      throw new Error(json?.errorMessage || json?.error_description || json?.message || `HTTP ${response.status}${xerr}`);
    }
    return json as T;
  }
}

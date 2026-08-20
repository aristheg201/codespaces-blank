from pathlib import Path
import re

root = Path('source')


def req(ok, msg):
    if not ok:
        raise SystemExit(msg)


# 5.3.5 is intentionally applied after the 5.3.4 backend bridge patch, while
# build.ps1 restores the 5.3.3 renderer UI before this patch runs.
# The goal is CurseForge-style routing without changing the 5.3.3 UX:
# - Bestiary still performs Microsoft identity sign-in (OIDC only).
# - Local / Offline direct-launches as before.
# - Microsoft mode syncs the client and opens the official Minecraft Launcher.
# - Xbox/XSTS/Minecraft Services remain available only behind the existing
#   microsoftDirectLaunch feature flag for a future approved AppID.

# ---------------------------------------------------------------------------
# AccountService: restore Microsoft sign-in for identity only in bridge mode.
# ---------------------------------------------------------------------------
p = root / 'src/main/core/AccountService.ts'
s = p.read_text(encoding='utf-8')

old = "const MS_SCOPE = 'XboxLive.signin offline_access';"
req(old in s, 'AccountService Microsoft scope marker missing')
s = s.replace(
    old,
    "const MS_GAME_SCOPE = 'XboxLive.signin offline_access';\n"
    "const MS_IDENTITY_SCOPE = 'openid profile email offline_access';",
    1,
)

old = "  access_token: string;\n  refresh_token?: string;"
req(old in s, 'TokenResponse access token marker missing')
s = s.replace(old, "  access_token: string;\n  id_token?: string;\n  refresh_token?: string;", 1)

old = """  public async initialize(): Promise<void> {
    this.current = await fs.readJson(this.accountPath).catch(() => ({ mode: 'offline' as const }));
    this.refreshToken = await this.readEncryptedToken();
  }"""
req(old in s, 'AccountService initialize marker missing')
s = s.replace(
    old,
    """  public async initialize(): Promise<void> {
    this.current = await fs.readJson(this.accountPath).catch(() => ({ mode: 'offline' as const }));
    this.refreshToken = await this.readEncryptedToken();
    if (this.current.mode === 'microsoft' && !this.current.microsoft) {
      this.current.mode = 'offline';
      await this.persist();
    }
  }""",
    1,
)

old = "    const ms = this.microsoftDirectLaunchEnabled ? this.current.microsoft : undefined;"
req(old in s, 'AccountService bridge-hidden account marker missing')
s = s.replace(old, "    const ms = this.current.microsoft;", 1)

old = "      microsoftConfigured: !this.microsoftDirectLaunchEnabled || Boolean(this.microsoftClientId),"
req(old in s, 'AccountService microsoftConfigured bridge marker missing')
s = s.replace(old, "      microsoftConfigured: Boolean(this.microsoftClientId),", 1)

old = "    if (mode === 'microsoft' && this.microsoftDirectLaunchEnabled && !this.current.microsoft) throw new Error('Chưa đăng nhập tài khoản Microsoft.');"
req(old in s, 'AccountService selectMode bridge guard missing')
s = s.replace(old, "    if (mode === 'microsoft' && !this.current.microsoft) throw new Error('Chưa đăng nhập tài khoản Microsoft.');", 1)

old = """  public async loginMicrosoft(): Promise<AccountSnapshot> {
    if (!this.microsoftDirectLaunchEnabled) {
      this.current.mode = 'microsoft';
      await this.persist();
      this.emit({ stage: 'success', message: 'Chế độ Microsoft dùng Minecraft Launcher chính thức. Bestiary không xử lý token game.' });
      return this.snapshot('');
    }
    if (this.loginPromise) return this.loginPromise;"""
req(old in s, 'AccountService 5.3.4 login bypass block missing')
s = s.replace(
    old,
    """  public async loginMicrosoft(): Promise<AccountSnapshot> {
    if (this.loginPromise) return this.loginPromise;""",
    1,
)

# Bridge-mode Microsoft skin remains server-local. It must never call the
# unapproved Minecraft Game Services APIs, but the existing 5.3.3 UI remains.
old = """  public async setSkin(filePath: string, variant: SkinVariant): Promise<AccountSnapshot> {
    if (this.current.mode === 'microsoft' && !this.microsoftDirectLaunchEnabled) {
      throw new Error('Skin Microsoft đang do Minecraft Launcher/minecraft.net quản lý trong chế độ Official Launcher Bridge.');
    }
    const data = await this.readAndValidateSkin(filePath);"""
req(old in s, 'AccountService 5.3.4 setSkin bridge guard missing')
s = s.replace(
    old,
    """  public async setSkin(filePath: string, variant: SkinVariant): Promise<AccountSnapshot> {
    const data = await this.readAndValidateSkin(filePath);""",
    1,
)

# Restrict the premium skin API branch to future direct-MSA mode only.
set_skin_marker = """    if (this.current.mode === 'microsoft') {
      if (!this.current.microsoft) throw new Error('Chưa đăng nhập Microsoft.');"""
req(set_skin_marker in s, 'AccountService Microsoft setSkin branch missing')
s = s.replace(
    set_skin_marker,
    """    if (this.current.mode === 'microsoft' && this.microsoftDirectLaunchEnabled) {
      if (!this.current.microsoft) throw new Error('Chưa đăng nhập Microsoft.');""",
    1,
)

old = """    } else {
      this.emit({ stage: 'success', message: 'Đã lưu skin Bestiary. Skin local/offline sẽ được áp dụng khi vào server.' });
    }
    return this.snapshot('');"""
req(old in s, 'AccountService local skin success block missing')
s = s.replace(
    old,
    """    } else {
      this.emit({
        stage: 'success',
        message: this.current.mode === 'microsoft'
          ? 'Đã lưu skin Bestiary cho server. Skin tài khoản Microsoft gốc vẫn do Minecraft Launcher/minecraft.net quản lý.'
          : 'Đã lưu skin Bestiary. Skin local/offline sẽ được áp dụng khi vào server.',
      });
    }
    return this.snapshot('');""",
    1,
)

old = """  public async resetSkin(): Promise<void> {
    if (this.current.mode === 'microsoft' && !this.microsoftDirectLaunchEnabled) {
      throw new Error('Skin Microsoft đang do Minecraft Launcher/minecraft.net quản lý trong chế độ Official Launcher Bridge.');
    }
    await fs.remove(path.join(this.gameDirectory, '.bestiary', 'player-skin.png'));"""
req(old in s, 'AccountService 5.3.4 resetSkin bridge guard missing')
s = s.replace(
    old,
    """  public async resetSkin(): Promise<void> {
    await fs.remove(path.join(this.gameDirectory, '.bestiary', 'player-skin.png'));""",
    1,
)

old = "    if (this.current.mode === 'microsoft' && this.current.microsoft) {"
req(old in s, 'AccountService resetSkin Microsoft branch missing')
s = s.replace(old, "    if (this.current.mode === 'microsoft' && this.current.microsoft && this.microsoftDirectLaunchEnabled) {", 1)

old = "    this.emit({ stage: 'success', message: 'Đã đặt yêu cầu reset skin. Bestiary sẽ áp dụng ở lần vào server tiếp theo.' });"
req(old in s, 'AccountService resetSkin success marker missing')
s = s.replace(
    old,
    "    this.emit({ stage: 'success', message: this.current.mode === 'microsoft' && !this.microsoftDirectLaunchEnabled ? 'Đã reset skin Bestiary trên server. Skin Microsoft gốc vẫn do Minecraft Launcher/minecraft.net quản lý.' : 'Đã đặt yêu cầu reset skin. Bestiary sẽ áp dụng ở lần vào server tiếp theo.' });",
    1,
)

old = "      client_id: this.microsoftClientId, scope: MS_SCOPE,"
req(old in s, 'AccountService device-code scope marker missing')
s = s.replace(old, "      client_id: this.microsoftClientId, scope: this.microsoftScope(),", 1)

old = """      if (!response.access_token) throw new Error('Microsoft không trả access token.');
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
      return this.snapshot('');"""
req(old in s, 'AccountService Microsoft token success block missing')
new = """      if (!response.access_token) throw new Error('Microsoft không trả access token.');
      if (response.refresh_token) await this.saveEncryptedToken(response.refresh_token);
      this.refreshToken = response.refresh_token ?? null;

      if (!this.microsoftDirectLaunchEnabled) {
        const identity = this.readMicrosoftIdentity(response.id_token);
        this.current.microsoft = {
          homeAccountId: identity.homeAccountId,
          email: identity.email,
          username: identity.username,
          uuid: identity.identityId,
          xuid: '',
          skinUrl: undefined,
          skinVariant: 'classic',
        };
        this.current.mode = 'microsoft';
        await this.persist();
        this.emit({ stage: 'success', message: `Đã đăng nhập Microsoft: ${identity.username}` });
        return this.snapshot('');
      }

      const auth = await this.exchangeMinecraft(response.access_token);
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
      return this.snapshot('');"""
s = s.replace(old, new, 1)

old = "        grant_type: 'refresh_token', client_id: this.microsoftClientId, refresh_token: this.refreshToken, scope: MS_SCOPE,"
req(old in s, 'AccountService refresh scope marker missing')
s = s.replace(old, "        grant_type: 'refresh_token', client_id: this.microsoftClientId, refresh_token: this.refreshToken, scope: this.microsoftScope(),", 1)

marker = "  private async exchangeMinecraft(msAccessToken: string): Promise<{ accessToken: string; xuid: string; profile: MinecraftProfile }> {"
req(marker in s, 'AccountService exchangeMinecraft marker missing')
helper = """  private microsoftScope(): string {
    return this.microsoftDirectLaunchEnabled ? MS_GAME_SCOPE : MS_IDENTITY_SCOPE;
  }

  private readMicrosoftIdentity(idToken: string | undefined): { homeAccountId: string; email: string; username: string; identityId: string } {
    if (!idToken) throw new Error('Microsoft không trả ID token cho phiên đăng nhập.');
    const parts = idToken.split('.');
    if (parts.length < 2) throw new Error('Microsoft ID token không hợp lệ.');
    let payload: Record<string, unknown>;
    try {
      const segment = parts[1].replace(/-/gu, '+').replace(/_/gu, '/');
      const padded = segment + '='.repeat((4 - (segment.length % 4)) % 4);
      payload = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new Error('Không đọc được Microsoft ID token.');
    }

    const audience = String(payload.aud ?? '');
    if (audience !== this.microsoftClientId) throw new Error('Microsoft ID token không dành cho Bestiary Launcher.');
    const expiresAt = Number(payload.exp ?? 0);
    if (Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt * 1000 <= Date.now()) throw new Error('Microsoft ID token đã hết hạn.');

    const subject = String(payload.oid ?? payload.sub ?? '').trim();
    if (!subject) throw new Error('Microsoft ID token thiếu định danh người dùng.');
    const tenant = String(payload.tid ?? 'consumers').trim();
    const preferred = String(payload.preferred_username ?? '').trim();
    const email = String(payload.email ?? preferred).trim();
    const username = String(payload.name ?? '').trim() || preferred || email || 'Microsoft';
    const identityId = crypto.createHash('sha256').update(`${tenant}:${subject}`).digest('hex').slice(0, 32);
    return { homeAccountId: `${tenant}.${subject}`, email, username, identityId };
  }

"""
s = s.replace(marker, helper + marker, 1)

# If direct launch is enabled later, an identity-only account must re-consent
# to the Xbox/Minecraft scope rather than silently pretending it has a game session.
old = """    if (!this.microsoftDirectLaunchEnabled) return null;
    if (!this.current.microsoft) throw new Error('Tài khoản Microsoft không còn trong Launcher. Hãy đăng nhập lại.');"""
req(old in s, 'AccountService direct launch authorization guard missing')
s = s.replace(
    old,
    """    if (!this.microsoftDirectLaunchEnabled) return null;
    if (!this.current.microsoft) throw new Error('Tài khoản Microsoft không còn trong Launcher. Hãy đăng nhập lại.');
    if (!this.current.microsoft.xuid) throw new Error('Microsoft direct launch đã được bật. Hãy đăng xuất rồi đăng nhập Microsoft lại để cấp quyền Minecraft.');""",
    1,
)

s = s.replace('BestiaryLauncher/5.3.4', 'BestiaryLauncher/5.3.5')
p.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# Remote/runtime version metadata. microsoftDirectLaunch remains opt-in false.
# ---------------------------------------------------------------------------
p = root / 'src/main/core/RemoteService.ts'
s = p.read_text(encoding='utf-8').replace('BestiaryLauncher/5.3.4', 'BestiaryLauncher/5.3.5')
p.write_text(s, encoding='utf-8')

p = root / 'src/renderer/src/App.tsx'
s = p.read_text(encoding='utf-8')
s = re.sub(r"currentVersion:\s*'\d+\.\d+\.\d+'", "currentVersion: '5.3.5'", s, count=1)
req("currentVersion: '5.3.5'" in s, 'Unable to bump App version to 5.3.5')
p.write_text(s, encoding='utf-8')

# Home is the restored 5.3.3 UI. Only replace literal version badges/comments;
# no structure, labels, CTA or account layout may change.
p = root / 'src/renderer/src/components/Home.tsx'
s = p.read_text(encoding='utf-8').replace('5.3.3', '5.3.5')
p.write_text(s, encoding='utf-8')

# Contract probes for the requested flow.
account = (root / 'src/main/core/AccountService.ts').read_text(encoding='utf-8')
main = (root / 'src/main/index.ts').read_text(encoding='utf-8')
home = (root / 'src/renderer/src/components/Home.tsx').read_text(encoding='utf-8')
account_ui = (root / 'src/renderer/src/components/AccountScreen.tsx').read_text(encoding='utf-8')
req("MS_IDENTITY_SCOPE = 'openid profile email offline_access'" in account, 'OIDC identity scope missing')
req('readMicrosoftIdentity(response.id_token)' in account, 'Microsoft identity login path missing')
req("if (!this.microsoftDirectLaunchEnabled) return null;" in account, 'Bridge must not mint a Minecraft authorization')
req('exchangeMinecraft(response.access_token)' in account, 'Future direct-MSA compatibility was removed')
req('officialLauncherBridge.prepareAndOpen(profileId)' in main, 'Microsoft Play route is not wired to the official launcher')
req("'CHƠI NGAY'" in home and "'CÀI CLIENT & CHƠI'" in home, '5.3.3 Home Play CTA was changed')
req('ĐĂNG NHẬP MICROSOFT' in account_ui, '5.3.3 Microsoft login action was removed')
req("MICROSOFT · ONLINE" in account_ui, '5.3.3 account UI semantics were unexpectedly replaced')

print('Bestiary Launcher 5.3.5 Microsoft-identity / official-launcher flow applied with 5.3.3 UI preserved.')

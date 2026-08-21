import axios from 'axios';
import {
  DEFAULT_ANNOUNCEMENTS_URL,
  DEFAULT_CHANNEL_URL,
  DEFAULT_FABRIC_LOADER,
  DEFAULT_MINECRAFT_VERSION,
  DEFAULT_SERVER_PORT,
  REMOTE_CONFIG_URL,
} from '../../shared/constants';
import type { RemoteReleaseInfo } from '../../shared/ipc';

interface RemoteConfig {
  channelUrl?: string;
  announcementsUrl?: string;
  discordUrl?: string;
  serverHost?: string;
  serverPort?: number;
  defaultMinecraftVersion?: string;
  defaultFabricLoader?: string;
}

interface ChannelPointer {
  version?: string;
  manifest?: string;
}

interface Announcement {
  title?: string;
  body?: string;
  message?: string;
  content?: string;
}

export class RemoteService {
  public static async fetchReleaseInfo(): Promise<RemoteReleaseInfo> {
    const config: RemoteConfig = await this.fetchJson<RemoteConfig>(REMOTE_CONFIG_URL).catch(
      (): RemoteConfig => ({}),
    );
    const channelUrl = this.isHttpUrl(config.channelUrl) ? config.channelUrl : DEFAULT_CHANNEL_URL;
    const announcementsUrl = this.isHttpUrl(config.announcementsUrl)
      ? config.announcementsUrl
      : DEFAULT_ANNOUNCEMENTS_URL;

    const [channel, announcements] = await Promise.all([
      this.fetchJson<ChannelPointer>(channelUrl).catch((): ChannelPointer => ({})),
      this.fetchJson<unknown>(announcementsUrl).catch((): unknown => ({ announcements: [] })),
    ]);

    const announcement = this.pickAnnouncement(announcements);

    return {
      version: typeof channel.version === 'string' && channel.version.trim() ? channel.version.trim() : null,
      manifestUrl: this.isHttpUrl(channel.manifest) ? channel.manifest : null,
      announcementTitle: announcement.title,
      announcementBody: announcement.body,
      discordUrl: this.isHttpUrl(config.discordUrl) ? config.discordUrl : '',
      minecraftVersion:
        typeof config.defaultMinecraftVersion === 'string' && config.defaultMinecraftVersion.trim()
          ? config.defaultMinecraftVersion.trim()
          : DEFAULT_MINECRAFT_VERSION,
      fabricLoader:
        typeof config.defaultFabricLoader === 'string' && config.defaultFabricLoader.trim()
          ? config.defaultFabricLoader.trim()
          : DEFAULT_FABRIC_LOADER,
      serverHost: typeof config.serverHost === 'string' ? config.serverHost.trim() : '',
      serverPort:
        Number.isInteger(config.serverPort) && Number(config.serverPort) >= 1 && Number(config.serverPort) <= 65535
          ? Number(config.serverPort)
          : DEFAULT_SERVER_PORT,
    };
  }

  private static async fetchJson<T>(url: string): Promise<T> {
    const response = await axios.get<T>(url, {
      timeout: 15_000,
      responseType: 'json',
      validateStatus: (status) => status >= 200 && status < 300,
      headers: {
        'User-Agent': 'BestiaryLauncher/5.0.0',
        Accept: 'application/json',
      },
    });
    return response.data;
  }

  private static isHttpUrl(value: unknown): value is string {
    if (typeof value !== 'string' || !value.trim()) return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }

  private static pickAnnouncement(raw: unknown): { title: string; body: string } {
    const fallback = {
      title: 'THÔNG BÁO MÁY CHỦ',
      body: 'Chưa có thông báo mới.',
    };

    if (!raw || typeof raw !== 'object') return fallback;
    const obj = raw as Record<string, unknown>;
    const list = Array.isArray(obj.announcements) ? obj.announcements : [];
    const item = list.find((entry) => entry && typeof entry === 'object') as Announcement | undefined;
    if (!item) return fallback;

    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : fallback.title;
    const bodyCandidate = item.body ?? item.message ?? item.content;
    const body = typeof bodyCandidate === 'string' && bodyCandidate.trim() ? bodyCandidate.trim() : fallback.body;
    return { title, body };
  }
}

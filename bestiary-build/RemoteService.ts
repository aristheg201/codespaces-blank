import axios from 'axios';
import {
  DEFAULT_FABRIC_LOADER,
  DEFAULT_MINECRAFT_VERSION,
  DEFAULT_SERVER_PORT,
} from '../../shared/constants';
import type { RemoteReleaseInfo } from '../../shared/ipc';

const DISTRIBUTION_BASE =
  'https://raw.githubusercontent.com/aristheg201/bestiary-distribution/main/bestiary-distribution';
const REMOTE_CONFIG_URL = `${DISTRIBUTION_BASE}/config.json`;
const DEFAULT_STABLE_CHANNEL_URL = `${DISTRIBUTION_BASE}/channels/stable.json`;
const DEFAULT_TESTING_CHANNEL_URL = `${DISTRIBUTION_BASE}/channels/testing.json`;
const DEFAULT_ANNOUNCEMENTS_URL = `${DISTRIBUTION_BASE}/announcements.json`;

interface RemoteConfig {
  channelUrl?: string;
  stableChannelUrl?: string;
  testingChannelUrl?: string;
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
  manifestUrl?: string;
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

    const stableChannelUrl = this.pickUrl(
      config.stableChannelUrl ?? config.channelUrl,
      DEFAULT_STABLE_CHANNEL_URL,
    );
    const testingChannelUrl = this.pickUrl(config.testingChannelUrl, DEFAULT_TESTING_CHANNEL_URL);
    const announcementsUrl = this.pickUrl(config.announcementsUrl, DEFAULT_ANNOUNCEMENTS_URL);

    const [channel, announcements] = await Promise.all([
      this.fetchChannelWithBootstrapFallback(stableChannelUrl, testingChannelUrl),
      this.fetchJson<unknown>(announcementsUrl).catch((): unknown => ({ items: [] })),
    ]);

    const announcement = this.pickAnnouncement(announcements);
    const manifestCandidate = channel.manifestUrl ?? channel.manifest;

    return {
      version: typeof channel.version === 'string' && channel.version.trim() ? channel.version.trim() : null,
      manifestUrl: this.isHttpUrl(manifestCandidate) ? manifestCandidate : null,
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

  private static async fetchChannelWithBootstrapFallback(
    stableChannelUrl: string,
    testingChannelUrl: string,
  ): Promise<ChannelPointer> {
    try {
      return await this.fetchJson<ChannelPointer>(stableChannelUrl);
    } catch {
      // The very first Bestiary release may exist only on testing before a stable pointer is created.
      // Once stable.json exists, normal launchers will always use it and testing no longer leaks to players.
      return this.fetchJson<ChannelPointer>(testingChannelUrl).catch((): ChannelPointer => ({}));
    }
  }

  private static pickUrl(value: unknown, fallback: string): string {
    return this.isHttpUrl(value) ? value : fallback;
  }

  private static async fetchJson<T>(url: string): Promise<T> {
    const response = await axios.get<T>(url, {
      timeout: 15_000,
      responseType: 'json',
      validateStatus: (status) => status >= 200 && status < 300,
      headers: {
        'User-Agent': 'BestiaryLauncher/5.0.1',
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      params: {
        t: Date.now(),
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
    const list = Array.isArray(obj.items)
      ? obj.items
      : Array.isArray(obj.announcements)
        ? obj.announcements
        : [];
    const item = list.find((entry) => entry && typeof entry === 'object') as Announcement | undefined;
    if (!item) return fallback;

    const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : fallback.title;
    const bodyCandidate = item.body ?? item.message ?? item.content;
    const body = typeof bodyCandidate === 'string' && bodyCandidate.trim() ? bodyCandidate.trim() : fallback.body;
    return { title, body };
  }
}

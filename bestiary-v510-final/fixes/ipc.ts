export type PerformancePreset = 'balanced' | 'performance' | 'quality' | 'custom';
export type ClientProfileId = 'full' | 'lite';
export type LibraryKind = 'mods' | 'resourcepacks' | 'shaderpacks';

export interface LauncherSettings {
  username: string;
  minRamMb: number;
  maxRamMb: number;
  width: number;
  height: number;
  fullscreen: boolean;
  performancePreset: PerformancePreset;
  clientProfile: ClientProfileId | null;
  customJvmArgs: string;
  generatedJvmArgs: string[];
}

export interface ClientProfileInfo {
  id: ClientProfileId;
  name: string;
  description: string;
  minimumRamMb: number;
  recommendedRamMb: number;
  fileCount?: number;
  totalBytes?: number;
}

export interface RemoteReleaseInfo {
  version: string | null;
  manifestUrl: string | null;
  announcementTitle: string;
  announcementBody: string;
  discordUrl: string;
  minecraftVersion: string;
  fabricLoader: string;
  serverName: string;
  serverHost: string;
  serverPort: number;
  profiles: ClientProfileInfo[];
}

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  path: string;
  fileName: string;
  displayName: string;
  version?: string;
  modId?: string;
  size: number;
  managed: boolean;
  enabled: boolean;
}

export interface LibrarySnapshot {
  mods: LibraryItem[];
  resourcepacks: LibraryItem[];
  shaderpacks: LibraryItem[];
}

export interface LauncherSnapshot {
  settings: LauncherSettings;
  release: RemoteReleaseInfo;
  localPackVersion: string | null;
  gameInstalled: boolean;
  launching: boolean;
  systemRamMb: number;
  cpuThreads: number;
  generatedJvmArgs: string[];
}

export interface UiProgressEvent {
  stage: 'idle' | 'checking' | 'syncing' | 'java' | 'fabric' | 'launching' | 'running' | 'error';
  percent: number;
  title: string;
  detail: string;
  speedMBps: number;
  etaSeconds: number | null;
}

export interface GameLogEvent {
  level: 'info' | 'error' | 'debug';
  message: string;
}

export interface LaunchResponse {
  ok: boolean;
  message?: string;
}

export interface RendererApi {
  getSnapshot(): Promise<LauncherSnapshot>;
  saveSettings(settings: LauncherSettings): Promise<LauncherSnapshot>;
  generateJvmFlags(settings: LauncherSettings): Promise<LauncherSnapshot>;
  startGame(settings: LauncherSettings): Promise<LaunchResponse>;
  cancelSync(): Promise<void>;
  openDiscord(): Promise<void>;
  openGameFolder(): Promise<void>;
  getLibrary(): Promise<LibrarySnapshot>;
  chooseLibraryFiles(kind: LibraryKind): Promise<string[]>;
  installLibraryFiles(kind: LibraryKind, paths: string[]): Promise<LibrarySnapshot>;
  toggleLibraryItem(itemPath: string): Promise<LibrarySnapshot>;
  removeLibraryItem(itemPath: string): Promise<LibrarySnapshot>;
  openLibraryFolder(kind: LibraryKind): Promise<void>;
  onProgress(listener: (event: UiProgressEvent) => void): () => void;
  onGameLog(listener: (event: GameLogEvent) => void): () => void;
}

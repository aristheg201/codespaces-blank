export type ManagedArea = 'mods' | 'config' | 'resourcepacks';
export type ClientProfileId = 'full' | 'lite';

export interface ModMetadata {
  id: string;
  name: string;
  version: string;
}

export interface ManagedFile {
  path: string;
  hash: string;
  size: number;
  modifiedAt: number;
  area: ManagedArea;
  mod?: ModMetadata;
}

export type StageKind = 'add' | 'replace' | 'remove';

export interface StagedChange {
  id: string;
  kind: StageKind;
  targetPath: string;
  sourcePath?: string;
  stagedPath?: string;
  previousPath?: string;
  size: number;
  hash?: string;
  mod?: ModMetadata;
  previousMod?: ModMetadata;
}

export interface WorkspaceSnapshot {
  root: string | null;
  files: ManagedFile[];
  staged: StagedChange[];
  scanning: boolean;
  scanProgress?: ProgressState;
  distribution?: DistributionStatus;
}

export interface ProgressState {
  phase: string;
  current?: string;
  completed: number;
  total: number;
  completedBytes?: number;
  totalBytes?: number;
  message?: string;
  authCode?: string;
  authUrl?: string;
  indeterminate?: boolean;
}

export interface ReleaseRecord {
  version: string;
  title: string;
  changelog: string;
  createdAt: number;
  manifestUrl: string;
  fileCount: number;
  totalBytes: number;
  channel: 'testing' | 'stable';
}

export interface DistributionSettings {
  repository: string;
  discordUrl: string;
  announcementTitle: string;
  announcementBody: string;
  serverName: string;
  serverHost: string;
  serverPort: number;
  minecraftVersion: string;
  modLoader: 'fabric';
  fabricLoaderVersion: string;
  javaMajor: number;
}

export interface DistributionStatus {
  authenticated: boolean;
  login?: string;
  repository?: string;
  repositoryPublic?: boolean;
  message?: string;
}

export interface PublishRequest {
  version: string;
  title: string;
  changelog: string;
  channel: 'testing' | 'stable';
  profilesByPath: Record<string, ClientProfileId[]>;
}

export interface PublishResult {
  release: ReleaseRecord;
  uploadedObjects: number;
  reusedObjects: number;
}

export interface AppSettings {
  workspaceRoot?: string;
  distribution: DistributionSettings;
}

export interface ManagerApi {
  chooseWorkspace(): Promise<string | null>;
  openWorkspace(root: string): Promise<WorkspaceSnapshot>;
  rescanWorkspace(): Promise<WorkspaceSnapshot>;
  getSnapshot(): Promise<WorkspaceSnapshot>;
  chooseJarFiles(): Promise<string[]>;
  stageJarFiles(paths: string[]): Promise<WorkspaceSnapshot>;
  unstage(id: string): Promise<WorkspaceSnapshot>;
  clearStaging(): Promise<WorkspaceSnapshot>;
  applyStaging(): Promise<WorkspaceSnapshot>;
  stageRemove(path: string): Promise<WorkspaceSnapshot>;
  revealPath(path: string): Promise<void>;
  openWorkspaceFolder(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveDistributionSettings(settings: DistributionSettings): Promise<AppSettings>;
  connectGithub(): Promise<DistributionStatus>;
  cancelGithubAuth(): Promise<void>;
  openExternal(url: string): Promise<void>;
  getDistributionStatus(): Promise<DistributionStatus>;
  ensureDistributionRepository(preferred?: string): Promise<DistributionStatus>;
  publish(request: PublishRequest): Promise<PublishResult>;
  listReleases(): Promise<ReleaseRecord[]>;
  promoteStable(version: string): Promise<void>;
  getPathForFile(file: File): string;
  onProgress(listener: (progress: ProgressState) => void): () => void;
}

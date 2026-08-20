export type ManagedArea = 'mods' | 'config' | 'resourcepacks';
export type ClientProfileId = 'full' | 'lite' | 'android';
export type DistributionProfileId = ClientProfileId | 'server';
export type ImportStatus = 'up_to_date' | 'update' | 'new' | 'changed';
export type AppUpdateStatus = 'idle' | 'checking' | 'up_to_date' | 'available' | 'downloading' | 'ready' | 'error';
export type ModSide = 'client' | 'server' | 'both' | 'unknown';
export type ModSideOverride = 'auto' | Exclude<ModSide, 'unknown'>;
export type DetectionConfidence = 'high' | 'medium' | 'low';
export type AndroidCompatibility = 'auto' | 'compatible' | 'blocked';

export interface AppUpdateState {
  currentVersion: string;
  latestVersion: string | null;
  status: AppUpdateStatus;
  progress: number;
  message: string;
  releaseNotes?: string;
}

export interface ModMetadata { id: string; name: string; version: string; }

export interface ModSideDetection {
  side: ModSide;
  confidence: DetectionConfidence;
  source: 'fabric.mod.json' | 'entrypoints' | 'mixins' | 'bytecode' | 'unknown';
  reasons: string[];
  environment?: string;
  analyzedAt: number;
}

export interface ModPolicy {
  enabled: boolean;
  sideOverride: ModSideOverride;
  profiles: DistributionProfileId[];
  androidCompatibility: AndroidCompatibility;
  reviewed: boolean;
}

export interface ManagedFile {
  path: string;
  hash: string;
  size: number;
  modifiedAt: number;
  area: ManagedArea;
  mod?: ModMetadata;
  sideDetection?: ModSideDetection;
  policy?: ModPolicy;
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
  suggestedProfiles?: DistributionProfileId[];
  importStatus?: ImportStatus;
  packageName?: string;
  sideDetection?: ModSideDetection;
  policy?: ModPolicy;
}

export interface ModAuditSummary {
  total: number;
  client: number;
  server: number;
  both: number;
  unknown: number;
  disabled: number;
  android: number;
  warnings: number;
}

export interface WorkspaceSnapshot {
  root: string | null;
  files: ManagedFile[];
  staged: StagedChange[];
  scanning: boolean;
  scanProgress?: ProgressState;
  distribution?: DistributionStatus;
  audit?: ModAuditSummary;
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

export interface PackageImportItem {
  packageName: string;
  profile: ClientProfileId;
  fileName: string;
  targetPath: string;
  mod?: ModMetadata;
  status: ImportStatus;
  currentVersion?: string;
  importedVersion?: string;
  size: number;
}

export interface PackageImportResult { snapshot: WorkspaceSnapshot; items: PackageImportItem[]; warnings: string[]; }
export interface ReleaseRecord { version:string; title:string; changelog:string; createdAt:number; manifestUrl:string; fileCount:number; totalBytes:number; channel:'testing'|'stable'; }

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
  microsoftClientId: string;
}

export interface DistributionStatus { authenticated:boolean; login?:string; repository?:string; repositoryPublic?:boolean; message?:string; }

export interface PublishRequest {
  version: string;
  title: string;
  changelog: string;
  channel: 'testing' | 'stable';
  profilesByPath: Record<string, DistributionProfileId[]>;
  enabledByPath: Record<string, boolean>;
  sideByPath: Record<string, ModSide>;
  androidCompatibilityByPath: Record<string, AndroidCompatibility>;
}

export interface PublishResult { release:ReleaseRecord; uploadedObjects:number; reusedObjects:number; }
export interface AppSettings { workspaceRoot?:string; distribution:DistributionSettings; }

export interface ManagerApi {
  chooseWorkspace(): Promise<string|null>;
  openWorkspace(root:string): Promise<WorkspaceSnapshot>;
  rescanWorkspace(): Promise<WorkspaceSnapshot>;
  getSnapshot(): Promise<WorkspaceSnapshot>;
  chooseJarFiles(): Promise<string[]>;
  choosePackageFiles(): Promise<string[]>;
  stageJarFiles(paths:string[]): Promise<WorkspaceSnapshot>;
  importModPackages(paths:string[]): Promise<PackageImportResult>;
  unstage(id:string): Promise<WorkspaceSnapshot>;
  clearStaging(): Promise<WorkspaceSnapshot>;
  applyStaging(): Promise<WorkspaceSnapshot>;
  stageRemove(path:string): Promise<WorkspaceSnapshot>;
  setModPolicy(path:string, patch:Partial<ModPolicy>): Promise<WorkspaceSnapshot>;
  redetectMod(path?:string): Promise<WorkspaceSnapshot>;
  revealPath(path:string): Promise<void>;
  openWorkspaceFolder(): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveDistributionSettings(settings:DistributionSettings): Promise<AppSettings>;
  connectGithub(): Promise<DistributionStatus>;
  cancelGithubAuth(): Promise<void>;
  openExternal(url:string): Promise<void>;
  getDistributionStatus(): Promise<DistributionStatus>;
  ensureDistributionRepository(preferred?:string): Promise<DistributionStatus>;
  publish(request:PublishRequest): Promise<PublishResult>;
  listReleases(): Promise<ReleaseRecord[]>;
  promoteStable(version:string): Promise<void>;
  getAppUpdate(): Promise<AppUpdateState>;
  checkAppUpdate(): Promise<AppUpdateState>;
  installAppUpdate(): Promise<boolean>;
  onAppUpdate(listener:(state:AppUpdateState)=>void):()=>void;
  getPathForFile(file:File):string;
  onProgress(listener:(progress:ProgressState)=>void):()=>void;
}

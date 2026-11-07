import { create } from 'zustand';
import type { AppSettings, DistributionSettings, DistributionStatus, PackageImportResult, ProgressState, PublishRequest, ReleaseRecord, WorkspaceSnapshot } from '../../shared/types';

type View = 'client' | 'release' | 'settings';
interface State {
  view: View;
  snapshot: WorkspaceSnapshot;
  settings: AppSettings | null;
  distribution: DistributionStatus | null;
  releases: ReleaseRecord[];
  progress: ProgressState | null;
  busy: boolean;
  error: string | null;
  setView(view: View): void;
  setProgress(progress: ProgressState | null): void;
  clearError(): void;
  load(): Promise<void>;
  chooseWorkspace(): Promise<void>;
  rescan(): Promise<void>;
  chooseAndStage(): Promise<void>;
  stagePaths(paths: string[]): Promise<void>;
  importPackages(paths: string[]): Promise<PackageImportResult | null>;
  unstage(id: string): Promise<void>;
  clearStaging(): Promise<void>;
  applyStaging(): Promise<void>;
  stageRemove(path: string): Promise<void>;
  saveDistribution(settings: DistributionSettings): Promise<void>;
  connectGithub(): Promise<void>;
  cancelGithubAuth(): Promise<void>;
  ensureRepository(preferred?: string): Promise<void>;
  publish(request: PublishRequest): Promise<void>;
  promote(version: string): Promise<void>;
}
const EMPTY: WorkspaceSnapshot = { root: null, files: [], staged: [], scanning: false };
async function guarded<T>(set: (partial: Partial<State>) => void, action: () => Promise<T>): Promise<T | null> {
  set({ busy: true, error: null });
  try { return await action(); }
  catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); return null; }
  finally { set({ busy: false }); }
}
export const useManager = create<State>((set) => ({
  view: 'client', snapshot: EMPTY, settings: null, distribution: null, releases: [], progress: null, busy: false, error: null,
  setView: (view) => set({ view }), setProgress: (progress) => set({ progress }), clearError: () => set({ error: null }),
  load: async () => { await guarded(set, async () => { const [snapshot, settings, distribution, releases] = await Promise.all([window.bestiary.getSnapshot(), window.bestiary.getSettings(), window.bestiary.getDistributionStatus(), window.bestiary.listReleases()]); set({ snapshot, settings, distribution, releases }); }); },
  chooseWorkspace: async () => { await guarded(set, async () => { const root = await window.bestiary.chooseWorkspace(); if (!root) return; set({ snapshot: await window.bestiary.getSnapshot() }); }); },
  rescan: async () => { await guarded(set, async () => set({ snapshot: await window.bestiary.rescanWorkspace() })); },
  chooseAndStage: async () => { await guarded(set, async () => { const paths = await window.bestiary.chooseJarFiles(); if (paths.length) set({ snapshot: await window.bestiary.stageJarFiles(paths) }); }); },
  stagePaths: async (paths) => { await guarded(set, async () => { if (paths.length) set({ snapshot: await window.bestiary.stageJarFiles(paths) }); }); },
  importPackages: async (paths) => {
    const result = await guarded(set, async () => { if (!paths.length) return null; const imported = await window.bestiary.importModPackages(paths); set({ snapshot: imported.snapshot }); return imported; });
    return result ?? null;
  },
  unstage: async (id) => { await guarded(set, async () => set({ snapshot: await window.bestiary.unstage(id) })); },
  clearStaging: async () => { await guarded(set, async () => set({ snapshot: await window.bestiary.clearStaging() })); },
  applyStaging: async () => { await guarded(set, async () => set({ snapshot: await window.bestiary.applyStaging() })); },
  stageRemove: async (filePath) => { await guarded(set, async () => set({ snapshot: await window.bestiary.stageRemove(filePath) })); },
  saveDistribution: async (distributionSettings) => { await guarded(set, async () => { const settings = await window.bestiary.saveDistributionSettings(distributionSettings); const distribution = await window.bestiary.getDistributionStatus(); set({ settings, distribution }); }); },
  connectGithub: async () => { await guarded(set, async () => set({ distribution: await window.bestiary.connectGithub(), progress: null })); },
  cancelGithubAuth: async () => { await window.bestiary.cancelGithubAuth(); set({ progress: null, busy: false }); },
  ensureRepository: async (preferred) => { await guarded(set, async () => { const distribution = await window.bestiary.ensureDistributionRepository(preferred); const settings = await window.bestiary.getSettings(); set({ distribution, settings }); }); },
  publish: async (request) => { await guarded(set, async () => { await window.bestiary.publish(request); set({ releases: await window.bestiary.listReleases(), view: 'release' }); }); },
  promote: async (version) => { await guarded(set, async () => { await window.bestiary.promoteStable(version); set({ releases: await window.bestiary.listReleases() }); }); },
}));

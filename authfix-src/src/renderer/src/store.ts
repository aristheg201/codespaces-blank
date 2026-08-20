import { create } from 'zustand';
import type { AppSettings, DistributionSettings, DistributionStatus, ProgressState, PublishRequest, ReleaseRecord, WorkspaceSnapshot } from '../../shared/types';

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

async function guarded(set: (partial: Partial<State>) => void, action: () => Promise<void>): Promise<void> {
  set({ busy: true, error: null });
  try { await action(); }
  catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
  finally { set({ busy: false }); }
}

export const useManager = create<State>((set, get) => ({
  view: 'client', snapshot: EMPTY, settings: null, distribution: null, releases: [], progress: null, busy: false, error: null,
  setView: (view) => set({ view }),
  setProgress: (progress) => set({ progress }),
  clearError: () => set({ error: null }),
  load: async () => guarded(set, async () => {
    const [snapshot, settings, distribution, releases] = await Promise.all([
      window.bestiary.getSnapshot(), window.bestiary.getSettings(), window.bestiary.getDistributionStatus(), window.bestiary.listReleases(),
    ]);
    set({ snapshot, settings, distribution, releases });
  }),
  chooseWorkspace: async () => guarded(set, async () => {
    const root = await window.bestiary.chooseWorkspace();
    if (!root) return;
    const snapshot = await window.bestiary.getSnapshot();
    set({ snapshot });
  }),
  rescan: async () => guarded(set, async () => set({ snapshot: await window.bestiary.rescanWorkspace() })),
  chooseAndStage: async () => guarded(set, async () => {
    const paths = await window.bestiary.chooseJarFiles();
    if (paths.length) set({ snapshot: await window.bestiary.stageJarFiles(paths) });
  }),
  stagePaths: async (paths) => guarded(set, async () => {
    if (paths.length) set({ snapshot: await window.bestiary.stageJarFiles(paths) });
  }),
  unstage: async (id) => guarded(set, async () => set({ snapshot: await window.bestiary.unstage(id) })),
  clearStaging: async () => guarded(set, async () => set({ snapshot: await window.bestiary.clearStaging() })),
  applyStaging: async () => guarded(set, async () => set({ snapshot: await window.bestiary.applyStaging() })),
  stageRemove: async (filePath) => guarded(set, async () => set({ snapshot: await window.bestiary.stageRemove(filePath) })),
  saveDistribution: async (distributionSettings) => guarded(set, async () => {
    const settings = await window.bestiary.saveDistributionSettings(distributionSettings);
    const distribution = await window.bestiary.getDistributionStatus();
    set({ settings, distribution });
  }),
  connectGithub: async () => guarded(set, async () => {
    const distribution = await window.bestiary.connectGithub();
    set({ distribution, progress: null });
  }),
  cancelGithubAuth: async () => {
    await window.bestiary.cancelGithubAuth();
    set({ progress: null, busy: false });
  },
  ensureRepository: async (preferred) => guarded(set, async () => {
    const distribution = await window.bestiary.ensureDistributionRepository(preferred);
    const settings = await window.bestiary.getSettings();
    set({ distribution, settings });
  }),
  publish: async (request) => guarded(set, async () => {
    await window.bestiary.publish(request);
    const releases = await window.bestiary.listReleases();
    set({ releases, view: 'release' });
  }),
  promote: async (version) => guarded(set, async () => {
    await window.bestiary.promoteStable(version);
    const releases = await window.bestiary.listReleases();
    set({ releases });
  }),
}));

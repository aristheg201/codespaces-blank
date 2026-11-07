import path from 'node:path';
import fs from 'fs-extra';
import type { ClientProfileId, ModMetadata } from '../../shared/ipc';

export interface OwnedFileRecord {
  hash: string;
  size: number;
  mod?: ModMetadata;
}

export interface ManagedOwnershipData {
  version: string;
  profile: ClientProfileId;
  updatedAt: number;
  files: Record<string, OwnedFileRecord>;
}

export function ownershipPath(gameDirectory: string): string {
  return path.join(gameDirectory, '.bestiary', 'managed-files.json');
}

export async function readOwnership(gameDirectory: string): Promise<ManagedOwnershipData | null> {
  try {
    const raw = await fs.readJson(ownershipPath(gameDirectory)) as Partial<ManagedOwnershipData>;
    if (!raw.files || typeof raw.files !== 'object') return null;
    return {
      version: typeof raw.version === 'string' ? raw.version : '',
      profile: raw.profile === 'lite' ? 'lite' : 'full',
      updatedAt: Number.isFinite(raw.updatedAt) ? Number(raw.updatedAt) : 0,
      files: raw.files as Record<string, OwnedFileRecord>,
    };
  } catch {
    return null;
  }
}

export async function writeOwnership(gameDirectory: string, value: ManagedOwnershipData): Promise<void> {
  const target = ownershipPath(gameDirectory);
  await fs.ensureDir(path.dirname(target));
  await fs.writeJson(target, value, { spaces: 2 });
}

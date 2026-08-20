import path from 'node:path';
import fs from 'fs-extra';
import AdmZip from 'adm-zip';
import type { ModSideDetection } from '../../shared/types';

const MAX_CLASS_SAMPLES = 160;

function cleanEnvironment(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
}

function countClientEntrypoints(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const entrypoints = value as Record<string, unknown>;
  return Array.isArray(entrypoints.client) ? entrypoints.client.length : entrypoints.client ? 1 : 0;
}

function countMainEntrypoints(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const entrypoints = value as Record<string, unknown>;
  return Array.isArray(entrypoints.main) ? entrypoints.main.length : entrypoints.main ? 1 : 0;
}

function mixinHints(meta: Record<string, unknown>, zip: AdmZip): { client: number; common: number; reasons: string[] } {
  const declared = Array.isArray(meta.mixins) ? meta.mixins : [];
  let client = 0;
  let common = 0;
  const reasons: string[] = [];
  for (const item of declared) {
    const config = typeof item === 'string' ? item : item && typeof item === 'object' ? String((item as Record<string, unknown>).config ?? '') : '';
    const env = item && typeof item === 'object' ? cleanEnvironment((item as Record<string, unknown>).environment) : undefined;
    if (env === 'client') { client += 2; reasons.push(`mixin ${config || '?'} khai environment=client`); continue; }
    if (env === 'server') { common += 2; reasons.push(`mixin ${config || '?'} khai environment=server`); continue; }
    if (!config) continue;
    const entry = zip.getEntry(config);
    if (!entry) continue;
    try {
      const parsed = JSON.parse(entry.getData().toString('utf8')) as Record<string, unknown>;
      if (Array.isArray(parsed.client) && parsed.client.length) { client += 1; reasons.push(`${config} có client mixins`); }
      if ((Array.isArray(parsed.mixins) && parsed.mixins.length) || (Array.isArray(parsed.server) && parsed.server.length)) common += 1;
    } catch { /* malformed mixin config is not fatal for audit */ }
  }
  return { client, common, reasons };
}

function bytecodeHints(zip: AdmZip): { client: number; server: number; common: number; reasons: string[] } {
  let client = 0;
  let server = 0;
  let common = 0;
  let sampled = 0;
  for (const entry of zip.getEntries()) {
    if (sampled >= MAX_CLASS_SAMPLES) break;
    if (entry.isDirectory || !entry.entryName.endsWith('.class')) continue;
    sampled += 1;
    const data = entry.getData();
    const text = data.toString('latin1');
    if (text.includes('net/fabricmc/api/ClientModInitializer') || text.includes('net/minecraft/client/')) client += 2;
    if (text.includes('net/fabricmc/api/DedicatedServerModInitializer') || text.includes('net/minecraft/server/dedicated/')) server += 2;
    if (text.includes('net/fabricmc/api/ModInitializer')) common += 1;
  }
  const reasons: string[] = [];
  if (client) reasons.push(`bytecode sample có ${client} client hint`);
  if (server) reasons.push(`bytecode sample có ${server} dedicated-server hint`);
  if (common) reasons.push(`bytecode sample có ${common} common initializer hint`);
  return { client, server, common, reasons };
}

export async function detectModSide(jarPath: string): Promise<ModSideDetection> {
  const analyzedAt = Date.now();
  const zip = new AdmZip(jarPath);
  const fabricEntry = zip.getEntry('fabric.mod.json');
  if (!fabricEntry) return { side: 'unknown', confidence: 'low', source: 'unknown', reasons: ['Không có fabric.mod.json'], analyzedAt };

  let meta: Record<string, unknown>;
  try { meta = JSON.parse(fabricEntry.getData().toString('utf8')) as Record<string, unknown>; }
  catch { return { side: 'unknown', confidence: 'low', source: 'unknown', reasons: ['fabric.mod.json không parse được'], analyzedAt }; }

  const environment = cleanEnvironment(meta.environment);
  if (environment === 'client') {
    return { side: 'client', confidence: 'high', source: 'fabric.mod.json', reasons: ['fabric.mod.json: environment=client'], environment, analyzedAt };
  }
  if (environment === 'server') {
    return { side: 'server', confidence: 'high', source: 'fabric.mod.json', reasons: ['fabric.mod.json: environment=server'], environment, analyzedAt };
  }

  const clientEntrypoints = countClientEntrypoints(meta.entrypoints);
  const mainEntrypoints = countMainEntrypoints(meta.entrypoints);
  const mixins = mixinHints(meta, zip);
  const bytecode = bytecodeHints(zip);
  const reasons: string[] = [];
  if (clientEntrypoints) reasons.push(`fabric entrypoints.client=${clientEntrypoints}`);
  if (mainEntrypoints) reasons.push(`fabric entrypoints.main=${mainEntrypoints}`);
  reasons.push(...mixins.reasons, ...bytecode.reasons);

  const clientScore = clientEntrypoints * 4 + mixins.client * 2 + bytecode.client;
  const commonScore = mainEntrypoints * 4 + mixins.common * 2 + bytecode.common;
  const serverScore = bytecode.server;

  if (clientScore >= 4 && commonScore === 0 && serverScore === 0) {
    return { side: 'client', confidence: 'medium', source: clientEntrypoints ? 'entrypoints' : 'mixins', reasons, environment, analyzedAt };
  }
  if (serverScore >= 4 && clientScore === 0 && commonScore === 0) {
    return { side: 'server', confidence: 'medium', source: 'bytecode', reasons, environment, analyzedAt };
  }
  if (environment === '*' || commonScore > 0 || (clientScore > 0 && serverScore > 0)) {
    return { side: 'both', confidence: environment === '*' ? 'high' : 'medium', source: environment === '*' ? 'fabric.mod.json' : mainEntrypoints ? 'entrypoints' : 'bytecode', reasons: environment === '*' ? ['fabric.mod.json: environment=*', ...reasons] : reasons, environment, analyzedAt };
  }

  return { side: 'unknown', confidence: 'low', source: 'unknown', reasons: reasons.length ? reasons : ['Không có side metadata đủ chắc chắn'], environment, analyzedAt };
}

export function effectiveSide(detection: ModSideDetection | undefined, override: 'auto' | 'client' | 'server' | 'both'): 'client' | 'server' | 'both' | 'unknown' {
  return override === 'auto' ? detection?.side ?? 'unknown' : override;
}

export function defaultProfiles(side: 'client' | 'server' | 'both' | 'unknown'): Array<'full' | 'lite' | 'android' | 'server'> {
  if (side === 'client') return ['full', 'lite'];
  if (side === 'server') return ['server'];
  if (side === 'both') return ['full', 'lite', 'server'];
  return [];
}

export async function safeDetectModSide(root: string, relativePath: string): Promise<ModSideDetection> {
  const absolute = path.resolve(root, ...relativePath.split('/'));
  const rel = path.relative(root, absolute);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Mod path vượt khỏi workspace.');
  if (!(await fs.pathExists(absolute))) throw new Error(`Không tìm thấy ${relativePath}`);
  return detectModSide(absolute);
}

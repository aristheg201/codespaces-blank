import path from 'node:path';
import fs from 'fs-extra';
import type { KeybindChange, KeybindEntry, KeybindSnapshot } from '../../shared/ipc';

interface KeybindRule {
  id: string;
  key: string;
  mode: 'default' | 'locked';
  enabled?: boolean;
}

interface KeybindPolicy {
  schema: 1;
  rules: KeybindRule[];
}

const POLICY_PATH = path.join('config', 'bestiary-keybinds.json');
const OPTIONS_FILE = 'options.txt';
const BACKUP_FILE = 'options.txt.bestiary-keybind.bak';

const VANILLA_LABELS: Record<string, string> = {
  'key_key.forward': 'Forward',
  'key_key.back': 'Backward',
  'key_key.left': 'Left',
  'key_key.right': 'Right',
  'key_key.jump': 'Jump',
  'key_key.sneak': 'Sneak',
  'key_key.sprint': 'Sprint',
  'key_key.attack': 'Attack / Destroy',
  'key_key.use': 'Use Item / Place Block',
  'key_key.drop': 'Drop Item',
  'key_key.pickItem': 'Pick Block',
  'key_key.inventory': 'Inventory',
  'key_key.swapOffhand': 'Swap Offhand',
  'key_key.chat': 'Open Chat',
  'key_key.command': 'Open Command',
  'key_key.playerlist': 'Player List',
  'key_key.socialInteractions': 'Social Interactions',
  'key_key.advancements': 'Advancements',
  'key_key.screenshot': 'Screenshot',
  'key_key.togglePerspective': 'Toggle Perspective',
  'key_key.fullscreen': 'Toggle Fullscreen',
  'key_key.smoothCamera': 'Cinematic Camera',
  'key_key.saveToolbarActivator': 'Save Hotbar Activator',
  'key_key.loadToolbarActivator': 'Load Hotbar Activator',
};

function validId(id: string): boolean {
  return /^key_[^\r\n:]{1,240}$/u.test(id);
}

function validValue(value: string): boolean {
  return value === 'key.keyboard.unknown'
    || /^key\.(?:keyboard|mouse)\.[A-Za-z0-9_.-]{1,120}$/u.test(value)
    || /^scancode\.[0-9]{1,6}$/u.test(value);
}

function validRule(value: unknown): value is KeybindRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<KeybindRule>;
  return typeof rule.id === 'string' && validId(rule.id)
    && typeof rule.key === 'string' && rule.key.length > 0 && rule.key.length <= 160 && !/[\r\n]/u.test(rule.key)
    && (rule.mode === 'default' || rule.mode === 'locked');
}

function humanize(value: string): string {
  return value
    .replace(/^key_key\./u, '')
    .replace(/^key\./u, '')
    .replace(/^key_/u, '')
    .replace(/(?:^|[._-])keybind(?:[._-]|$)/giu, ' ')
    .replace(/[._-]+/gu, ' ')
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part.length <= 3 && /^[A-Z0-9]+$/u.test(part)
      ? part
      : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function categoryFor(id: string): string {
  const lower = id.toLowerCase();
  if (lower.includes('cobblemon')) return 'COBBLEMON';
  if (lower.includes('svarcade') || lower.includes('svhub') || lower.includes('arcade')) return 'SVARCADE';
  if (lower.includes('cardworld') || lower.includes('card_world') || lower.includes('svarcade_tcg') || lower.includes('.tcg') || lower.includes('_tcg')) return 'CARD WORLDS';

  const movement = new Set([
    'key_key.forward', 'key_key.back', 'key_key.left', 'key_key.right',
    'key_key.jump', 'key_key.sneak', 'key_key.sprint',
  ]);
  if (movement.has(id)) return 'MOVEMENT';

  const gameplay = new Set([
    'key_key.attack', 'key_key.use', 'key_key.drop', 'key_key.pickItem',
    'key_key.inventory', 'key_key.swapOffhand',
  ]);
  if (gameplay.has(id) || /^key_key\.hotbar\.[1-9]$/u.test(id)) return 'GAMEPLAY';

  if (id.startsWith('key_key.')) return 'INTERFACE';
  return 'MODDED';
}

function buildConflictMap(values: Map<string, string>): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const [id, key] of values) {
    if (key === 'key.keyboard.unknown') continue;
    const group = byKey.get(key) ?? [];
    group.push(id);
    byKey.set(key, group);
  }

  const conflicts = new Map<string, string[]>();
  for (const ids of byKey.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) conflicts.set(id, ids.filter((candidate) => candidate !== id));
  }
  return conflicts;
}

export class KeybindSettingsService {
  public constructor(private readonly gameDirectory: string) {}

  private async lockedBindings(): Promise<Set<string>> {
    const policyFile = path.join(this.gameDirectory, POLICY_PATH);
    if (!(await fs.pathExists(policyFile))) return new Set<string>();
    const raw = await fs.readJson(policyFile).catch(() => null) as Partial<KeybindPolicy> | null;
    const rules = Array.isArray(raw?.rules) ? raw!.rules!.filter(validRule) : [];
    return new Set(rules.filter((rule) => rule.enabled !== false && rule.mode === 'locked').map((rule) => rule.id));
  }

  private async readOptions(): Promise<{ exists: boolean; original: string; newline: '\n' | '\r\n'; lines: string[]; values: Map<string, string> }> {
    const optionsFile = path.join(this.gameDirectory, OPTIONS_FILE);
    const exists = await fs.pathExists(optionsFile);
    const original = exists ? await fs.readFile(optionsFile, 'utf8') : '';
    const newline: '\n' | '\r\n' = original.includes('\r\n') ? '\r\n' : '\n';
    const lines = original.replace(/\r\n/gu, '\n').split('\n');
    const values = new Map<string, string>();

    for (const line of lines) {
      const at = line.indexOf(':');
      if (at <= 0) continue;
      const id = line.slice(0, at);
      if (!validId(id)) continue;
      values.set(id, line.slice(at + 1));
    }

    return { exists, original, newline, lines, values };
  }

  public async snapshot(): Promise<KeybindSnapshot> {
    const parsed = await this.readOptions();
    const locked = await this.lockedBindings();
    const conflicts = buildConflictMap(parsed.values);

    const entries: KeybindEntry[] = [...parsed.values.entries()].map(([id, key]) => ({
      id,
      key,
      label: VANILLA_LABELS[id] ?? (humanize(id) || id),
      category: categoryFor(id),
      locked: locked.has(id),
      conflictIds: conflicts.get(id) ?? [],
    }));

    entries.sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    return { optionsExists: parsed.exists, entries };
  }

  public async save(changes: KeybindChange[]): Promise<KeybindSnapshot> {
    if (!Array.isArray(changes) || changes.length > 512) {
      throw new Error('Danh sách keybind không hợp lệ.');
    }

    const parsed = await this.readOptions();
    if (!parsed.exists) {
      throw new Error('Chưa tìm thấy options.txt. Hãy chạy Minecraft ít nhất một lần trước khi chỉnh keybind.');
    }

    const locked = await this.lockedBindings();
    const requested = new Map<string, string>();

    for (const change of changes) {
      if (!change || typeof change.id !== 'string' || typeof change.key !== 'string' || !validId(change.id) || !validValue(change.key)) {
        throw new Error('Keybind chứa dữ liệu không hợp lệ.');
      }
      if (!parsed.values.has(change.id)) {
        throw new Error(`Keybind ${change.id} không tồn tại trong options.txt.`);
      }
      if (locked.has(change.id)) {
        throw new Error(`Keybind ${change.id} đang bị khóa bởi server policy.`);
      }
      requested.set(change.id, change.key);
    }

    const changed = [...requested.entries()].filter(([id, key]) => parsed.values.get(id) !== key);
    if (!changed.length) return this.snapshot();

    const replacements = new Map(changed);
    const nextLines = parsed.lines.map((line) => {
      const at = line.indexOf(':');
      if (at <= 0) return line;
      const id = line.slice(0, at);
      const replacement = replacements.get(id);
      return replacement === undefined ? line : `${id}:${replacement}`;
    });

    const optionsFile = path.join(this.gameDirectory, OPTIONS_FILE);
    const backupFile = path.join(this.gameDirectory, BACKUP_FILE);
    const tempFile = `${optionsFile}.bestiary-keybind.tmp`;

    await fs.copy(optionsFile, backupFile, { overwrite: true });
    await fs.writeFile(tempFile, nextLines.join(parsed.newline), 'utf8');
    await fs.move(tempFile, optionsFile, { overwrite: true });

    return this.snapshot();
  }
}

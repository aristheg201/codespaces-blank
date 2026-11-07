import path from 'node:path';
import fs from 'fs-extra';

/**
 * Applies Manager keybind policy ONLY to the Official SVFrame instance.
 * Personal modpack instances must never construct or invoke this service.
 */
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
interface KeybindState {
  schema: 1;
  applied: Record<string, { policyValue: string; observedValue: string; mode: 'default' | 'locked' }>;
}
export interface KeybindApplyResult {
  changed: number;
  skipped: number;
  applied: number;
}

const POLICY_PATH = path.join('config', 'bestiary-keybinds.json');
const STATE_PATH = path.join('.bestiary', 'keybind-state.json');
const BACKUP_PATH = path.join('.bestiary', 'options-before-managed-keybinds.bak');

function validId(id: unknown): id is string {
  return typeof id === 'string' && /^key_[^\r\n:]{1,240}$/u.test(id);
}

function validKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= 160 &&
    (key === 'key.keyboard.unknown' ||
      /^key\.(?:keyboard|mouse)\.[A-Za-z0-9_.-]{1,120}$/u.test(key) ||
      /^scancode\.[0-9]{1,6}$/u.test(key));
}

function validRule(raw: unknown): raw is KeybindRule {
  if (!raw || typeof raw !== 'object') return false;
  const rule = raw as Partial<KeybindRule>;
  return validId(rule.id) && validKey(rule.key) &&
    (rule.mode === 'default' || rule.mode === 'locked');
}

function parseOptions(original: string): { lines: string[]; values: Map<string, string>; newline: '\n' | '\r\n' } {
  const newline: '\n' | '\r\n' = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original ? original.replace(/\r\n/gu, '\n').split('\n') : [];
  const values = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const id = line.slice(0, separator);
    if (validId(id)) values.set(id, line.slice(separator + 1));
  }
  return { lines, values, newline };
}

export class KeybindPolicyService {
  public constructor(private readonly gameDirectory: string) {}

  public async apply(): Promise<KeybindApplyResult> {
    const file = path.join(this.gameDirectory, POLICY_PATH);
    if (!(await fs.pathExists(file))) return { changed: 0, skipped: 0, applied: 0 };
    const policy = await fs.readJson(file).catch(() => null) as Partial<KeybindPolicy> | null;
    if (policy?.schema !== 1 || !Array.isArray(policy.rules)) {
      throw new Error('SVFrame keybind policy không hợp lệ. Không được bỏ qua âm thầm.');
    }
    if (policy.rules.length > 1024) throw new Error('SVFrame keybind policy vượt giới hạn an toàn.');

    const active = new Map<string, KeybindRule>();
    for (const raw of policy.rules) {
      if (!validRule(raw) || raw.enabled === false) continue;
      active.set(raw.id, raw);
    }
    if (!active.size) return { changed: 0, skipped: 0, applied: 0 };

    const optionsFile = path.join(this.gameDirectory, 'options.txt');
    const exists = await fs.pathExists(optionsFile);
    const original = exists ? await fs.readFile(optionsFile, 'utf8') : '';
    const parsed = parseOptions(original);
    const stateFile = path.join(this.gameDirectory, STATE_PATH);
    const loaded = await fs.readJson(stateFile).catch(() => null) as Partial<KeybindState> | null;
    const applied: KeybindState['applied'] = loaded?.schema === 1 &&
      loaded.applied && typeof loaded.applied === 'object' && !Array.isArray(loaded.applied)
        ? loaded.applied : {};

    const replacements = new Map<string, string>();
    let changed = 0;
    let skipped = 0;

    for (const rule of active.values()) {
      const current = parsed.values.get(rule.id);
      const previous = applied[rule.id];

      // DEFAULT means "distribute this server default on first encounter".
      // Once applied, an explicit player rebind is preserved. A later Manager
      // policy update migrates only values still matching what WE last wrote.
      // LOCKED is reasserted at every Official launch.
      const shouldApply = rule.mode === 'locked' ||
        current === undefined || previous === undefined ||
        current === previous.observedValue;
      if (!shouldApply) {
        skipped += 1;
        continue;
      }
      if (current !== rule.key) {
        replacements.set(rule.id, rule.key);
        changed += 1;
      }
      applied[rule.id] = { policyValue: rule.key, observedValue: rule.key, mode: rule.mode };
    }

    if (changed) {
      const seen = new Set<string>();
      const lines = parsed.lines.map((line) => {
        const at = line.indexOf(':');
        const id = at > 0 ? line.slice(0, at) : '';
        const replacement = replacements.get(id);
        if (replacement === undefined) return line;
        seen.add(id);
        return id + ':' + replacement;
      });
      for (const [id, value] of replacements) {
        if (!seen.has(id)) lines.push(id + ':' + value);
      }

      // Never overwrite unrelated Minecraft graphics, audio, accessibility,
      // resource pack or personal options values.
      await fs.ensureDir(path.dirname(stateFile));
      const backupFile = path.join(this.gameDirectory, BACKUP_PATH);
      if (exists && !(await fs.pathExists(backupFile))) {
        await fs.copyFile(optionsFile, backupFile);
      }
      const temporary = optionsFile + '.bestiary-keybind-' + process.pid + '.tmp';
      try {
        await fs.writeFile(temporary, lines.join(parsed.newline), 'utf8');
        await fs.move(temporary, optionsFile, { overwrite: true });
      } finally {
        await fs.remove(temporary).catch(() => undefined);
      }
    }
    await fs.ensureDir(path.dirname(stateFile));
    await fs.writeJson(stateFile, { schema: 1, applied } satisfies KeybindState, { spaces: 2 });
    return { changed, skipped, applied: active.size - skipped };
  }
}

import path from 'node:path';
import fs from 'fs-extra';

interface KeybindRule {
  id: string;
  key: string;
  mode: 'default' | 'locked';
  enabled?: boolean;
}
interface KeybindPolicy { schema: 1; rules: KeybindRule[] }
interface KeybindState {
  schema: 1;
  applied: Record<string, { policyValue: string; observedValue: string; mode: 'default' | 'locked' }>;
}

const POLICY_PATH = path.join('config', 'bestiary-keybinds.json');
const STATE_PATH = path.join('.bestiary', 'keybind-state.json');
const OPTIONS_NAME = 'options.txt';
// SVFrame Official is pinned to Minecraft 1.21.1 (DataVersion 3955).
// Without the version header Minecraft may discard an otherwise valid first-run options file.
const OFFICIAL_OPTIONS_VERSION = '3955';

function validRule(value: unknown): value is KeybindRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<KeybindRule>;
  return typeof rule.id === 'string'
    && /^key_[^\r\n:]{1,240}$/u.test(rule.id)
    && typeof rule.key === 'string'
    && (rule.key === 'key.keyboard.unknown'
      || /^key\.(?:keyboard|mouse)\.[A-Za-z0-9_.-]{1,120}$/u.test(rule.key)
      || /^scancode\.[0-9]{1,6}$/u.test(rule.key))
    && (rule.mode === 'default' || rule.mode === 'locked');
}

function parseOptions(text: string): { lines: string[]; values: Map<string, string>; newline: string } {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text ? text.replace(/\r\n/gu, '\n').split('\n') : [];
  const values = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const id = line.slice(0, separator);
    if (id.startsWith('key_')) values.set(id, line.slice(separator + 1));
  }
  return { lines, values, newline };
}

/**
 * Only for the SVFrame Official gameDirectory. Never construct this service for a
 * personal ModpackManager instance or copy its policy/state into personal packs.
 */
export class KeybindPolicyService {
  public constructor(private readonly gameDirectory: string) {}

  public async apply(): Promise<{ changed: number; skipped: number }> {
    const policyFile = path.join(this.gameDirectory, POLICY_PATH);
    if (!(await fs.pathExists(policyFile))) return { changed: 0, skipped: 0 };
    let raw: KeybindPolicy;
    try {
      raw = await fs.readJson(policyFile) as KeybindPolicy;
    } catch (error) {
      throw new Error('Không thể đọc keybind policy SVFrame Official: ' + String(error));
    }
    if (raw.schema !== 1 || !Array.isArray(raw.rules)) {
      throw new Error('Keybind policy SVFrame Official không hợp lệ (schema/rules).');
    }
    const rules = new Map<string, KeybindRule>();
    for (const rule of raw.rules) {
      if (!validRule(rule)) throw new Error('Keybind policy SVFrame Official chứa rule không hợp lệ.');
      if (rule.enabled !== false) rules.set(rule.id, rule);
    }
    if (!rules.size) return { changed: 0, skipped: 0 };

    const optionsFile = path.join(this.gameDirectory, OPTIONS_NAME);
    const exists = await fs.pathExists(optionsFile);
    const original = exists ? await fs.readFile(optionsFile, 'utf8') : '';
    const parsed = parseOptions(original);
    if (!parsed.lines.some((line) => /^version:\d+$/u.test(line)) && !original.trim()) {
      parsed.lines.unshift('version:' + OFFICIAL_OPTIONS_VERSION);
    }

    const stateFile = path.join(this.gameDirectory, STATE_PATH);
    const prior = await fs.readJson(stateFile).catch(() => null) as Partial<KeybindState> | null;
    const applied = prior?.schema === 1 && prior.applied && typeof prior.applied === 'object'
      ? prior.applied : {};
    const nextApplied: KeybindState['applied'] = {};
    const desired = new Map<string, string>();
    let changed = 0;
    let skipped = 0;

    for (const rule of rules.values()) {
      const current = parsed.values.get(rule.id);
      const previous = applied[rule.id];
      // DEFAULT is distributed on first encounter even when Minecraft already has a
      // vanilla default binding. Subsequent launches preserve player edits. LOCKED
      // is reasserted before EVERY official launch, never in personal modpacks.
      const shouldApply = rule.mode === 'locked'
        || current === undefined
        || previous === undefined
        || current === previous.observedValue;
      if (!shouldApply) {
        skipped += 1;
        nextApplied[rule.id] = previous;
        continue;
      }
      if (current !== rule.key) changed += 1;
      desired.set(rule.id, rule.key);
      nextApplied[rule.id] = {
        policyValue: rule.key,
        observedValue: rule.key,
        mode: rule.mode,
      };
    }

    const emitted = new Set<string>();
    const lines: string[] = [];
    for (const line of parsed.lines) {
      const separator = line.indexOf(':');
      const id = separator > 0 ? line.slice(0, separator) : '';
      const replacement = desired.get(id);
      if (replacement === undefined) {
        lines.push(line);
      } else if (!emitted.has(id)) {
        lines.push(id + ':' + replacement);
        emitted.add(id);
      }
    }
    for (const [id, value] of desired) {
      if (!emitted.has(id)) lines.push(id + ':' + value);
    }

    const nextText = lines.join(parsed.newline) + (original.endsWith(parsed.newline) ? '' : parsed.newline);
    if (nextText !== original) {
      await fs.ensureDir(path.dirname(optionsFile));
      if (exists) await fs.copy(optionsFile, optionsFile + '.bestiary-policy.bak', { overwrite: true });
      const temp = optionsFile + '.' + process.pid + '.bestiary-policy.tmp';
      await fs.writeFile(temp, nextText, 'utf8');
      await fs.move(temp, optionsFile, { overwrite: true });
    }

    await fs.ensureDir(path.dirname(stateFile));
    const tmp = stateFile + '.' + process.pid + '.tmp';
    await fs.writeJson(tmp, { schema: 1, applied: nextApplied } satisfies KeybindState, { spaces: 2 });
    await fs.move(tmp, stateFile, { overwrite: true });
    return { changed, skipped };
  }
}

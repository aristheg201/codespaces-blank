import path from 'node:path';
import fs from 'fs-extra';

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

const POLICY_PATH = path.join('config', 'bestiary-keybinds.json');
const STATE_PATH = path.join('.bestiary', 'keybind-state.json');

function parseOptions(text: string): { lines: string[]; values: Map<string, string> } {
  const lines = text.replace(/\r\n/gu, '\n').split('\n');
  const values = new Map<string, string>();
  for (const line of lines) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const id = line.slice(0, at);
    if (id.startsWith('key_')) values.set(id, line.slice(at + 1));
  }
  return { lines, values };
}
function validRule(value: unknown): value is KeybindRule {
  if (!value || typeof value !== 'object') return false;
  const rule = value as Partial<KeybindRule>;
  return typeof rule.id === 'string' && /^key_[^\r\n:]{1,240}$/u.test(rule.id)
    && typeof rule.key === 'string' && rule.key.length > 0 && rule.key.length <= 160 && !/[\r\n]/u.test(rule.key)
    && (rule.mode === 'default' || rule.mode === 'locked');
}

export class KeybindPolicyService {
  public constructor(private readonly gameDirectory: string) {}

  public async apply(): Promise<{ changed: number; skipped: number }> {
    const policyFile = path.join(this.gameDirectory, POLICY_PATH);
    if (!(await fs.pathExists(policyFile))) return { changed: 0, skipped: 0 };
    const raw = await fs.readJson(policyFile).catch(() => null) as Partial<KeybindPolicy> | null;
    const rules = Array.isArray(raw?.rules) ? raw!.rules!.filter(validRule).filter((rule) => rule.enabled !== false) : [];
    if (!rules.length) return { changed: 0, skipped: 0 };

    const optionsFile = path.join(this.gameDirectory, 'options.txt');
    const original = await fs.readFile(optionsFile, 'utf8').catch(() => '');
    const parsed = parseOptions(original);
    const stateFile = path.join(this.gameDirectory, STATE_PATH);
    const prior = await fs.readJson(stateFile).catch(() => ({ schema: 1, applied: {} })) as Partial<KeybindState>;
    const applied = prior.schema === 1 && prior.applied && typeof prior.applied === 'object' ? prior.applied : {};
    let changed = 0;
    let skipped = 0;

    for (const rule of rules) {
      const current = parsed.values.get(rule.id);
      const previous = applied[rule.id];
      const shouldApply = rule.mode === 'locked'
        || current === undefined
        || (previous !== undefined && current === previous.observedValue);
      if (!shouldApply) { skipped += 1; continue; }
      if (current !== rule.key) changed += 1;
      parsed.values.set(rule.id, rule.key);
      applied[rule.id] = { policyValue: rule.key, observedValue: rule.key, mode: rule.mode };
    }

    const emitted = new Set<string>();
    const nextLines = parsed.lines.map((line) => {
      const at = line.indexOf(':');
      if (at <= 0) return line;
      const id = line.slice(0, at);
      if (!parsed.values.has(id)) return line;
      emitted.add(id);
      return `${id}:${parsed.values.get(id)}`;
    });
    for (const [id, value] of parsed.values) if (!emitted.has(id)) nextLines.push(`${id}:${value}`);

    if (changed > 0 || !await fs.pathExists(optionsFile)) {
      const tmp = `${optionsFile}.bestiary.tmp`;
      await fs.writeFile(tmp, nextLines.join('\n'), 'utf8');
      await fs.move(tmp, optionsFile, { overwrite: true });
    }
    await fs.ensureDir(path.dirname(stateFile));
    await fs.writeJson(stateFile, { schema: 1, applied } satisfies KeybindState, { spaces: 2 });
    return { changed, skipped };
  }
}

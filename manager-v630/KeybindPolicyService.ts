import path from 'node:path';
import fs from 'fs-extra';

export type KeybindMode = 'default' | 'locked';
export interface KeybindRule {
  id: string;
  label: string;
  key: string;
  mode: KeybindMode;
  enabled: boolean;
}
export interface KeybindPolicy {
  schema: 1;
  rules: KeybindRule[];
  updatedAt: number;
}

const EMPTY: KeybindPolicy = { schema: 1, rules: [], updatedAt: 0 };

function cleanRule(value: unknown): KeybindRule | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<KeybindRule>;
  if (typeof raw.id !== 'string' || !/^key_[^\r\n:]{1,240}$/u.test(raw.id)) return null;
  if (typeof raw.key !== 'string' || raw.key.length < 1 || raw.key.length > 160 || /[\r\n]/u.test(raw.key)) return null;
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 160) : raw.id;
  return { id: raw.id, label, key: raw.key, mode: raw.mode === 'locked' ? 'locked' : 'default', enabled: raw.enabled !== false };
}

function defaultLabel(id: string): string {
  return id.replace(/^key_/u, '').replace(/[._]/gu, ' ').trim() || id;
}

function sameRules(a: KeybindRule[], b: KeybindRule[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (x.id !== y.id || x.label !== y.label || x.key !== y.key || x.mode !== y.mode || x.enabled !== y.enabled) return false;
  }
  return true;
}

export class KeybindPolicyService {
  public async load(root: string | null): Promise<KeybindPolicy> {
    if (!root) return { ...EMPTY, rules: [] };
    const current = await this.read(path.join(root, 'config', 'bestiary-keybinds.json'));
    return this.scanOptions(root, current, false);
  }

  public async save(root: string | null, policy: KeybindPolicy): Promise<KeybindPolicy> {
    if (!root) throw new Error('Chưa chọn workspace.');
    const seen = new Set<string>();
    const rules: KeybindRule[] = [];
    for (const item of Array.isArray(policy.rules) ? policy.rules : []) {
      const rule = cleanRule(item);
      if (!rule || seen.has(rule.id)) continue;
      seen.add(rule.id);
      rules.push(rule);
    }
    rules.sort((a, b) => a.id.localeCompare(b.id, 'en'));
    const next: KeybindPolicy = { schema: 1, rules, updatedAt: Date.now() };
    await this.write(root, next);
    return next;
  }

  public async importOptions(root: string | null): Promise<KeybindPolicy> {
    if (!root) throw new Error('Chưa chọn workspace.');
    const current = await this.read(path.join(root, 'config', 'bestiary-keybinds.json'));
    return this.scanOptions(root, current, true);
  }

  public conflicts(policy: KeybindPolicy): Array<{ key: string; ids: string[] }> {
    const map = new Map<string, string[]>();
    for (const rule of policy.rules.filter((item) => item.enabled)) {
      if (!map.has(rule.key)) map.set(rule.key, []);
      map.get(rule.key)!.push(rule.id);
    }
    return [...map.entries()].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
  }

  private async scanOptions(root: string, current: KeybindPolicy, forceWrite: boolean): Promise<KeybindPolicy> {
    const options = path.join(root, 'options.txt');
    if (!(await fs.pathExists(options))) {
      if (forceWrite) throw new Error('Workspace chưa có options.txt để đọc keybind.');
      return current;
    }

    const text = await fs.readFile(options, 'utf8');
    const previous = new Map(current.rules.map((rule) => [rule.id, rule]));
    const discovered = new Map<string, string>();

    for (const line of text.replace(/\r\n/gu, '\n').split('\n')) {
      const at = line.indexOf(':');
      if (at <= 0) continue;
      const id = line.slice(0, at).trim();
      if (!id.startsWith('key_') || !/^key_[^\r\n:]{1,240}$/u.test(id)) continue;
      const key = line.slice(at + 1).trim();
      if (!key || key.length > 160 || /[\r\n]/u.test(key)) continue;
      discovered.set(id, key);
    }

    const rules: KeybindRule[] = [...discovered.entries()].map(([id, optionsKey]) => {
      const old = previous.get(id);
      return {
        id,
        label: old?.label || defaultLabel(id),
        // DEFAULT mirrors the real options.txt value. LOCKED keeps the admin-selected target.
        key: old?.mode === 'locked' ? old.key : optionsKey,
        mode: old?.mode || 'default',
        enabled: old?.enabled !== false,
      };
    });
    rules.sort((a, b) => a.id.localeCompare(b.id, 'en'));

    const next: KeybindPolicy = { schema: 1, rules, updatedAt: current.updatedAt };
    if (!forceWrite && sameRules(current.rules, rules)) return next;
    next.updatedAt = Date.now();
    await this.write(root, next);
    return next;
  }

  private async write(root: string, policy: KeybindPolicy): Promise<void> {
    const target = path.join(root, 'config', 'bestiary-keybinds.json');
    await fs.ensureDir(path.dirname(target));
    const tmp = `${target}.tmp`;
    await fs.writeJson(tmp, policy, { spaces: 2 });
    await fs.move(tmp, target, { overwrite: true });
  }

  private async read(file: string): Promise<KeybindPolicy> {
    try {
      const raw = await fs.readJson(file) as Partial<KeybindPolicy>;
      const rules = (Array.isArray(raw.rules) ? raw.rules : []).map(cleanRule).filter((rule): rule is KeybindRule => Boolean(rule));
      rules.sort((a, b) => a.id.localeCompare(b.id, 'en'));
      return { schema: 1, rules, updatedAt: Number(raw.updatedAt || 0) };
    } catch { return { ...EMPTY, rules: [] }; }
  }
}

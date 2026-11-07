from pathlib import Path

p = Path('source/src/main/core/SyncEngine.ts')
s = p.read_text(encoding='utf-8')
old = "      const selectedFiles = manifest.files.filter((entry) => !entry.profiles?.length || entry.profiles.includes(this.profile));"
new = """      const selectedFiles = manifest.files.filter((entry) => {\n        if (entry.profiles?.length) return entry.profiles.includes(this.profile);\n        // Legacy manifests did not carry per-file profiles. Never let an untagged mod\n        // silently leak into Lite: untagged mods are Full-only, while shared config/\n        // resource packs remain available to both profiles for backwards compatibility.\n        const isModJar = /^mods\\/.+\\.jar$/iu.test(entry.path);\n        return !isModJar || this.profile === 'full';\n      });"""
if old not in s:
    raise SystemExit('SyncEngine profile filter marker not found')
s = s.replace(old, new)
p.write_text(s, encoding='utf-8')
print('Launcher profile filtering hardened: untagged mod JARs are Full-only.')

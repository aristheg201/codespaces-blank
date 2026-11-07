from pathlib import Path

p = Path('source/src/main/core/SyncEngine.ts')
s = p.read_text(encoding='utf-8')
s = s.replace("type ClientProfileId = 'full' | 'lite';", "type ClientProfileId = 'full' | 'lite';\ntype ManifestProfileId = ClientProfileId | 'android';")
s = s.replace('  profiles?: ClientProfileId[];', '  profiles?: ManifestProfileId[];')
old = """      const profiles = Array.isArray(entry.profiles)\n        ? [...new Set(entry.profiles.filter((profile): profile is ClientProfileId => profile === 'full' || profile === 'lite'))]\n        : undefined;"""
new = """      const profiles = Array.isArray(entry.profiles)\n        ? [...new Set(entry.profiles.filter((profile): profile is ManifestProfileId => profile === 'full' || profile === 'lite' || profile === 'android'))]\n        : undefined;"""
if old not in s:
    raise SystemExit('Manifest profile parser marker missing')
s = s.replace(old, new)
p.write_text(s, encoding='utf-8')
print('Launcher preserves android-only manifest entries so desktop profiles correctly exclude them.')

from pathlib import Path
import base64
import re
import shutil

root = Path('bestiary-build')
primary = sorted(
    [p for p in root.glob('logo5-*') if re.fullmatch(r'logo5-\d{2}', p.name)],
    key=lambda p: p.name,
)
if not primary:
    raise SystemExit('No canonical logo5-NN chunks found')

# The repository also contains split aliases such as logo5-00a/logo5-00b.
# patch_bestiary_android_v100.py intentionally globs logo5-* for compatibility,
# so hide the split aliases in the ephemeral CI workspace to avoid duplicating
# base64 data. Repository files are not modified by this build step.
backup = Path('android-build/.logo-split-aliases')
backup.mkdir(parents=True, exist_ok=True)
for p in root.glob('logo5-*'):
    if p not in primary:
        shutil.move(str(p), str(backup / p.name))

encoded = ''.join(p.read_text(encoding='utf-8').strip() for p in primary)
try:
    raw = base64.b64decode(encoded, validate=True)
except Exception as exc:
    raise SystemExit(f'Canonical Bestiary logo base64 is invalid: {exc}')
if not raw.startswith(b'\x89PNG\r\n\x1a\n'):
    raise SystemExit('Canonical Bestiary logo is not PNG')
print(f'Bestiary logo verified from {len(primary)} canonical chunks ({len(raw)} bytes)')

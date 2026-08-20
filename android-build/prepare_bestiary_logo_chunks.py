from pathlib import Path
import re

root = Path('bestiary-build')
canonical = {f'logo5-{i:02d}' for i in range(5)}
seen = {p.name for p in root.glob('logo5-*') if re.fullmatch(r'logo5-\d{2}', p.name)}
if seen != canonical:
    raise SystemExit(f'Canonical logo chunks mismatch: {sorted(seen)}')

# Some historical builds keep a/b mirrors of the same chunks for upload-size reasons.
# The Android branding patch expects one canonical stream, so remove only those mirrors
# in the disposable CI checkout. Source files in git are untouched.
for path in root.glob('logo5-*'):
    if re.fullmatch(r'logo5-\d{2}[a-z]+', path.name):
        path.unlink()

print('Canonical Bestiary logo chunks prepared')

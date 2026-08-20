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

# Each canonical logo5-NN file is an independently base64-encoded binary chunk.
# Decode each file first, then concatenate the PNG bytes. Concatenating the text
# would put '=' padding in the middle of a base64 stream and corrupt the asset.
parts = []
for p in primary:
    encoded = ''.join(p.read_text(encoding='utf-8').split())
    try:
        parts.append(base64.b64decode(encoded, validate=True))
    except Exception as exc:
        raise SystemExit(f'Bestiary logo chunk {p.name} is invalid base64: {exc}')

raw = b''.join(parts)
if not raw.startswith(b'\x89PNG\r\n\x1a\n'):
    raise SystemExit('Canonical Bestiary logo is not PNG')
# PNG must end with an IEND chunk. This catches incomplete/reordered chunk sets.
if b'IEND' not in raw[-32:]:
    raise SystemExit('Canonical Bestiary logo is incomplete: PNG IEND missing')

# patch_bestiary_android_v100.py consumes a generic logo5-* base64 stream. Normalize
# the ephemeral CI workspace to one canonical encoded file so that patch remains
# independent from the historical repository chunk layout.
backup = Path('android-build/.logo-source-chunks')
backup.mkdir(parents=True, exist_ok=True)
for p in list(root.glob('logo5-*')):
    shutil.move(str(p), str(backup / p.name))
(root / 'logo5-00').write_text(base64.b64encode(raw).decode('ascii'), encoding='ascii')

print(f'Bestiary logo normalized from {len(primary)} canonical chunks ({len(raw)} bytes)')

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

# Historical asset storage has two representations for some numbered chunks:
#   logo5-NN       full textual base64 block
#   logo5-NNa/b    the same block split into two textual halves
# Some full files contain a historical boundary artifact, so whenever both split
# aliases exist they are authoritative. Join a+b as TEXT, decode that numbered
# block, then concatenate the decoded BINARY blocks in NN order.
parts = []
used = []
for p in primary:
    prefix = p.name
    a = root / f'{prefix}a'
    b = root / f'{prefix}b'
    if a.is_file() and b.is_file():
        encoded = ''.join(a.read_text(encoding='utf-8').split()) + ''.join(b.read_text(encoding='utf-8').split())
        source = f'{a.name}+{b.name}'
    else:
        encoded = ''.join(p.read_text(encoding='utf-8').split())
        source = p.name
    try:
        parts.append(base64.b64decode(encoded, validate=True))
    except Exception as exc:
        raise SystemExit(f'Bestiary logo block {source} is invalid base64: {exc}')
    used.append(source)

raw = b''.join(parts)
if not raw.startswith(b'\x89PNG\r\n\x1a\n'):
    raise SystemExit('Canonical Bestiary logo is not PNG')
if b'IEND' not in raw[-32:]:
    raise SystemExit('Canonical Bestiary logo is incomplete: PNG IEND missing')

# Normalize the ephemeral CI workspace to exactly one valid base64 file because
# patch_bestiary_android_v100.py intentionally knows nothing about this old chunk layout.
backup = Path('android-build/.logo-source-chunks')
backup.mkdir(parents=True, exist_ok=True)
for p in list(root.glob('logo5-*')):
    shutil.move(str(p), str(backup / p.name))
(root / 'logo5-00').write_text(base64.b64encode(raw).decode('ascii'), encoding='ascii')

print(f'Bestiary logo normalized from {len(parts)} numbered blocks ({len(raw)} bytes): {", ".join(used)}')

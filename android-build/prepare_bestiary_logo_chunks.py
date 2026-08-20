from pathlib import Path
import base64
import re

root = Path('bestiary-build')
canonical_names = [f'logo5-{i:02d}' for i in range(5)]
canonical = [root / name for name in canonical_names]
if not all(path.is_file() for path in canonical):
    raise SystemExit('Canonical Bestiary logo chunks are incomplete')

# Historical source stores each canonical segment as its own padded base64 payload.
# Decode the segments independently, concatenate their bytes, then encode one clean
# stream for the Android branding patch. The a/b files are mirrors and are ignored.
parts = []
for path in canonical:
    payload = ''.join(path.read_text(encoding='utf-8').split())
    try:
        parts.append(base64.b64decode(payload, validate=True))
    except Exception as exc:
        raise SystemExit(f'Invalid logo chunk {path.name}: {exc}')

rebuilt = b''.join(parts)
if not rebuilt.startswith(b'\x89PNG\r\n\x1a\n'):
    raise SystemExit('Reconstructed Bestiary logo is not PNG')

# Keep a single canonical stream in the disposable CI checkout so the next patch
# can consume it without special knowledge of the historical split format.
for path in root.glob('logo5-*'):
    path.unlink()
(root / 'logo5-00').write_text(base64.b64encode(rebuilt).decode('ascii'), encoding='utf-8')

print(f'Bestiary logo reconstructed: {len(rebuilt)} bytes')

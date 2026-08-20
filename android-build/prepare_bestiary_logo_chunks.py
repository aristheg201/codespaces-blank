from pathlib import Path
import base64
import re

root = Path('bestiary-build')

# The reliable source is the historical 4k split stream: logo5-00a, 00b,
# logo5-01a, 01b, ... . The unsuffixed 8k convenience files contain boundary
# artifacts in some revisions, so do not use them as authoritative input.
split_chunks = [
    path for path in root.glob('logo5-*')
    if re.fullmatch(r'logo5-\d{2}[a-z]+', path.name)
]
split_chunks.sort(key=lambda p: p.name)
if not split_chunks:
    raise SystemExit('Split Bestiary logo chunks are missing')

# Require a contiguous pair for every numbered segment we encounter.
by_number = {}
for path in split_chunks:
    match = re.fullmatch(r'logo5-(\d{2})([a-z]+)', path.name)
    by_number.setdefault(match.group(1), []).append(match.group(2))
for number, suffixes in sorted(by_number.items()):
    if sorted(suffixes) != ['a', 'b']:
        raise SystemExit(f'Incomplete Bestiary logo split {number}: {sorted(suffixes)}')

payload = ''.join(''.join(path.read_text(encoding='utf-8').split()) for path in split_chunks)
try:
    rebuilt = base64.b64decode(payload, validate=True)
except Exception as exc:
    raise SystemExit(f'Bestiary logo split stream is invalid: {exc}')
if not rebuilt.startswith(b'\x89PNG\r\n\x1a\n'):
    raise SystemExit('Reconstructed Bestiary logo is not PNG')

# Normalize to one base64 stream in this disposable CI checkout. The main
# Android patch then consumes it without depending on the historical storage format.
for path in root.glob('logo5-*'):
    path.unlink()
(root / 'logo5-00').write_text(base64.b64encode(rebuilt).decode('ascii'), encoding='utf-8')

print(f'Bestiary logo reconstructed from {len(split_chunks)} split chunks: {len(rebuilt)} bytes')

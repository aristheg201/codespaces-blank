from pathlib import Path
root = Path('source')
for relative, old, new in [
    ('src/renderer/src/App.tsx', "currentVersion: '5.5.1'", "currentVersion: '5.6.0-alpha.1'"),
    ('src/renderer/src/components/Home.tsx', "5.5.1", "5.6.0-alpha.1"),
]:
    file = root / relative
    raw = file.read_text(encoding='utf8')
    if raw.count(old) < 1:
        raise SystemExit('Missing v560 version marker in ' + relative)
    file.write_text(raw.replace(old, new), encoding='utf8')
for relative in ('src/main/core/AccountService.ts','src/main/core/RemoteService.ts',
                 'src/main/core/LoaderCatalog.ts'):
    file = root / relative
    raw = file.read_text(encoding='utf8')
    file.write_text(raw.replace('BestiaryLauncher/5.5.1', 'BestiaryLauncher/5.6.0-alpha.1'), encoding='utf8')
print('V560 development metadata applied; production 5.5.1 remains unchanged.')

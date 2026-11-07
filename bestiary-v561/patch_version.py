from pathlib import Path
root=Path('source')
for relative in ('src/renderer/src/App.tsx','src/renderer/src/components/Home.tsx'):
    p=root/relative
    text=p.read_text(encoding='utf8')
    assert '5.6.0-alpha.1' in text, 'Expected v560 UI version marker: '+relative
    p.write_text(text.replace('5.6.0-alpha.1','5.6.1-alpha.1'),encoding='utf8')
print('QA PASS: v5.6.1-alpha.1 metadata; 5.5.1 stable updater unchanged')

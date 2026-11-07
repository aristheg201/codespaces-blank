from pathlib import Path
p=Path('source/src/renderer/src/components/Home.tsx')
s=p.read_text(encoding='utf-8')
s=s.replace('5.1.4','5.2.0').replace('THƯ VIỆN CLIENT','CONTENT / MODS')
p.write_text(s,encoding='utf-8')

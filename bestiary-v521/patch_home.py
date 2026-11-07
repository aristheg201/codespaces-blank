from pathlib import Path

home = Path('source/src/renderer/src/components/Home.tsx')
css = Path('source/src/renderer/src/components/Home.css')
app = Path('source/src/renderer/src/App.tsx')

s = home.read_text(encoding='utf-8')
s = s.replace('5.1.4', '5.2.1').replace('5.2.0', '5.2.1')
anchor = '        <div className="bestiary-actions">'
if anchor not in s:
    raise SystemExit('Home actions anchor missing')
manager = '''        <button className="bestiary-mod-manager" onClick={onLibrary}>
          <span className="mod-manager-icon">▦</span>
          <span className="mod-manager-copy"><strong>QUẢN LÝ MOD</strong><small>Mod · Resource Pack · Shader · nội dung cá nhân</small></span>
          <span className="mod-manager-cta">MỞ QUẢN LÝ →</span>
        </button>

'''
s = s.replace(anchor, manager + anchor, 1)
s = s.replace('        <button className="bestiary-library-link" onClick={onLibrary}>CONTENT / MODS</button>\n', '')
s = s.replace('        <button className="bestiary-library-link" onClick={onLibrary}>THƯ VIỆN CLIENT</button>\n', '')
home.write_text(s, encoding='utf-8')

styles = css.read_text(encoding='utf-8')
styles += '''

/* Launcher 5.2.1: make mod management impossible to miss. */
.bestiary-mod-manager {
  width: 100%;
  min-height: 74px;
  margin-top: 14px;
  padding: 12px 16px;
  border: 1px solid rgba(255, 112, 64, .58);
  border-radius: 15px;
  color: #f7f4f2;
  background: linear-gradient(135deg, rgba(88, 29, 17, .92), rgba(42, 24, 20, .96) 48%, rgba(28, 28, 29, .98));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05), 0 10px 28px rgba(237, 73, 35, .16);
  display: grid;
  grid-template-columns: 46px minmax(0, 1fr) auto;
  align-items: center;
  gap: 13px;
  text-align: left;
  transition: border-color .16s ease, transform .16s ease, filter .16s ease;
}
.bestiary-mod-manager:hover {
  border-color: rgba(255, 132, 82, .92);
  filter: brightness(1.08);
  transform: translateY(-1px);
}
.mod-manager-icon {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  color: #fff2e9;
  background: linear-gradient(135deg, #e94a2c, #ff7844);
  box-shadow: 0 7px 18px rgba(239, 76, 39, .28);
  font-size: 22px;
  font-weight: 950;
}
.mod-manager-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.mod-manager-copy strong {
  font-size: 13px;
  font-weight: 950;
  letter-spacing: .035em;
}
.mod-manager-copy small {
  color: #b9afa9;
  font-size: 9px;
  font-weight: 750;
}
.mod-manager-cta {
  color: #ff8c61;
  font-size: 9px;
  font-weight: 950;
  letter-spacing: .08em;
  white-space: nowrap;
}

@media (max-width: 760px) {
  .bestiary-mod-manager { grid-template-columns: 42px minmax(0, 1fr); }
  .mod-manager-cta { display: none; }
}
'''
css.write_text(styles, encoding='utf-8')

app_text = app.read_text(encoding='utf-8').replace("currentVersion: '5.2.0'", "currentVersion: '5.2.1'")
app.write_text(app_text, encoding='utf-8')

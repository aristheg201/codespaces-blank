from pathlib import Path
import re

root = Path('source')

def req(ok, msg):
    if not ok:
        raise SystemExit(msg)

# Public wording: local/offline identity is a server-local profile, not a premium-auth bypass.
p = root / 'src/renderer/src/components/AccountScreen.tsx'
s = p.read_text(encoding='utf-8')
replacements = {
    "<em>{state.mode === 'microsoft' ? 'MICROSOFT · ONLINE' : 'OFFLINE / CRACK'}</em>": "<em>{state.mode === 'microsoft' ? 'MICROSOFT · ONLINE' : 'LOCAL / OFFLINE'}</em>",
    '<div className="login-icon">◌</div><div className="login-tag">OFFLINE / CRACK</div>': '<div className="login-icon">◌</div><div className="login-tag">LOCAL / OFFLINE</div>',
    '<p>Dùng UUID offline ổn định. Phù hợp tài khoản crack và hệ EasyAuth hiện tại của server.</p>': '<p>Dùng danh tính local riêng của server với UUID offline ổn định. Chế độ này tách biệt khỏi Microsoft và Java Edition Game Service APIs, không giả lập entitlement hoặc profile chính chủ.</p>',
    "{state.mode === 'offline' ? 'ĐANG SỬ DỤNG' : 'DÙNG TÀI KHOẢN OFFLINE'}": "{state.mode === 'offline' ? 'ĐANG SỬ DỤNG' : 'DÙNG PROFILE LOCAL'}",
    "'Skin crack được lưu local và Bestiary Skin Bridge áp dụng khi bạn vào server.'": "'Skin local/offline được lưu local và Bestiary Skin Bridge áp dụng khi bạn vào server.'",
}
for old, new in replacements.items():
    req(old in s, f'AccountScreen wording marker missing: {old[:48]}')
    s = s.replace(old, new, 1)
req('CRACK' not in s.upper(), 'Legacy CRACK wording remains in AccountScreen')
p.write_text(s, encoding='utf-8')

# Local skin messaging must describe the server-local bridge, not call the identity "crack".
p = root / 'src/main/core/AccountService.ts'
s = p.read_text(encoding='utf-8')
old = "this.emit({ stage: 'success', message: 'Đã lưu skin Bestiary. Skin crack sẽ được áp dụng khi vào server.' });"
req(old in s, 'AccountService local skin wording marker missing')
s = s.replace(old, "this.emit({ stage: 'success', message: 'Đã lưu skin Bestiary. Skin local/offline sẽ được áp dụng khi vào server.' });", 1)
req("if (this.current.mode !== 'microsoft') return null;" in s, 'Local/offline launch is no longer isolated from Microsoft authorization')
req('CRACK' not in s.upper(), 'Legacy CRACK wording remains in AccountService')
p.write_text(s, encoding='utf-8')

# Home account entry should use the same terminology.
p = root / 'src/renderer/src/components/Home.tsx'
s = p.read_text(encoding='utf-8')
old = '"Crack · Microsoft chính chủ"'
req(old in s, 'Home local-account wording marker missing')
s = s.replace(old, '"Local / Offline · Microsoft chính chủ"', 1)
req('CRACK' not in s.upper(), 'Legacy CRACK wording remains in Home')
p.write_text(s, encoding='utf-8')

# Version bump for the policy/wording hotfix.
p = root / 'src/renderer/src/App.tsx'
s = p.read_text(encoding='utf-8')
s = re.sub(r"currentVersion:\s*'\d+\.\d+\.\d+'", "currentVersion: '5.3.3'", s, count=1)
req("currentVersion: '5.3.3'" in s, 'Unable to bump App version to 5.3.3')
p.write_text(s, encoding='utf-8')

for rel in [
    'src/renderer/src/components/Home.tsx',
    'src/main/core/RemoteService.ts',
    'src/main/core/AccountService.ts',
]:
    p = root / rel
    text = p.read_text(encoding='utf-8')
    text = text.replace('5.3.2', '5.3.3').replace('5.3.1', '5.3.3').replace('5.3.0', '5.3.3')
    if rel.endswith('Home.tsx') and '5.3.3' not in text:
        text += '\n// Bestiary Launcher 5.3.3 local/offline identity terminology hotfix\n'
    p.write_text(text, encoding='utf-8')

print('Bestiary Launcher 5.3.3 local/offline identity policy wording applied.')

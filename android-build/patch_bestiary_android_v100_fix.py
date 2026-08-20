from pathlib import Path
import base64
import re

APP = Path('amethyst/app_pojavlauncher')
RES = APP / 'src/main/res'
FRAG = APP / 'src/main/java/net/kdt/pojavlaunch/fragments/MainMenuFragment.java'

# Reconstruct the exact Bestiary PNG only from the canonical unsuffixed chunks.
# The a/b files are split mirrors of some canonical chunks and must not be concatenated again.
chunks = []
for path in Path('bestiary-build').glob('logo5-*'):
    if re.fullmatch(r'logo5-\d{2}', path.name):
        chunks.append(path)
chunks.sort(key=lambda p: p.name)
if [p.name for p in chunks] != ['logo5-00', 'logo5-01', 'logo5-02', 'logo5-03', 'logo5-04']:
    raise SystemExit('Canonical Bestiary logo chunks are incomplete')
encoded = ''.join(p.read_text(encoding='utf-8').strip() for p in chunks)
logo = base64.b64decode(encoded, validate=True)
if not logo.startswith(b'\x89PNG\r\n\x1a\n'):
    raise SystemExit('Canonical Bestiary logo is not PNG')
out = RES / 'drawable-nodpi/bestiary_logo.png'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_bytes(logo)

# Use the upstream-configured Discord invite instead of hard-coding a guessed URL.
s = FRAG.read_text(encoding='utf-8')
s = s.replace(
    'mDiscordButton.setOnClickListener(v -> Tools.openURL(requireActivity(), "https://discord.com/invite/HeYXW6AT3v"));',
    'mDiscordButton.setOnClickListener(v -> Tools.openURL(requireActivity(), getString(R.string.discord_invite)));'
)
FRAG.write_text(s, encoding='utf-8')

# Contract checks.
manifest = (APP / 'src/main/AndroidManifest.xml').read_text(encoding='utf-8')
launcher = (APP / 'src/main/java/net/kdt/pojavlaunch/LauncherActivity.java').read_text(encoding='utf-8')
bootstrap = (APP / 'src/main/java/net/kdt/pojavlaunch/BestiaryBootstrap.java').read_text(encoding='utf-8')
main_menu = FRAG.read_text(encoding='utf-8')
if 'android:screenOrientation="portrait"' not in manifest:
    raise SystemExit('Portrait launcher contract missing')
if 'BestiaryOfflineAccount.prompt(this)' not in launcher:
    raise SystemExit('Offline account contract missing')
if 'Tools.swapFragment(this, SelectAuthFragment.class' in launcher:
    raise SystemExit('Auth picker is still reachable')
if 'includesAndroidProfile(item)' not in bootstrap:
    raise SystemExit('Android manifest profile filter missing')
if 'BestiaryRendererPolicy.apply()' not in bootstrap:
    raise SystemExit('Renderer policy hook missing')
if 'deleteSodiumMods' in main_menu:
    raise SystemExit('Upstream Sodium delete flow is still active')
if not out.is_file() or out.stat().st_size < 1024:
    raise SystemExit('Bestiary app icon is missing')

print('Bestiary Android 1.0.0 branding/offline/profile/render contracts verified')

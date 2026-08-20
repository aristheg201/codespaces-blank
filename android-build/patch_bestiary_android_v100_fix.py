from pathlib import Path

APP = Path('amethyst/app_pojavlauncher')
RES = APP / 'src/main/res'
FRAG = APP / 'src/main/java/net/kdt/pojavlaunch/fragments/MainMenuFragment.java'
out = RES / 'drawable-nodpi/bestiary_logo.png'

# The main branding patch already writes the reconstructed canonical PNG.
# Keep this post-pass focused on safety/contract checks and resource-backed links.
if not out.is_file() or out.stat().st_size < 1024:
    raise SystemExit('Bestiary app icon is missing')
if out.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
    raise SystemExit('Bestiary app icon is not PNG')

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

print('Bestiary Android 1.0.0 branding/offline/profile/render contracts verified')

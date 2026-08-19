from pathlib import Path

p = Path('amethyst/app_pojavlauncher/src/main/java/net/kdt/pojavlaunch/BestiaryBootstrap.java')
s = p.read_text(encoding='utf-8')
s = s.replace(
    'if (launchAfter) ExtraCore.setValue(net.kdt.pojavlaunch.extra.ExtraConstants.LAUNCH_GAME, true);',
    'if (launchAfter) net.kdt.pojavlaunch.extra.ExtraCore.setValue(net.kdt.pojavlaunch.extra.ExtraConstants.LAUNCH_GAME, true);'
)
p.write_text(s, encoding='utf-8')
print('Bestiary offline compile fix applied')

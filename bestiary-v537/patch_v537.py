from pathlib import Path
import re

root = Path('source')
main = root / 'src/main/index.ts'
home_css = root / 'src/renderer/src/components/Home.css'
app = root / 'src/renderer/src/App.tsx'
home = root / 'src/renderer/src/components/Home.tsx'


def req(ok, msg):
    if not ok:
        raise SystemExit(msg)

s = main.read_text(encoding='utf-8')

# Lifecycle hardening: a rejected second instance must die synchronously.
req('app.requestSingleInstanceLock()' in s, '5.3.6 single-instance lock missing')
s = s.replace('if (!gotSingleInstanceLock) {\n  app.quit();\n}', 'if (!gotSingleInstanceLock) {\n  app.exit(0);\n}', 1)
s = s.replace('if (!gotSingleInstanceLock) app.quit();', 'if (!gotSingleInstanceLock) app.exit(0);', 1)
req('app.exit(0)' in s, 'rejected second instance is not hard-exited')

if "import { KeybindPolicyService } from './core/KeybindPolicyService';" not in s:
    marker = "import { ContentManager } from './core/ContentManager';"
    req(marker in s, 'ContentManager import marker missing')
    s = s.replace(marker, marker + "\nimport { KeybindPolicyService } from './core/KeybindPolicyService';", 1)

# Use the exact same authoritative gameDirectory that ContentManager and AccountService use.
# No path is stored in LauncherSettings.
instance_marker = 'const contentManager = new ContentManager(gameDirectory, ownershipFilePath);'
req(instance_marker in s, 'authoritative gameDirectory marker missing')
if 'const keybindPolicyService = new KeybindPolicyService(gameDirectory);' not in s:
    s = s.replace(instance_marker, instance_marker + '\nconst keybindPolicyService = new KeybindPolicyService(gameDirectory);', 1)

# Apply after sync/Fabric preparation and immediately before Minecraft launch.
launch_patterns = [
    r'(\n\s*)(return\s+await\s+minecraftLauncher\.launch\()',
    r'(\n\s*)(await\s+minecraftLauncher\.launch\()',
    r'(\n\s*)(const\s+\w+\s*=\s*await\s+minecraftLauncher\.launch\()',
]
inserted = False
for pat in launch_patterns:
    m = re.search(pat, s)
    if m:
        indent = m.group(1)
        replacement = indent + "await keybindPolicyService.apply();" + indent + m.group(2)
        s = s[:m.start()] + replacement + s[m.end():]
        inserted = True
        break
req(inserted, 'Minecraft launch call marker missing for keybind policy')

main.write_text(s, encoding='utf-8')

# Desktop scrolling remains inside Home, so root/modal clipping does not create double bars.
css = home_css.read_text(encoding='utf-8')
req('overflow: hidden;' in css, 'Home root overflow contract missing')
css += r'''

/* Launcher 5.3.7: desktop content must remain reachable on short windows. */
.bestiary-home {
  height: 100vh;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}
.bestiary-home::-webkit-scrollbar,
.modal-shell::-webkit-scrollbar,
.library-body::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
.bestiary-home::-webkit-scrollbar-track,
.modal-shell::-webkit-scrollbar-track,
.library-body::-webkit-scrollbar-track {
  background: rgba(10,10,11,.82);
}
.bestiary-home::-webkit-scrollbar-thumb,
.modal-shell::-webkit-scrollbar-thumb,
.library-body::-webkit-scrollbar-thumb {
  background: rgba(255,103,58,.48);
  border: 2px solid rgba(10,10,11,.9);
  border-radius: 999px;
}
.bestiary-home::-webkit-scrollbar-thumb:hover,
.modal-shell::-webkit-scrollbar-thumb:hover,
.library-body::-webkit-scrollbar-thumb:hover {
  background: rgba(255,122,76,.72);
}
'''
home_css.write_text(css, encoding='utf-8')

for p in (app, home):
    t = p.read_text(encoding='utf-8').replace('5.3.6', '5.3.7').replace('5.3.5', '5.3.7')
    p.write_text(t, encoding='utf-8')

ms = main.read_text(encoding='utf-8')
req('app.exit(0)' in ms, 'hard second-instance exit missing')
req('const keybindPolicyService = new KeybindPolicyService(gameDirectory);' in ms, 'authoritative keybind game directory missing')
req('await keybindPolicyService.apply();' in ms, 'keybind pre-launch apply missing')
req('overflow-y: auto' in home_css.read_text(encoding='utf-8'), 'desktop scrollbar missing')
print('Launcher 5.3.7 lifecycle, scrollbar and keybind policy patch applied.')

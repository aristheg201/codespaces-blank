from pathlib import Path

JAVA = Path('amethyst/app_pojavlauncher/src/main/java/net/kdt/pojavlaunch')
p = JAVA / 'BestiarySkinManager.java'
s = p.read_text(encoding='utf-8')

old = '''        RadioButton classic = new RadioButton(activity);\n        classic.setText("DEFAULT / CLASSIC");\n        RadioButton slim = new RadioButton(activity);\n        slim.setText("SLIM");'''
new = '''        RadioButton classic = new RadioButton(activity);\n        classic.setId(android.view.View.generateViewId());\n        classic.setText("DEFAULT / CLASSIC");\n        RadioButton slim = new RadioButton(activity);\n        slim.setId(android.view.View.generateViewId());\n        slim.setText("SLIM");'''
if old not in s:
    raise SystemExit('skin radio marker missing')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')

if 'classic.setId(android.view.View.generateViewId())' not in s:
    raise SystemExit('classic radio id missing')
if 'slim.setId(android.view.View.generateViewId())' not in s:
    raise SystemExit('slim radio id missing')
print('Bestiary Android 1.0.2 skin selector IDs fixed')

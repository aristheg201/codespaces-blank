from pathlib import Path

account = Path('source/src/main/core/AccountService.ts')
s = account.read_text(encoding='utf-8')
old = '''  public async installClientBridge(sourceJar: string): Promise<void> {\n    const stat = await fs.stat(sourceJar).catch(() => null);\n    if (!stat?.isFile()) throw new Error('Bestiary Skin Bridge bundled jar is missing.');\n    const mods = path.join(this.gameDirectory, 'mods');\n    await fs.ensureDir(mods);\n    for (const file of await fs.readdir(mods)) {\n      if (/^bestiary-skin-bridge-.*\\.jar$/iu.test(file)) await fs.remove(path.join(mods, file));\n    }\n    await fs.copyFile(sourceJar, path.join(mods, 'bestiary-skin-bridge-1.0.0.jar'));\n  }'''
new = '''  public async installClientBridge(sourceJar: string): Promise<void> {\n    const data = await fs.readFile(sourceJar).catch(() => null);\n    if (!data || data.length < 10_000) throw new Error('Bestiary Skin Bridge bundled jar is missing or invalid.');\n    const mods = path.join(this.gameDirectory, 'mods');\n    await fs.ensureDir(mods);\n    for (const file of await fs.readdir(mods)) {\n      if (/^bestiary-skin-bridge-.*\\.jar$/iu.test(file)) await fs.remove(path.join(mods, file));\n    }\n    const target = path.join(mods, 'bestiary-skin-bridge-1.0.0.jar');\n    const tmp = `${target}.tmp`;\n    await fs.writeFile(tmp, data);\n    await fs.move(tmp, target, { overwrite: true });\n  }'''
if old not in s:
    raise SystemExit('AccountService installClientBridge marker missing')
account.write_text(s.replace(old, new, 1), encoding='utf-8')

main = Path('source/src/main/index.ts')
s = main.read_text(encoding='utf-8')
old = "path.join(process.resourcesPath, 'bestiary-skin-bridge-1.0.0.jar')"
new = "path.join(app.getAppPath(), 'resources', 'bestiary-skin-bridge-1.0.0.jar')"
if old not in s:
    raise SystemExit('Skin Bridge runtime path marker missing')
main.write_text(s.replace(old, new, 1), encoding='utf-8')

print('Skin Bridge packaging switched to ASAR-safe read/write deployment.')

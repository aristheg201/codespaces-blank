from pathlib import Path

p = Path('source/src/main/index.ts')
s = p.read_text(encoding='utf-8')
marker = "  ipcMain.handle('bestiary:library-install', (_event, kind: LibraryKind, paths: string[]) => contentManager.install(kind, paths));"
if marker not in s:
    raise SystemExit('library install handler marker missing')
insert = """  ipcMain.handle('bestiary:library-choose-auto', async () => {\n    const result = await dialog.showOpenDialog({\n      properties: ['openFile', 'multiSelections'],\n      filters: [{ name: 'Minecraft Client Content', extensions: ['jar', 'zip'] }],\n    });\n    return result.canceled ? [] : result.filePaths;\n  });\n  ipcMain.handle('bestiary:library-import-auto', (_event, paths: string[]) => contentManager.importAuto(paths));\n"""
s = s.replace(marker, insert + marker)
p.write_text(s, encoding='utf-8')

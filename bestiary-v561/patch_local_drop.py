from pathlib import Path
import hashlib

root = Path("source")
def content(path):
    return (root / path).read_text(encoding="utf8")

def replace_once(path, old, new):
    file = root / path
    text = file.read_text(encoding="utf8")
    n = text.count(old)
    if n != 1:
        raise SystemExit(f"[V561] {path}: expected one marker, found {n}: {old[:80]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf8")

auth_file = root / "src/main/core/AccountService.ts"
auth_before = hashlib.sha256(auth_file.read_bytes()).hexdigest()
main_file = root / "src/main/index.ts"
main_before = main_file.read_text(encoding="utf8")
preload_before = content("src/preload/index.ts")
assert "accountService.getLaunchAuthorization(settings.username)" in main_before
assert "accountService.shouldUseOfficialLauncher()" in main_before
for token in ("getAccounts:", "setAccountMode:", "loginMicrosoft:", "logoutMicrosoft:", "getPathForFile:"):
    assert token in preload_before, "[V561] original account/file bridge missing: " + token

ui = "src/renderer/src/components/ModpacksScreen.tsx"
replace_once(ui,
    "import { useEffect, useState } from 'react';",
    "import { useEffect, useState, type DragEvent, type ChangeEvent } from 'react';")
replace_once(ui,
    "  const [busy, setBusy] = useState(false);",
    "  const [busy, setBusy] = useState(false);\n  const [dragging, setDragging] = useState(false);")

old = """  function installFiles() {
    if (!active) return;
    void run(async () => {
      const paths = await window.bestiary.chooseAnyContentFiles();
      if (!paths.length) return;
      const result = await window.bestiary.installModpackFiles(active.id, paths);
      setLibrary(result.snapshot);
      const report = result.skipped.map((item) => item.fileName + ': ' + item.reason);
      setMessage('Đã nhập ' + result.imported.length + ' file.');
      if (report.length) setError(report.join('\n'));
    });
  }
"""
new = """  // Personal modpack files come exclusively from the player's local machine.
  // Reuse the same on-disk importer as the Browse action; never download mods.
  function importLocalPaths(packId: string, paths: string[]) {
    if (!paths.length) {
      setError('Không tìm thấy đường dẫn file trên máy. Kéo từ Explorer hoặc chọn file bằng nút bên dưới.');
      return;
    }
    void run(async () => {
      const result = await window.bestiary.installModpackFiles(packId, paths);
      if (selected === packId) setLibrary(result.snapshot);
      if (result.imported.length) setKind(result.imported[0].kind);
      setMessage(result.imported.length
        ? 'Đã cài ' + result.imported.length + ' file vào modpack cá nhân.'
        : 'Không có file mới được cài.');
      if (result.skipped.length) {
        setError(result.skipped.map((item) => item.fileName + ': ' + item.reason).join('\\n'));
      }
    });
  }

  function getDroppedPaths(files: FileList): string[] {
    const result: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const local = window.bestiary.getPathForFile(file);
        if (local) result.push(local);
      } catch { /* File may be virtual/browser-provided rather than a local OS file. */ }
    }
    return result;
  }

  function installFiles() {
    if (!active || busy || dialog || runtimeTarget) return;
    const packId = active.id;
    void window.bestiary.chooseAnyContentFiles()
      .then((paths) => { if (paths.length) importLocalPaths(packId, paths); })
      .catch((cause) => setError(errorText(cause)));
  }

  function changeLocalFiles(event: ChangeEvent<HTMLInputElement>) {
    const packId = active?.id;
    const paths = getDroppedPaths(event.currentTarget.files!);
    event.currentTarget.value = '';
    if (packId && !busy && !dialog && !runtimeTarget && paths.length) importLocalPaths(packId, paths);
    else if (!paths.length) setError('Không đọc được đường dẫn file cục bộ.');
  }

  function onModDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    const packId = active?.id;
    if (!packId || busy || dialog || runtimeTarget) {
      setError('Hãy chọn một modpack cá nhân và đóng cửa sổ đang mở trước khi thả file.');
      return;
    }
    // webUtils.getPathForFile preserves OS-backed file paths across Electron's
    // context-isolated renderer. File.path is deliberately not used.
    const paths = getDroppedPaths(event.dataTransfer.files);
    importLocalPaths(packId, paths);
  }

  function onModDragOver(event: DragEvent<HTMLElement>) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    const canDrop = Boolean(active) && !busy && !dialog && !runtimeTarget;
    event.dataTransfer.dropEffect = canDrop ? 'copy' : 'none';
    if (canDrop) setDragging(true);
  }
"""
replace_once(ui, old, new)

replace_once(ui,
    """  return <main className="modpacks-screen">""",
    """  return <main className="modpacks-screen"
    onDragOver={onModDragOver}
    onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
    }}
    onDrop={onModDrop}>""")

replace_once(ui,
    """          <div className="modpacks-tabs">""",
    """          <section className={'modpacks-dropzone' + (dragging ? ' active' : '')}
            aria-label="Thêm file mod cục bộ bằng kéo thả">
            <div>
              <strong>↓ KÉO THẢ FILE MOD VÀO MODPACK NÀY</strong>
              <span>Mod .jar theo đúng loader đã chọn · Resource pack hoặc shader .zip</span>
              <small>Chỉ lấy file từ ổ đĩa của player. Không dùng CurseForge API, không tự tải dependency.</small>
            </div>
            <label className="modpacks-local-picker">
              CHỌN FILE TRÊN MÁY
              <input type="file" multiple accept=".jar,.zip" aria-label="Chọn mod, resource pack hoặc shader từ máy"
                disabled={busy || dialog !== null || runtimeTarget !== null}
                onChange={changeLocalFiles}/>
            </label>
          </section>
          <div className="modpacks-tabs">""")

replace_once(ui,
    """<div className="modpacks-note">Mỗi modpack dùng đúng Minecraft version và loader riêng, có mods, config, resourcepacks, shaderpacks và saves độc lập. Import CurseForge có projectID/fileID cần bộ tải CurseForge API; launcher hiện sẽ báo rõ thay vì tạo pack thiếu mod.</div>""",
    """<div className="modpacks-note">Cài mod bằng cách tải file .jar về máy rồi kéo thả vào đây. Mod cần đúng loader và Minecraft version; các dependency cần thiết cũng phải được player tự tải và thêm vào. Mỗi modpack có mods, config, options.txt, keybind và world riêng; chế độ Local/Offline và Microsoft Auth giữ nguyên.</div>""")

css_path = root / "src/renderer/src/components/ModpacksScreen.css"
css = css_path.read_text(encoding="utf8")
css += """
/* Local-file-only modpack drop zone, independent from Official Pack Manager. */
.modpacks-dropzone{border:2px dashed #3c658c;border-radius:14px;margin-top:22px;padding:18px;display:flex;gap:16px;align-items:center;justify-content:space-between;background:#112439;transition:background .15s,border-color .15s}
.modpacks-dropzone.active{border-color:#93c7ff;background:#1b3b61;box-shadow:inset 0 0 0 1px #82b9f5}
.modpacks-dropzone>div{display:flex;flex-direction:column;gap:7px;min-width:0}
.modpacks-dropzone strong{font-size:14px;letter-spacing:.35px;color:#d9ebff}
.modpacks-dropzone span{font-size:12px;color:#b2cce7}
.modpacks-dropzone small{color:#8ca8c6;font-size:11px}
.modpacks-local-picker{cursor:pointer;border:1px solid #5a91d1;background:#214a79;border-radius:10px;padding:12px 14px;display:inline-flex;flex-shrink:0;color:#fff;font-size:12px;font-weight:700;text-align:center}
.modpacks-local-picker:hover{background:#2e639b}
.modpacks-local-picker:focus-within{outline:2px solid #92c5ff;outline-offset:2px}
.modpacks-local-picker input{position:absolute;width:1px;height:1px;opacity:0;overflow:hidden}
@media(max-width:720px){.modpacks-dropzone{flex-direction:column;align-items:stretch}.modpacks-local-picker{justify-content:center}}
"""
css_path.write_text(css, encoding="utf8")

# This patch must not edit local/offline or Microsoft AccountService, auth IPC,
# token files, or any SVFrame Official keybind/manifest modules.
assert auth_before == hashlib.sha256(auth_file.read_bytes()).hexdigest(), "AccountService modified"
assert main_before == main_file.read_text(encoding="utf8"), "Account/launch main was modified"
assert preload_before == content("src/preload/index.ts"), "Account IPC/preload modified"
final = content(ui)
assert "getPathForFile(file)" in final and "installModpackFiles(packId, paths)" in final
assert "dataTransfer.files" in final and "onDrop={onModDrop}" in final
assert "import CurseForge" not in final
print("QA PASS: local drag/drop bound to selected personal instance; existing Offline/Microsoft auth untouched.")

from pathlib import Path

root = Path("source")
app = root / "src/renderer/src/App.tsx"
text = app.read_text(encoding="utf-8")
old = "currentVersion: '5.5.0'"
assert text.count(old) == 1, "Expected Launcher 5.5.0 version marker exactly once"
app.write_text(text.replace(old, "currentVersion: '5.5.1'", 1), encoding="utf-8")

home = root / "src/renderer/src/components/Home.tsx"
content = home.read_text(encoding="utf-8")
assert "5.5.0" in content, "Home version marker missing"
home.write_text(content.replace("5.5.0", "5.5.1"), encoding="utf-8")

for rel in (
    "src/main/core/AccountService.ts",
    "src/main/core/RemoteService.ts",
    "src/main/core/LoaderCatalog.ts",
):
    target = root / rel
    content = target.read_text(encoding="utf-8")
    content = content.replace("BestiaryLauncher/5.5.0", "BestiaryLauncher/5.5.1")
    target.write_text(content, encoding="utf-8")

# Keep JVM revision 551. Distribution version 5.5.1 is independent of
# the internal hardware policy revision 551; do not reset player preferences.
main = (root / "src/main/index.ts").read_text(encoding="utf-8")
assert "settings.generatedJvmArgs.includes('-Dbestiary.jvm.profile=551')" in main
assert main.count("await keybindPolicyService.apply();") == 2
assert main.count("await officialLowEndOptionsService.apply(settings.clientProfile);") == 2
p = main.index("async function startPersonalModpack(")
e = main.index("async function accountSnapshot() {", p)
assert "keybindPolicyService" not in main[p:e]
assert "officialLowEndOptionsService" not in main[p:e]
print("QA PASS: 5.5.1 version and Official/Personal launch scope")

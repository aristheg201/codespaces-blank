# Bestiary Minecraft Runtime v5.6.0-alpha.1 — Architecture foundation

## Scope and invariants

The new instance runtime uses structural ideas from Prism Launcher:
MinecraftInstance/PackProfile for per-instance configuration, Java verification
from launch metadata, and staged instance updates. It is authored as independent
TypeScript, not a drop-in copy of Prism. CurseForge's manifest structure is a
separate, future import capability; projectID/fileID downloads are not yet supported
and the launcher must not silently create incomplete packs.

- **SVFrame Official Full/Lite:** Managed by Bestiary Pack Manager and existing
  official content/keybind policy, never accessed by PersonalInstanceRuntimeService.
- **My Modpacks:** Own gameDirectory, versions, libraries, Java/RAM settings,
  mods, config, options.txt, keybinds and saves. Never automatically sync Official
  resourcepacks, server address or keybind policy.
- **Minecraft version/loader:** Vanilla, Fabric, Quilt, Forge and NeoForge remain
  selected using official metadata, with loader compatibility checks.
- **Java:** Prefer javaVersion.majorVersion in Mojang version metadata, fall back
  only for known legacy releases; explicitly reject unsupported Java majors.
  An intentionally incompatible manual Java override is rejected, not silently used.
- **RAM:** Per-instance AUTO/min/max, capped to physical RAM. Read-only global
  settings are a fallback only for RAM; global Official JVM flags are not inherited.
- **Data safety:** Atomic separate .bestiary/personal-runtime.json writes;
  no world/config/options.txt rewrite, no migration that resets existing instances.
- **Update safety:** v5.5.1 remains the production release branch. v5.6.0-alpha.1
  is a GitHub Actions QA candidate only; the auto-updater is not changed.
- **QA:** Strict TypeScript compile, regression for per-pack isolation, Java metadata,
  RAM budgets and UI CRUD, then real NeoForge installer integration.

## Follow-up engineering

1. Transactional download manager with checksums and staging/rollback.
2. Full CurseForge manifest project/file resolver plus Modrinth mrpack import.
3. Loader version component graph, dependency rules and Java runtime picker.
4. In-game FPS/frametime benchmark on a physical low-end Windows GPU.
5. Per-instance custom JVM args editor and Java 16 legacy runtime support.

These are not represented as delivered in the alpha foundation.

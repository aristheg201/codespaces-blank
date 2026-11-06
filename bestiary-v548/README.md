# Bestiary Launcher 5.4.8 - Personal Modpack Manager

This feature branch extends the existing 5.4.7 Windows/Electron launcher. It does not overwrite the server-managed SVFrame/Bestiary installation.

## Implemented in source

- Multiple independent personal Fabric 1.21.1 / Fabric Loader 0.18.4 modpack directories under `userData/modpacks/<UUID>/instance`
- Create, rename, duplicate and remove modpacks (with UI deletion confirmation)
- Isolated `mods`, `config`, `resourcepacks`, `shaderpacks`, `saves` and other supported folders
- Add local Fabric JARs/resource pack ZIPs/shader ZIPs using the existing ContentManager validator
- List, enable/disable and remove per-modpack content without changing official managed pack
- Local self-contained `svframe-modpack.json` ZIP import/export; optional export of singleplayer saves
- Reject unsafe archive paths, symbolic links and oversized archive listings
- Recognize CurseForge `manifest.json` only when it has no unresolved remote projectID/fileID entries; **do not report a remote-reference pack as imported**.

## Not implemented or verified

- Direct personal-pack Play/Singleplayer process launch via Minecraft launcher core (requires explicit per-instance launch isolation and lifecycle QA)
- CurseForge Marketplace search/download API integration and dependency resolution by projectID/fileID
- Forge/NeoForge/Quilt or other Minecraft versions
- Automated local end-to-end test; compile and Windows smoke test must pass before release
- Official CurseForge distribution format export: current export is a self-contained **SVFrame format**.

## Build and QA

The action `.github/workflows/build-bestiary-launcher-v548.yml` reconstructs the existing verified launcher, applies `patch_v548.py`, runs typecheck, builds Windows installer and checks Electron startup. The workflow is intentionally **not** configured to publish an update to the stable app-updates channel.

Required manual QA:
1. Confirm official SVFrame Full/Lite launcher still operates unchanged.
2. Create two personal modpacks; add a unique Fabric JAR to each and verify no cross-instance leakage.
3. Toggle and remove a personal mod; inspect only the intended instance.
4. Clone a pack with saves and confirm both pack roots are independent.
5. Export without saves, import back and verify files/metadata.
6. Try archive traversal/symlink/oversized ZIP, confirm rejection and no writes outside instance.
7. Try a CurseForge ZIP with projectID/fileID references; confirm explicit rejection.
8. Test deleting a personal pack while preserving official game directory and another pack.

## Architecture

`bestiary-v548/build.ps1` reconstructs source from the existing versioned build pipeline, then invokes `bestiary-v548/patch_v548.py` to introduce the ModpackManager/IPC/UI files. This maintains existing source packaging conventions and avoids shipping JavaScript code as nested JARs or unmanaged installers.

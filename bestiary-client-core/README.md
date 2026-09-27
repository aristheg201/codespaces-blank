# Bestiary Client Core 0.1.0

Client-only Fabric performance foundation for Minecraft 1.21.1 / Java 21.

## Non-negotiable contract

This project is **lossless** by default. It does not reduce or alter:

- server or client gameplay ticks;
- entity/AI/battle logic;
- simulation distance or render distance;
- spawn/despawn behavior;
- particles, models, textures, animations or mipmaps;
- packet semantics, save data or NBT;
- Cobblemon species/form/aspect/variation selection.

If an optimization cannot prove semantic equivalence, the implementation must fall back to Minecraft's normal path.

## 0.1.0 implemented work

### Small structural-resource ZIP byte cache

Zip resource packs frequently reopen the same JSON/metadata resources while multiple reloaders resolve dependent content. The client keeps a small, heap-aware **in-memory only** LRU of exact decompressed bytes for structural/text resources.

- no resource contents are persisted to disk;
- no PNG/model/skin export;
- no resource paths are rewritten;
- bytes returned to Minecraft are identical to the original pack bytes;
- oversized entries bypass the cache;
- cache is cleared when the ZipResourcePack closes;
- memory budget is smaller on low-Xmx clients.

This is intentionally compatible in scope with Quick Pack: Quick Pack accelerates ZIP file-tree/namespace enumeration, while Bestiary Client Core caches repeated small resource reads.

### Resource reload profiler

Each vanilla/Fabric reload listener is wrapped without changing its returned future or synchronization barrier. The mod logs:

- total reload time;
- slowest reloaders;
- prepare duration;
- synchronization barrier wait;
- cache hits/misses/bytes/evictions.

This gives measured data for the next optimization pass instead of guessing where a large Cobblemon server pack spends time.

## Configuration

Generated at:

`config/bestiary-client-core.properties`

Defaults:

```properties
zipByteCache=true
reloadProfiler=true
maxCacheMiB=0
maxEntryKiB=1024
logTopReloaders=12
```

`maxCacheMiB=0` selects a heap-aware cache budget automatically.

## Next pass

After profiling the real Bestiary server resource pack, target the dominant Cobblemon 1.8.1 reload stages with precise generation/dependency invalidation. Do not introduce blanket "skip reload" logic.

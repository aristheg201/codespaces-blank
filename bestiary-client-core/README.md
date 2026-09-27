# Bestiary Client Core 0.3.0

Client-only Fabric performance layer for Minecraft 1.21.1 / Java 21 / Cobblemon 1.8.x.

## Contract: no gameplay or visual tradeoff

The mod does not lower render distance, simulation distance, entity distance, particles, mipmaps, texture quality, animation rate, AI, battle logic or tick behavior. Exact resource bytes and compatibility versions determine reuse. If a cache cannot be trusted, the normal Cobblemon path is used.

## What V3 changes

0.2.0 could reuse parsed animation groups only while the same Minecraft process remained open. A full launcher/game restart still lost that cache.

0.3.0 adds an **L2 persistent compiled animation cache**.

Cold path for a new resource:

```
.animation.json
  -> exact bytes
  -> SHA-256
  -> Cobblemon Gson + MoLang parse
  -> validation
  -> runtime BedrockAnimationGroup
  -> content-addressed compiled cache on disk
```

Hot path after restarting the game:

```
.animation.json
  -> exact bytes
  -> SHA-256
  -> compiled-cache hit
  -> deserialize BedrockAnimationGroup
  -> runtime repository
```

The source JSON is never exported to the compiled-cache directory.

## Cache correctness

A persistent entry is accepted only when all of the following match:

- cache schema;
- Minecraft version;
- Cobblemon version;
- Java major/runtime target;
- exact SHA-256 of the animation JSON;
- binary payload CRC.

The cache is content-addressed, so an unchanged animation group can survive a server resource-pack update even if other files changed.

Corrupt, incompatible or undecodable entries are deleted and parsed through Cobblemon normally.

## Validation and particle safety

A group is written to persistent cache only after its animations successfully pass Cobblemon's normal `checkForErrors()` validation.

Groups containing Bedrock particle keyframes are not persisted or memory-reused. Those keyframes capture direct particle repository references at parse time, so reuse across a particle reload could retain stale particle objects.

This intentionally sacrifices some cache hits for correctness.

## Disk layout

```
.minecraft/
  .bestiary/
    cache/
      compiled/
        animations/
          v3/
            ab/
              ab...sha256.bca
```

The filenames are content hashes rather than resource names. The binary cache does not create a plaintext replacement resource pack.

Writes use a temporary file plus atomic move where supported.

## Bounded disk use

Default persistent cache budget: 512 MiB.

Old entries are evicted by last-use time when the budget is exceeded. Runtime objects required by the current Cobblemon generation are unaffected by disk eviction.

## Profiler

The existing reload profiler remains enabled. V3 also prints an animation-specific line:

```
[Cobblemon animations v3] ... memoryHits=... persistentHits=... parsedMisses=...
hash=... diskLookup=... parse=... validate=... diskWrite=...
```

The first run with a new pack is expected to be the expensive population run. The important benchmark is a **complete game restart followed by joining the same server again**.

## Configuration

`config/bestiary-client-core.properties`

```properties
zipByteCache=true
reloadProfiler=true
cobblemonAnimationIncremental=true
persistentCompiledCache=true
maxCacheMiB=0
persistentCacheMiB=512
maxEntryKiB=1024
logTopReloaders=12
```

Disable only the persistent layer with:

```properties
persistentCompiledCache=false
```

The 0.2 memory cache and profiler can remain active.

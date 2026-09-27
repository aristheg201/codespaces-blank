# Bestiary Client Core 0.2.0

Client-only Fabric performance layer for Minecraft 1.21.1 / Java 21 / Cobblemon 1.8.x.

## Non-negotiable contract

This project is **lossless** by default. It does not reduce or alter:

- server or client gameplay ticks;
- entity/AI/battle logic;
- simulation distance or render distance;
- spawn/despawn behavior;
- particles, models, textures, animations or mipmaps;
- packet semantics, save data or NBT;
- Cobblemon species/form/aspect/variation selection.

If an optimization cannot prove semantic equivalence, the implementation falls back to the normal path.

## Why 0.2.0 exists

A real Bestiary client profile showed that the first server-pack reload still took about 12.6 seconds. The 0.1.0 ZIP byte cache had only 1 hit versus 11 misses, so ZIP re-open cost was not the main bottleneck.

Cobblemon then loaded more than twenty thousand animations and the animation stage visibly occupied roughly five seconds. The vanilla baked-model reload also had several seconds of real prepare work.

0.2.0 therefore stops treating ZIP lookup as the primary target and adds a Cobblemon-specific exact-content cache plus better per-listener CPU timing.

## Incremental Cobblemon animation groups

During the first resource generation, animation groups are parsed normally.

For the next reload in the same game process:

1. each animation JSON is read exactly;
2. SHA-256 is computed over the exact bytes;
3. unchanged groups reuse the already parsed Cobblemon object;
4. changed/new groups are parsed normally;
5. validation still runs;
6. the completed generation is committed only after preparation succeeds.

The cache is memory-only. Source JSON is not written anywhere.

### Particle safety rule

Cobblemon particle keyframes bind directly to particle objects while animation JSON is parsed. A particle definition may change even when its animation JSON does not.

Therefore any animation group containing a particle keyframe is **never reused**. It stays on the original parse path. This intentionally gives up some cache hits to preserve correct particle behavior.

## Profiler 2

0.1.0 wall-time rankings were distorted by synchronization-barrier waits. 0.2.0 additionally times the actual Runnable work submitted to each reloader's prepare/apply executors and sorts the slow list by real executor time.

Expected log format:

```
[Reload #2] #1 ... executor=5233 ms (prepare=... apply=...), wall=..., barrier=...
[Cobblemon animations] loaded ... reusableHits=... parsedMisses=... parse=... validate=...
```

## Configuration

`config/bestiary-client-core.properties`

```properties
zipByteCache=true
reloadProfiler=true
cobblemonAnimationIncremental=true
maxCacheMiB=0
maxEntryKiB=1024
logTopReloaders=12
```

Set `cobblemonAnimationIncremental=false` to use Cobblemon's original animation loader without removing the mod.

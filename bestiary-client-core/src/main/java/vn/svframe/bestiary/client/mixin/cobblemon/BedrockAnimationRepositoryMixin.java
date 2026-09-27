/*
 * This file reimplements the resource-loop semantics of Cobblemon's
 * BedrockAnimationRepository.loadAnimations in order to add exact-content caches.
 * Cobblemon is licensed under MPL-2.0; this file is distributed under MPL-2.0.
 */
package vn.svframe.bestiary.client.mixin.cobblemon;

import com.cobblemon.mod.common.client.render.models.blockbench.BedrockAnimationReferenceFactory;
import com.cobblemon.mod.common.client.render.models.blockbench.JsonPose;
import com.cobblemon.mod.common.client.render.models.blockbench.bedrock.animation.BedrockAnimation;
import com.cobblemon.mod.common.client.render.models.blockbench.bedrock.animation.BedrockAnimationGroup;
import com.cobblemon.mod.common.client.render.models.blockbench.bedrock.animation.BedrockAnimationRepository;
import com.google.gson.Gson;
import net.minecraft.resource.Resource;
import net.minecraft.resource.ResourceManager;
import net.minecraft.util.Identifier;
import org.spongepowered.asm.mixin.Final;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import vn.svframe.bestiary.client.BestiaryClientCore;
import vn.svframe.bestiary.client.cobblemon.AnimationGroupCache;
import vn.svframe.bestiary.client.cobblemon.PersistentAnimationCache;
import vn.svframe.bestiary.client.config.PerformanceConfig;

import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Mixin(value = BedrockAnimationRepository.class, remap = false)
public abstract class BedrockAnimationRepositoryMixin {
    @Shadow(remap = false)
    @Final
    private static Gson gson;

    @Shadow(remap = false)
    @Final
    private static Map<String, BedrockAnimationGroup> animationGroups;

    @Inject(method = "loadAnimations", at = @At("HEAD"), cancellable = true, remap = false)
    private void bestiary$incrementalAnimations(
            ResourceManager resourceManager,
            List<String> directories,
            CallbackInfo ci
    ) {
        if (!PerformanceConfig.cobblemonAnimationIncrementalEnabled()) {
            return;
        }

        long started = System.nanoTime();
        long hashNanos = 0L;
        long memoryLookupNanos = 0L;
        long diskLookupNanos = 0L;
        long diskWriteNanos = 0L;
        long parseNanos = 0L;
        long validationNanos = 0L;
        long bytesHashed = 0L;
        int memoryHits = 0;
        int diskHits = 0;
        int parsedMisses = 0;
        int particleBoundUncached = 0;
        int validationFailedGroups = 0;
        int diskWrites = 0;
        int animationCount = 0;
        boolean validationErrors = false;

        Map<String, BedrockAnimationGroup> nextGroups = new HashMap<>();
        Set<Identifier> liveMemoryIds = new HashSet<>();

        try {
            JsonPose.Companion.registerAnimationFactory("bedrock", BedrockAnimationReferenceFactory.INSTANCE);

            for (String directory : directories) {
                Map<Identifier, Resource> resources = resourceManager.findResources(
                        directory,
                        id -> id.getPath().endsWith(".animation.json")
                );

                for (Map.Entry<Identifier, Resource> entry : resources.entrySet()) {
                    Identifier identifier = entry.getKey();

                    try {
                        byte[] bytes = entry.getValue().getInputStream().readAllBytes();
                        bytesHashed += bytes.length;

                        long hashStart = System.nanoTime();
                        byte[] hash = AnimationGroupCache.hash(bytes);
                        hashNanos += System.nanoTime() - hashStart;

                        BedrockAnimationGroup group;

                        long memoryStart = System.nanoTime();
                        group = AnimationGroupCache.find(identifier, hash);
                        memoryLookupNanos += System.nanoTime() - memoryStart;

                        if (group != null) {
                            memoryHits++;
                            liveMemoryIds.add(identifier);
                        } else {
                            long diskStart = System.nanoTime();
                            group = PersistentAnimationCache.load(hash);
                            diskLookupNanos += System.nanoTime() - diskStart;

                            if (group != null && AnimationGroupCache.isSafeToReuse(group)) {
                                diskHits++;
                                AnimationGroupCache.rememberValidated(identifier, hash, group);
                                liveMemoryIds.add(identifier);
                            } else {
                                parsedMisses++;
                                long parseStart = System.nanoTime();
                                group = gson.fromJson(
                                        new InputStreamReader(new ByteArrayInputStream(bytes), StandardCharsets.UTF_8),
                                        BedrockAnimationGroup.class
                                );
                                parseNanos += System.nanoTime() - parseStart;

                                boolean groupValidationFailed = false;
                                long validationStart = System.nanoTime();
                                for (Map.Entry<String, BedrockAnimation> animationEntry : group.getAnimations().entrySet()) {
                                    String name = animationEntry.getKey();
                                    BedrockAnimation animation = animationEntry.getValue();
                                    animation.setName(name);
                                    try {
                                        animation.checkForErrors();
                                    } catch (Throwable throwable) {
                                        BestiaryClientCore.LOGGER.error(
                                                "Cobblemon animation validation failed for {} in group {}: {}",
                                                name,
                                                identifier,
                                                throwable.getMessage()
                                        );
                                        validationErrors = true;
                                        groupValidationFailed = true;
                                    }
                                }
                                validationNanos += System.nanoTime() - validationStart;

                                if (groupValidationFailed) {
                                    validationFailedGroups++;
                                    AnimationGroupCache.remove(identifier);
                                } else if (AnimationGroupCache.isSafeToReuse(group)) {
                                    AnimationGroupCache.rememberValidated(identifier, hash, group);
                                    liveMemoryIds.add(identifier);

                                    long writeStart = System.nanoTime();
                                    if (PersistentAnimationCache.save(hash, group)) {
                                        diskWrites++;
                                    }
                                    diskWriteNanos += System.nanoTime() - writeStart;
                                } else {
                                    particleBoundUncached++;
                                    AnimationGroupCache.remove(identifier);
                                }
                            }
                        }

                        String path = identifier.getPath();
                        String file = path.substring(path.lastIndexOf('/') + 1);
                        String animationGroupName = file.substring(0, file.length() - ".animation.json".length());
                        nextGroups.put(animationGroupName, group);
                        animationCount += group.getAnimations().size();
                    } catch (Exception exception) {
                        BestiaryClientCore.LOGGER.error(
                                "Failed to load Cobblemon animation group {}",
                                identifier,
                                exception
                        );
                    }
                }
            }

            AnimationGroupCache.prune(liveMemoryIds);

            // Commit only after the full replacement generation is prepared.
            animationGroups.clear();
            animationGroups.putAll(nextGroups);

            PersistentAnimationCache.PruneResult prune = PersistentAnimationCache.pruneToBudget();

            if (validationErrors) {
                BestiaryClientCore.LOGGER.error(
                        "There were errors in Cobblemon animations. Invalid groups were deliberately not persisted."
                );
            }

            long total = System.nanoTime() - started;
            BestiaryClientCore.LOGGER.info(
                    "[Cobblemon animations v3] loaded {} animations from {} groups in {} ms; memoryHits={}, persistentHits={}, parsedMisses={}, particleBoundUncached={}, validationFailedGroups={}, persistentWrites={}, cacheGroups={}, hash={} ms ({} MiB), memoryLookup={} ms, diskLookup={} ms, parse={} ms, validate={} ms, diskWrite={} ms, diskEvicted={} ({} MiB), diskRemaining={} MiB",
                    animationCount,
                    nextGroups.size(),
                    total / 1_000_000L,
                    memoryHits,
                    diskHits,
                    parsedMisses,
                    particleBoundUncached,
                    validationFailedGroups,
                    diskWrites,
                    AnimationGroupCache.size(),
                    hashNanos / 1_000_000L,
                    bytesHashed / (1024L * 1024L),
                    memoryLookupNanos / 1_000_000L,
                    diskLookupNanos / 1_000_000L,
                    parseNanos / 1_000_000L,
                    validationNanos / 1_000_000L,
                    diskWriteNanos / 1_000_000L,
                    prune.evictedEntries(),
                    prune.evictedBytes() / (1024L * 1024L),
                    prune.remainingBytes() / (1024L * 1024L)
            );

            ci.cancel();
        } catch (Throwable throwable) {
            BestiaryClientCore.LOGGER.warn(
                    "Cobblemon compiled-cache path could not prove a safe replacement; falling back to Cobblemon's original loader for this reload.",
                    throwable
            );
        }
    }
}

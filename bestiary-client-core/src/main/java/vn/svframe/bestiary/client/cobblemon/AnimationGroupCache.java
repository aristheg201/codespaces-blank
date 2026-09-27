package vn.svframe.bestiary.client.cobblemon;

import com.cobblemon.mod.common.client.render.models.blockbench.bedrock.animation.BedrockAnimationGroup;
import com.cobblemon.mod.common.client.render.models.blockbench.bedrock.animation.BedrockParticleKeyframe;
import net.minecraft.util.Identifier;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;

public final class AnimationGroupCache {
    private static final Map<Identifier, CachedGroup> CACHE = new HashMap<>();
    private static final ThreadLocal<MessageDigest> SHA256 = ThreadLocal.withInitial(AnimationGroupCache::newSha256);

    private AnimationGroupCache() {
    }

    public static byte[] hash(byte[] bytes) {
        MessageDigest digest = SHA256.get();
        digest.reset();
        return digest.digest(bytes);
    }

    public static synchronized BedrockAnimationGroup find(Identifier id, byte[] hash) {
        CachedGroup cached = CACHE.get(id);
        if (cached == null || !Arrays.equals(cached.hash, hash)) {
            return null;
        }
        return cached.group;
    }

    public static synchronized void rememberValidated(Identifier id, byte[] hash, BedrockAnimationGroup group) {
        if (!isSafeToReuse(group)) {
            CACHE.remove(id);
            return;
        }
        CACHE.put(id, new CachedGroup(hash.clone(), group));
    }

    public static synchronized void remove(Identifier id) {
        CACHE.remove(id);
    }

    public static synchronized void prune(Set<Identifier> liveIds) {
        CACHE.keySet().removeIf(id -> !liveIds.contains(id));
    }

    public static synchronized int size() {
        return CACHE.size();
    }

    /**
     * Particle keyframes capture direct references to the particle repository at parse time.
     * Reusing those groups across a particle-resource reload could retain stale particle objects.
     */
    public static boolean isSafeToReuse(BedrockAnimationGroup group) {
        return group.getAnimations().values().stream()
                .flatMap(animation -> animation.getEffects().stream())
                .noneMatch(BedrockParticleKeyframe.class::isInstance);
    }

    private static MessageDigest newSha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    private record CachedGroup(byte[] hash, BedrockAnimationGroup group) {
    }
}

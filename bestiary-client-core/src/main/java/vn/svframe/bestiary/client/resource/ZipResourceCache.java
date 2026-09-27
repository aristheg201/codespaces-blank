package vn.svframe.bestiary.client.resource;

import net.minecraft.resource.InputSupplier;
import vn.svframe.bestiary.client.config.PerformanceConfig;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.SequenceInputStream;
import java.util.Locale;
import java.util.concurrent.atomic.LongAdder;

public final class ZipResourceCache {
    private static final LongAdder HITS = new LongAdder();
    private static final LongAdder MISSES = new LongAdder();
    private static final LongAdder BYTES_SERVED = new LongAdder();
    private static final LongAdder BYTES_CACHED = new LongAdder();
    private static final LongAdder BYPASSES = new LongAdder();
    private static final LongAdder EVICTIONS = new LongAdder();

    private ZipResourceCache() {
    }

    public static BoundedByteCache newPackCache() {
        return new BoundedByteCache(PerformanceConfig.cacheBudgetBytes());
    }

    public static boolean shouldCache(String path) {
        if (!PerformanceConfig.zipByteCacheEnabled() || path == null) return false;
        String lower = path.toLowerCase(Locale.ROOT);
        return lower.endsWith(".json")
                || lower.endsWith(".mcmeta")
                || lower.endsWith(".lang")
                || lower.endsWith(".properties")
                || lower.endsWith(".txt")
                || lower.endsWith(".csv")
                || lower.endsWith(".tsv")
                || lower.endsWith(".snbt")
                || lower.endsWith(".glsl")
                || lower.endsWith(".vsh")
                || lower.endsWith(".fsh");
    }

    public static InputStream open(
            String path,
            InputSupplier<InputStream> delegate,
            BoundedByteCache cache
    ) throws IOException {
        byte[] cached = cache.get(path);
        if (cached != null) {
            HITS.increment();
            BYTES_SERVED.add(cached.length);
            return new ByteArrayInputStream(cached);
        }

        MISSES.increment();
        InputStream input = delegate.get();
        int limit = PerformanceConfig.maxCacheEntryBytes();
        byte[] prefix;

        try {
            prefix = input.readNBytes(limit + 1);
        } catch (Throwable t) {
            try {
                input.close();
            } catch (Throwable ignored) {
            }
            throw t;
        }

        if (prefix.length <= limit) {
            input.close();
            cache.put(path, prefix);
            BYTES_CACHED.add(prefix.length);
            BYTES_SERVED.add(prefix.length);
            return new ByteArrayInputStream(prefix);
        }

        BYPASSES.increment();
        return new SequenceInputStream(new ByteArrayInputStream(prefix), input);
    }

    public static MetricsSnapshot snapshot() {
        return new MetricsSnapshot(
                HITS.sum(),
                MISSES.sum(),
                BYTES_SERVED.sum(),
                BYTES_CACHED.sum(),
                BYPASSES.sum(),
                EVICTIONS.sum()
        );
    }

    public static void recordEviction() {
        EVICTIONS.increment();
    }

    public static void resetMetrics() {
        HITS.reset();
        MISSES.reset();
        BYTES_SERVED.reset();
        BYTES_CACHED.reset();
        BYPASSES.reset();
        EVICTIONS.reset();
    }

    public record MetricsSnapshot(
            long hits,
            long misses,
            long bytesServed,
            long bytesCached,
            long bypasses,
            long evictions
    ) {
        public MetricsSnapshot minus(MetricsSnapshot previous) {
            return new MetricsSnapshot(
                    hits - previous.hits,
                    misses - previous.misses,
                    bytesServed - previous.bytesServed,
                    bytesCached - previous.bytesCached,
                    bypasses - previous.bypasses,
                    evictions - previous.evictions
            );
        }
    }
}

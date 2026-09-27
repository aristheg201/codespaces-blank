package vn.svframe.bestiary.client.profiler;

import net.minecraft.resource.ResourceReload;
import vn.svframe.bestiary.client.BestiaryClientCore;
import vn.svframe.bestiary.client.config.PerformanceConfig;
import vn.svframe.bestiary.client.resource.ZipResourceCache;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

public final class ReloadProfiler {
    private static final AtomicLong NEXT_GENERATION = new AtomicLong();
    private static final Map<Long, Session> SESSIONS = new ConcurrentHashMap<>();
    private static final ThreadLocal<Long> STARTING_GENERATION = new ThreadLocal<>();

    private ReloadProfiler() {
    }

    public static long begin(int reloaderCount) {
        long generation = NEXT_GENERATION.incrementAndGet();
        SESSIONS.put(generation, new Session(
                generation,
                System.nanoTime(),
                reloaderCount,
                ZipResourceCache.snapshot()
        ));
        STARTING_GENERATION.set(generation);
        return generation;
    }

    public static Long takeStartingGeneration() {
        Long generation = STARTING_GENERATION.get();
        STARTING_GENERATION.remove();
        return generation;
    }

    public static void record(
            long generation,
            String name,
            long totalNanos,
            long prepareNanos,
            long barrierWaitNanos,
            long prepareExecutorNanos,
            long applyExecutorNanos,
            long prepareTasks,
            long applyTasks,
            boolean failed
    ) {
        Session session = SESSIONS.get(generation);
        if (session == null) return;
        session.metrics.add(new ReloaderMetric(
                name,
                Math.max(0L, totalNanos),
                Math.max(0L, prepareNanos),
                Math.max(0L, barrierWaitNanos),
                Math.max(0L, prepareExecutorNanos),
                Math.max(0L, applyExecutorNanos),
                Math.max(0L, prepareTasks),
                Math.max(0L, applyTasks),
                failed
        ));
    }

    public static void attach(long generation, ResourceReload reload) {
        if (reload == null) {
            finish(generation, true);
            return;
        }
        reload.whenComplete().whenComplete((ignored, throwable) -> finish(generation, throwable != null));
    }

    private static void finish(long generation, boolean failed) {
        Session session = SESSIONS.remove(generation);
        if (session == null) return;

        long totalNanos = System.nanoTime() - session.startedAtNanos;
        ZipResourceCache.MetricsSnapshot cacheDelta = ZipResourceCache.snapshot().minus(session.cacheStart);

        List<ReloaderMetric> metrics = new ArrayList<>(session.metrics);
        metrics.sort(Comparator.comparingLong(ReloaderMetric::executorNanos).reversed());

        BestiaryClientCore.LOGGER.info(
                "[Reload #{}] completed in {} ms; reloaders={}/{}; failed={}; zipCache hits={}, misses={}, hitRate={}%, served={} KiB, newlyCached={} KiB, bypasses={}, evictions={}",
                generation,
                millis(totalNanos),
                metrics.size(),
                session.reloaderCount,
                failed,
                cacheDelta.hits(),
                cacheDelta.misses(),
                hitRate(cacheDelta),
                cacheDelta.bytesServed() / 1024L,
                cacheDelta.bytesCached() / 1024L,
                cacheDelta.bypasses(),
                cacheDelta.evictions()
        );

        int count = Math.min(PerformanceConfig.logTopReloaders(), metrics.size());
        for (int i = 0; i < count; i++) {
            ReloaderMetric metric = metrics.get(i);
            BestiaryClientCore.LOGGER.info(
                    "[Reload #{}] #{}/{} {} executor={} ms (prepare={} ms/{} tasks, apply={} ms/{} tasks), wall={} ms, barrier={} ms, failed={}",
                    generation,
                    i + 1,
                    count,
                    metric.name(),
                    millis(metric.executorNanos()),
                    millis(metric.prepareExecutorNanos()),
                    metric.prepareTasks(),
                    millis(metric.applyExecutorNanos()),
                    metric.applyTasks(),
                    millis(metric.totalNanos()),
                    millis(metric.barrierWaitNanos()),
                    metric.failed()
            );
        }
    }

    private static long millis(long nanos) {
        return nanos / 1_000_000L;
    }

    private static long hitRate(ZipResourceCache.MetricsSnapshot snapshot) {
        long total = snapshot.hits() + snapshot.misses();
        return total == 0L ? 0L : Math.round((snapshot.hits() * 100.0) / total);
    }

    private record Session(
            long generation,
            long startedAtNanos,
            int reloaderCount,
            ZipResourceCache.MetricsSnapshot cacheStart,
            List<ReloaderMetric> metrics
    ) {
        private Session(
                long generation,
                long startedAtNanos,
                int reloaderCount,
                ZipResourceCache.MetricsSnapshot cacheStart
        ) {
            this(generation, startedAtNanos, reloaderCount, cacheStart,
                    java.util.Collections.synchronizedList(new ArrayList<>()));
        }
    }

    private record ReloaderMetric(
            String name,
            long totalNanos,
            long prepareNanos,
            long barrierWaitNanos,
            long prepareExecutorNanos,
            long applyExecutorNanos,
            long prepareTasks,
            long applyTasks,
            boolean failed
    ) {
        long executorNanos() {
            return prepareExecutorNanos + applyExecutorNanos;
        }
    }
}

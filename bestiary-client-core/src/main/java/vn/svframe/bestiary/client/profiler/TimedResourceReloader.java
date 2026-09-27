package vn.svframe.bestiary.client.profiler;

import net.minecraft.resource.ResourceManager;
import net.minecraft.resource.ResourceReloader;
import net.minecraft.util.profiler.Profiler;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicLong;

public final class TimedResourceReloader implements ResourceReloader {
    private final long generation;
    private final ResourceReloader delegate;

    public TimedResourceReloader(long generation, ResourceReloader delegate) {
        this.generation = generation;
        this.delegate = delegate;
    }

    @Override
    public CompletableFuture<Void> reload(
            Synchronizer synchronizer,
            ResourceManager manager,
            Profiler prepareProfiler,
            Profiler applyProfiler,
            Executor prepareExecutor,
            Executor applyExecutor
    ) {
        long started = System.nanoTime();
        AtomicLong preparedAt = new AtomicLong(-1L);
        AtomicLong barrierReleasedAt = new AtomicLong(-1L);

        Synchronizer timedSynchronizer = new Synchronizer() {
            @Override
            public <T> CompletableFuture<T> whenPrepared(T preparedObject) {
                long prepared = System.nanoTime();
                preparedAt.compareAndSet(-1L, prepared);

                CompletableFuture<T> original = synchronizer.whenPrepared(preparedObject);
                original.whenComplete((ignored, throwable) ->
                        barrierReleasedAt.compareAndSet(-1L, System.nanoTime()));
                return original;
            }
        };

        CompletableFuture<Void> future;
        try {
            future = delegate.reload(
                    timedSynchronizer,
                    manager,
                    prepareProfiler,
                    applyProfiler,
                    prepareExecutor,
                    applyExecutor
            );
        } catch (Throwable throwable) {
            long now = System.nanoTime();
            ReloadProfiler.record(
                    generation,
                    getName(),
                    now - started,
                    durationTo(started, preparedAt.get(), now),
                    barrierDuration(preparedAt.get(), barrierReleasedAt.get(), now),
                    true
            );
            throw throwable;
        }

        future.whenComplete((ignored, throwable) -> {
            long finished = System.nanoTime();
            ReloadProfiler.record(
                    generation,
                    getName(),
                    finished - started,
                    durationTo(started, preparedAt.get(), finished),
                    barrierDuration(preparedAt.get(), barrierReleasedAt.get(), finished),
                    throwable != null
            );
        });

        return future;
    }

    @Override
    public String getName() {
        return delegate.getName();
    }

    private static long durationTo(long started, long marker, long fallbackEnd) {
        return (marker >= started ? marker : fallbackEnd) - started;
    }

    private static long barrierDuration(long prepared, long barrierReleased, long fallbackEnd) {
        if (prepared < 0L) return 0L;
        long end = barrierReleased >= prepared ? barrierReleased : fallbackEnd;
        return end - prepared;
    }
}

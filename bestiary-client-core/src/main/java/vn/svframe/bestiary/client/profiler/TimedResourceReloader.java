package vn.svframe.bestiary.client.profiler;

import net.minecraft.resource.ResourceManager;
import net.minecraft.resource.ResourceReloader;
import net.minecraft.util.profiler.Profiler;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;

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
        TimedExecutor timedPrepare = new TimedExecutor(prepareExecutor);
        TimedExecutor timedApply = new TimedExecutor(applyExecutor);

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
                    timedPrepare,
                    timedApply
            );
        } catch (Throwable throwable) {
            long now = System.nanoTime();
            ReloadProfiler.record(
                    generation,
                    getName(),
                    now - started,
                    durationTo(started, preparedAt.get(), now),
                    barrierDuration(preparedAt.get(), barrierReleasedAt.get(), now),
                    timedPrepare.elapsedNanos(),
                    timedApply.elapsedNanos(),
                    timedPrepare.taskCount(),
                    timedApply.taskCount(),
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
                    timedPrepare.elapsedNanos(),
                    timedApply.elapsedNanos(),
                    timedPrepare.taskCount(),
                    timedApply.taskCount(),
                    throwable != null
            );
        });

        return future;
    }

    @Override
    public String getName() {
        String name = delegate.getName();
        if (name == null || name.isBlank()) {
            return delegate.getClass().getName();
        }
        return name + " [" + delegate.getClass().getName() + "]";
    }

    private static long durationTo(long started, long marker, long fallbackEnd) {
        return (marker >= started ? marker : fallbackEnd) - started;
    }

    private static long barrierDuration(long prepared, long barrierReleased, long fallbackEnd) {
        if (prepared < 0L) return 0L;
        long end = barrierReleased >= prepared ? barrierReleased : fallbackEnd;
        return end - prepared;
    }

    private static final class TimedExecutor implements Executor {
        private final Executor delegate;
        private final LongAdder elapsedNanos = new LongAdder();
        private final LongAdder tasks = new LongAdder();

        private TimedExecutor(Executor delegate) {
            this.delegate = delegate;
        }

        @Override
        public void execute(Runnable command) {
            delegate.execute(() -> {
                long start = System.nanoTime();
                try {
                    command.run();
                } finally {
                    elapsedNanos.add(System.nanoTime() - start);
                    tasks.increment();
                }
            });
        }

        long elapsedNanos() {
            return elapsedNanos.sum();
        }

        long taskCount() {
            return tasks.sum();
        }
    }
}

package vn.svframe.bestiary.client;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import vn.svframe.bestiary.client.cobblemon.PersistentAnimationCache;
import vn.svframe.bestiary.client.config.PerformanceConfig;
import vn.svframe.bestiary.client.resource.ZipResourceCache;

public final class BestiaryClientCore implements ClientModInitializer {
    public static final String MOD_ID = "bestiary_client_core";
    public static final Logger LOGGER = LoggerFactory.getLogger("BestiaryClientCore");

    @Override
    public void onInitializeClient() {
        PerformanceConfig.load();
        ZipResourceCache.resetMetrics();

        String version = FabricLoader.getInstance()
                .getModContainer(MOD_ID)
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("unknown");

        LOGGER.info(
                "Bestiary Client Core {} initialized. Lossless mode: zipByteCache={}, persistentCompiledCache={}, cobblemonAnimationIncremental={}, reloadProfiler={}, ramCacheBudget={} MiB, persistentBudget={} MiB",
                version,
                PerformanceConfig.zipByteCacheEnabled(),
                PerformanceConfig.persistentCompiledCacheEnabled(),
                PerformanceConfig.cobblemonAnimationIncrementalEnabled(),
                PerformanceConfig.reloadProfilerEnabled(),
                PerformanceConfig.cacheBudgetBytes() / (1024L * 1024L),
                PerformanceConfig.persistentCacheBudgetBytes() / (1024L * 1024L)
        );

        if (PerformanceConfig.persistentCompiledCacheEnabled()) {
            LOGGER.info(
                    "Bestiary compiled-cache schema={} environment={} directory={}",
                    PersistentAnimationCache.SCHEMA_VERSION,
                    PersistentAnimationCache.environmentIdShort(),
                    PersistentAnimationCache.cacheDirectory()
            );
        }
    }
}

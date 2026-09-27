package vn.svframe.bestiary.client.config;

import net.fabricmc.loader.api.FabricLoader;
import vn.svframe.bestiary.client.BestiaryClientCore;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

public final class PerformanceConfig {
    private static final String FILE_NAME = "bestiary-client-core.properties";

    private static volatile boolean zipByteCache = true;
    private static volatile boolean reloadProfiler = true;
    private static volatile boolean cobblemonAnimationIncremental = true;
    private static volatile boolean persistentCompiledCache = true;
    private static volatile int configuredCacheMiB = 0;
    private static volatile int persistentCacheMiB = 512;
    private static volatile int maxEntryKiB = 1024;
    private static volatile int logTopReloaders = 12;

    private PerformanceConfig() {
    }

    public static void load() {
        Path path = FabricLoader.getInstance().getConfigDir().resolve(FILE_NAME);
        Properties properties = new Properties();

        if (Files.isRegularFile(path)) {
            try (InputStream input = Files.newInputStream(path)) {
                properties.load(input);
            } catch (IOException e) {
                BestiaryClientCore.LOGGER.warn("Unable to read {}; using safe defaults", path, e);
            }
        }

        zipByteCache = readBoolean(properties, "zipByteCache", true);
        reloadProfiler = readBoolean(properties, "reloadProfiler", true);
        cobblemonAnimationIncremental = readBoolean(properties, "cobblemonAnimationIncremental", true);
        persistentCompiledCache = readBoolean(properties, "persistentCompiledCache", true);
        configuredCacheMiB = clamp(readInt(properties, "maxCacheMiB", 0), 0, 512);
        persistentCacheMiB = clamp(readInt(properties, "persistentCacheMiB", 512), 64, 4096);
        maxEntryKiB = clamp(readInt(properties, "maxEntryKiB", 1024), 64, 8192);
        logTopReloaders = clamp(readInt(properties, "logTopReloaders", 12), 1, 64);

        if (!Files.exists(path)) {
            properties.setProperty("zipByteCache", Boolean.toString(zipByteCache));
            properties.setProperty("reloadProfiler", Boolean.toString(reloadProfiler));
            properties.setProperty("cobblemonAnimationIncremental", Boolean.toString(cobblemonAnimationIncremental));
            properties.setProperty("persistentCompiledCache", Boolean.toString(persistentCompiledCache));
            properties.setProperty("maxCacheMiB", Integer.toString(configuredCacheMiB));
            properties.setProperty("persistentCacheMiB", Integer.toString(persistentCacheMiB));
            properties.setProperty("maxEntryKiB", Integer.toString(maxEntryKiB));
            properties.setProperty("logTopReloaders", Integer.toString(logTopReloaders));

            try {
                Files.createDirectories(path.getParent());
                try (OutputStream output = Files.newOutputStream(path)) {
                    properties.store(output,
                            "Bestiary Client Core lossless performance settings. maxCacheMiB=0 selects a safe heap-aware RAM budget.");
                }
            } catch (IOException e) {
                BestiaryClientCore.LOGGER.warn("Unable to create default config {}", path, e);
            }
        }
    }

    public static boolean zipByteCacheEnabled() {
        return zipByteCache;
    }

    public static boolean reloadProfilerEnabled() {
        return reloadProfiler;
    }

    public static boolean cobblemonAnimationIncrementalEnabled() {
        return cobblemonAnimationIncremental;
    }

    public static boolean persistentCompiledCacheEnabled() {
        return persistentCompiledCache;
    }

    public static long cacheBudgetBytes() {
        int mib = configuredCacheMiB > 0 ? configuredCacheMiB : autoCacheMiB();
        return mib * 1024L * 1024L;
    }

    public static long persistentCacheBudgetBytes() {
        return persistentCacheMiB * 1024L * 1024L;
    }

    public static int maxCacheEntryBytes() {
        return maxEntryKiB * 1024;
    }

    public static int logTopReloaders() {
        return logTopReloaders;
    }

    private static int autoCacheMiB() {
        long heapMiB = Runtime.getRuntime().maxMemory() / (1024L * 1024L);
        if (heapMiB <= 2560) return 24;
        if (heapMiB <= 3328) return 32;
        if (heapMiB <= 4352) return 48;
        if (heapMiB <= 6144) return 64;
        return 96;
    }

    private static boolean readBoolean(Properties properties, String key, boolean fallback) {
        String value = properties.getProperty(key);
        return value == null ? fallback : Boolean.parseBoolean(value.trim());
    }

    private static int readInt(Properties properties, String key, int fallback) {
        String value = properties.getProperty(key);
        if (value == null) return fallback;
        try {
            return Integer.parseInt(value.trim());
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }
}

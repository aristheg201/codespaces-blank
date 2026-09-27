package vn.svframe.bestiary.client.cobblemon;

import com.cobblemon.mod.common.client.render.models.blockbench.bedrock.animation.BedrockAnimationGroup;
import com.esotericsoftware.kryo.Kryo;
import com.esotericsoftware.kryo.Serializer;
import com.esotericsoftware.kryo.io.Input;
import com.esotericsoftware.kryo.io.Output;
import com.esotericsoftware.kryo.util.DefaultInstantiatorStrategy;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.util.Identifier;
import org.objenesis.strategy.StdInstantiatorStrategy;
import vn.svframe.bestiary.client.BestiaryClientCore;
import vn.svframe.bestiary.client.config.PerformanceConfig;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.DirectoryStream;
import java.nio.file.attribute.FileTime;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.List;
import java.util.zip.CRC32;

public final class PersistentAnimationCache {
    public static final int SCHEMA_VERSION = 3;

    private static final int MAGIC = 0x42534333; // BSC3
    private static final int MAX_PAYLOAD_BYTES = 64 * 1024 * 1024;
    private static final HexFormat HEX = HexFormat.of();
    private static final byte[] ENVIRONMENT_ID = buildEnvironmentId();
    private static final ThreadLocal<Kryo> KRYO = ThreadLocal.withInitial(PersistentAnimationCache::newKryo);

    private PersistentAnimationCache() {
    }

    public static Path cacheDirectory() {
        return FabricLoader.getInstance()
                .getGameDir()
                .resolve(".bestiary")
                .resolve("cache")
                .resolve("compiled")
                .resolve("animations")
                .resolve("v" + SCHEMA_VERSION);
    }

    public static String environmentIdShort() {
        return HEX.formatHex(ENVIRONMENT_ID, 0, 8);
    }

    public static BedrockAnimationGroup load(byte[] contentHash) {
        if (!PerformanceConfig.persistentCompiledCacheEnabled()) return null;

        Path path = pathFor(contentHash);
        if (!Files.isRegularFile(path)) return null;

        try (DataInputStream input = new DataInputStream(new BufferedInputStream(Files.newInputStream(path)))) {
            if (input.readInt() != MAGIC) return reject(path, "magic");
            if (input.readInt() != SCHEMA_VERSION) return reject(path, "schema");

            byte[] environment = input.readNBytes(ENVIRONMENT_ID.length);
            if (!MessageDigest.isEqual(environment, ENVIRONMENT_ID)) return reject(path, "environment");

            byte[] storedHash = input.readNBytes(contentHash.length);
            if (!MessageDigest.isEqual(storedHash, contentHash)) return reject(path, "content hash");

            int payloadLength = input.readInt();
            if (payloadLength <= 0 || payloadLength > MAX_PAYLOAD_BYTES) return reject(path, "payload length");

            long expectedCrc = input.readLong();
            byte[] payload = input.readNBytes(payloadLength);
            if (payload.length != payloadLength) return reject(path, "truncated payload");

            CRC32 crc = new CRC32();
            crc.update(payload);
            if (crc.getValue() != expectedCrc) return reject(path, "payload checksum");

            Kryo kryo = KRYO.get();
            try (Input kryoInput = new Input(new ByteArrayInputStream(payload))) {
                Object decoded = kryo.readClassAndObject(kryoInput);
                if (!(decoded instanceof BedrockAnimationGroup group)) {
                    return reject(path, "decoded type");
                }

                touch(path);
                return group;
            }
        } catch (Throwable throwable) {
            BestiaryClientCore.LOGGER.debug("Ignoring invalid compiled animation cache {}", path, throwable);
            deleteQuietly(path);
            return null;
        }
    }

    public static boolean save(byte[] contentHash, BedrockAnimationGroup group) {
        if (!PerformanceConfig.persistentCompiledCacheEnabled()) return false;
        if (!AnimationGroupCache.isSafeToReuse(group)) return false;

        try {
            byte[] payload = serialize(group);
            if (payload.length <= 0 || payload.length > MAX_PAYLOAD_BYTES) return false;

            Path destination = pathFor(contentHash);
            Files.createDirectories(destination.getParent());

            // Avoid rewriting an already valid content-addressed entry.
            if (Files.isRegularFile(destination)) {
                return true;
            }

            CRC32 crc = new CRC32();
            crc.update(payload);

            Path temp = Files.createTempFile(destination.getParent(), destination.getFileName().toString(), ".tmp");
            boolean committed = false;
            try {
                try (DataOutputStream output = new DataOutputStream(new BufferedOutputStream(Files.newOutputStream(temp)))) {
                    output.writeInt(MAGIC);
                    output.writeInt(SCHEMA_VERSION);
                    output.write(ENVIRONMENT_ID);
                    output.write(contentHash);
                    output.writeInt(payload.length);
                    output.writeLong(crc.getValue());
                    output.write(payload);
                }

                try {
                    Files.move(temp, destination, StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException ignored) {
                    Files.move(temp, destination);
                }
                committed = true;
                return true;
            } finally {
                if (!committed) deleteQuietly(temp);
            }
        } catch (Throwable throwable) {
            BestiaryClientCore.LOGGER.debug("Unable to write compiled animation cache", throwable);
            return false;
        }
    }

    public static PruneResult pruneToBudget() {
        if (!PerformanceConfig.persistentCompiledCacheEnabled()) {
            return new PruneResult(0, 0L, 0L);
        }

        Path root = cacheDirectory();
        if (!Files.isDirectory(root)) return new PruneResult(0, 0L, 0L);

        long budget = PerformanceConfig.persistentCacheBudgetBytes();
        List<Entry> entries = new ArrayList<>();
        long total = 0L;

        try (DirectoryStream<Path> shards = Files.newDirectoryStream(root)) {
            for (Path shard : shards) {
                if (!Files.isDirectory(shard)) continue;
                try (DirectoryStream<Path> files = Files.newDirectoryStream(shard, "*.bca")) {
                    for (Path file : files) {
                        try {
                            long size = Files.size(file);
                            FileTime modified = Files.getLastModifiedTime(file);
                            entries.add(new Entry(file, size, modified.toMillis()));
                            total += size;
                        } catch (IOException ignored) {
                        }
                    }
                }
            }
        } catch (IOException e) {
            return new PruneResult(0, 0L, total);
        }

        if (total <= budget) return new PruneResult(0, 0L, total);

        entries.sort(Comparator.comparingLong(Entry::lastModifiedMillis));
        int evicted = 0;
        long bytesEvicted = 0L;

        for (Entry entry : entries) {
            if (total <= budget) break;
            try {
                Files.deleteIfExists(entry.path);
                total -= entry.size;
                bytesEvicted += entry.size;
                evicted++;
            } catch (IOException ignored) {
            }
        }

        return new PruneResult(evicted, bytesEvicted, total);
    }

    private static byte[] serialize(BedrockAnimationGroup group) {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream(32 * 1024);
        try (Output output = new Output(bytes)) {
            KRYO.get().writeClassAndObject(output, group);
            output.flush();
            return bytes.toByteArray();
        }
    }

    private static Kryo newKryo() {
        Kryo kryo = new Kryo();
        kryo.setRegistrationRequired(false);
        kryo.setReferences(true);
        kryo.setWarnUnregisteredClasses(false);
        kryo.setInstantiatorStrategy(new DefaultInstantiatorStrategy(new StdInstantiatorStrategy()));

        kryo.register(Identifier.class, new Serializer<Identifier>() {
            @Override
            public void write(Kryo kryo, Output output, Identifier identifier) {
                output.writeString(identifier.toString());
            }

            @Override
            public Identifier read(Kryo kryo, Input input, Class<? extends Identifier> type) {
                return Identifier.of(input.readString());
            }
        });

        return kryo;
    }

    private static byte[] buildEnvironmentId() {
        String minecraft = versionOf("minecraft");
        String cobblemon = versionOf("cobblemon");
        String javaVersion = System.getProperty("java.specification.version", "unknown");
        String descriptor = "schema=" + SCHEMA_VERSION
                + "\nminecraft=" + minecraft
                + "\ncobblemon=" + cobblemon
                + "\njava=" + java
                + "\nkryo=5.6.2";

        try {
            return MessageDigest.getInstance("SHA-256")
                    .digest(descriptor.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    private static String versionOf(String modId) {
        return FabricLoader.getInstance()
                .getModContainer(modId)
                .map(container -> container.getMetadata().getVersion().getFriendlyString())
                .orElse("missing");
    }

    private static Path pathFor(byte[] hash) {
        String hex = HEX.formatHex(hash);
        return cacheDirectory().resolve(hex.substring(0, 2)).resolve(hex + ".bca");
    }

    private static BedrockAnimationGroup reject(Path path, String reason) {
        BestiaryClientCore.LOGGER.debug("Dropping compiled animation cache {} because {} mismatched", path, reason);
        deleteQuietly(path);
        return null;
    }

    private static void touch(Path path) {
        try {
            Files.setLastModifiedTime(path, FileTime.fromMillis(System.currentTimeMillis()));
        } catch (IOException ignored) {
        }
    }

    private static void deleteQuietly(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException ignored) {
        }
    }

    private record Entry(Path path, long size, long lastModifiedMillis) {
    }

    public record PruneResult(int evictedEntries, long evictedBytes, long remainingBytes) {
    }
}

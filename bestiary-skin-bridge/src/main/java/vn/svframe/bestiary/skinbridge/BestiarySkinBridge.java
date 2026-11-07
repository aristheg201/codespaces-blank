package vn.svframe.bestiary.skinbridge;

import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.fabricmc.fabric.api.networking.v1.ServerPlayNetworking;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.text.Text;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.imageio.ImageIO;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

public final class BestiarySkinBridge implements ModInitializer {
    private static final Logger LOGGER = LoggerFactory.getLogger("BestiarySkinBridge");
    private static final long MIN_INTERVAL_MS = Duration.ofSeconds(60).toMillis();
    private static final Map<UUID, Long> LAST_UPLOAD = new ConcurrentHashMap<>();
    private static final Map<UUID, String> LAST_HASH = new ConcurrentHashMap<>();

    @Override public void onInitialize() {
        PayloadTypeRegistry.playC2S().register(SkinPayload.ID, SkinPayload.CODEC);
        ServerPlayNetworking.registerGlobalReceiver(SkinPayload.ID, (payload, context) -> {
            ServerPlayerEntity player = context.player();
            MinecraftServer server = player.getServer();
            if (server == null || payload.protocol() != SkinPayload.PROTOCOL) return;
            if ("reset".equals(payload.action())) {
                server.execute(() -> resetSkin(server, player));
                return;
            }
            if (!"apply".equals(payload.action())) return;
            final byte[] png = payload.png().clone();
            final String variant = "slim".equalsIgnoreCase(payload.variant()) ? "slim" : "classic";
            final String declaredHash = payload.sha256();
            if (!validateImage(png)) {
                player.sendMessage(Text.literal("[Bestiary] Skin không hợp lệ. Chỉ nhận PNG 64x64 hoặc 64x32 dưới 1 MB."), false);
                return;
            }
            String actualHash = sha256(png);
            if (!declaredHash.isBlank() && !MessageDigest.isEqual(actualHash.getBytes(), declaredHash.toLowerCase().getBytes())) {
                player.sendMessage(Text.literal("[Bestiary] Skin bị từ chối vì SHA-256 không khớp."), false);
                return;
            }
            UUID uuid = player.getUuid();
            if (actualHash.equals(LAST_HASH.get(uuid))) return;
            long now = System.currentTimeMillis();
            long last = LAST_UPLOAD.getOrDefault(uuid, 0L);
            if (now - last < MIN_INTERVAL_MS) {
                player.sendMessage(Text.literal("[Bestiary] Vui lòng chờ trước khi đổi skin lần nữa."), false);
                return;
            }
            LAST_UPLOAD.put(uuid, now);
            CompletableFuture.runAsync(() -> {
                try {
                    SignedTexture texture = uploadMineSkin(png, variant, player.getGameProfile().getName());
                    server.execute(() -> {
                        try {
                            applySkin(server, player, variant, actualHash, texture);
                            LAST_HASH.put(uuid, actualHash);
                            player.sendMessage(Text.literal("[Bestiary] Đã áp dụng skin từ Launcher."), false);
                        } catch (Exception e) {
                            LOGGER.error("Unable to apply uploaded skin for {}", player.getGameProfile().getName(), e);
                            player.sendMessage(Text.literal("[Bestiary] Không thể áp dụng skin trên server."), false);
                        }
                    });
                } catch (Exception e) {
                    LOGGER.error("MineSkin upload failed for {}", player.getGameProfile().getName(), e);
                    server.execute(() -> player.sendMessage(Text.literal("[Bestiary] Dịch vụ skin tạm thời không khả dụng."), false));
                }
            });
        });
    }

    private static boolean validateImage(byte[] png) {
        if (png.length < 24 || png.length > SkinPayload.MAX_BYTES) return false;
        try {
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(png));
            return image != null && image.getWidth() == 64 && (image.getHeight() == 64 || image.getHeight() == 32);
        } catch (Exception e) { return false; }
    }

    private static String sha256(byte[] data) {
        try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data)); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }

    private static SignedTexture uploadMineSkin(byte[] png, String variant, String name) throws Exception {
        Class<?> skinRestorer = Class.forName("net.lionarius.skinrestorer.SkinRestorer");
        Object config = skinRestorer.getMethod("getConfig").invoke(null);
        Object providers = config.getClass().getMethod("providersConfig").invoke(config);
        Object mineskin = providers.getClass().getMethod("mineskin").invoke(providers);
        String apiKey = String.valueOf(mineskin.getClass().getMethod("apiKey").invoke(mineskin));
        if (apiKey.isBlank()) throw new IllegalStateException("SkinRestorer MineSkin API key is not configured");

        Class<?> clientClass = Class.forName("org.mineskin.MineSkinClient");
        Object builder = clientClass.getMethod("builder").invoke(null);
        builder.getClass().getMethod("userAgent", String.class).invoke(builder, "BestiarySkinBridge/1.0.0");
        builder.getClass().getMethod("apiKey", String.class).invoke(builder, apiKey);

        Class<?> handlerCtorType = Class.forName("org.mineskin.request.RequestHandlerConstructor");
        Class<?> handlerClass = Class.forName("net.lionarius.skinrestorer.mineskin.Java11RequestHandler");
        Object handlerCtor = Proxy.newProxyInstance(handlerCtorType.getClassLoader(), new Class<?>[]{handlerCtorType}, (proxy, method, args) -> {
            if (!"construct".equals(method.getName())) return null;
            Constructor<?> ctor = Arrays.stream(handlerClass.getConstructors()).filter(c -> c.getParameterCount() == 6).findFirst().orElseThrow();
            return ctor.newInstance(args[0], args[1], args[2], args[3], args[4], null);
        });
        builder.getClass().getMethod("requestHandler", handlerCtorType).invoke(builder, handlerCtor);
        Object client = builder.getClass().getMethod("build").invoke(builder);

        Class<?> requestClass = Class.forName("org.mineskin.request.GenerateRequest");
        Object request = requestClass.getMethod("upload", java.io.InputStream.class).invoke(null, new ByteArrayInputStream(png));
        Class<?> variantClass = Class.forName("org.mineskin.data.Variant");
        @SuppressWarnings({"rawtypes", "unchecked"}) Object variantValue = Enum.valueOf((Class<? extends Enum>) variantClass, "slim".equals(variant) ? "SLIM" : "CLASSIC");
        request = requestClass.getMethod("variant", variantClass).invoke(request, variantValue);
        request = requestClass.getMethod("name", String.class).invoke(request, "Bestiary " + name);

        Object queue = clientClass.getMethod("queue").invoke(client);
        Object queueResponse = ((CompletableFuture<?>) queue.getClass().getMethod("submit", requestClass).invoke(queue, request)).get(45, TimeUnit.SECONDS);
        Object job = queueResponse.getClass().getMethod("getJob").invoke(queueResponse);
        Object jobRef = ((CompletableFuture<?>) job.getClass().getMethod("waitForCompletion", clientClass).invoke(job, client)).get(60, TimeUnit.SECONDS);
        Object skinInfo = ((CompletableFuture<?>) jobRef.getClass().getMethod("getOrLoadSkin", clientClass).invoke(jobRef, client)).get(30, TimeUnit.SECONDS);
        Object textureInfo = skinInfo.getClass().getMethod("texture").invoke(skinInfo);
        Object data = textureInfo.getClass().getMethod("data").invoke(textureInfo);
        String value = String.valueOf(data.getClass().getMethod("value").invoke(data));
        String signature = String.valueOf(data.getClass().getMethod("signature").invoke(data));
        if (value.isBlank() || signature.isBlank()) throw new IllegalStateException("MineSkin returned unsigned texture");
        return new SignedTexture(value, signature);
    }

    private static void applySkin(MinecraftServer server, ServerPlayerEntity player, String variant, String hash, SignedTexture texture) throws Exception {
        Class<?> sr = Class.forName("net.lionarius.skinrestorer.SkinRestorer");
        Object storage = sr.getMethod("getSkinStorage").invoke(null);
        Class<?> propertyClass = Class.forName("com.mojang.authlib.properties.Property");
        Object property = propertyClass.getConstructor(String.class, String.class, String.class).newInstance("textures", texture.value(), texture.signature());
        Class<?> variantClass = Class.forName("net.lionarius.skinrestorer.skin.SkinVariant");
        @SuppressWarnings({"rawtypes", "unchecked"}) Object variantValue = Enum.valueOf((Class<? extends Enum>) variantClass, "slim".equals(variant) ? "SLIM" : "CLASSIC");
        Class<?> skinValueClass = Class.forName("net.lionarius.skinrestorer.skin.SkinValue");
        Constructor<?> ctor = Arrays.stream(skinValueClass.getConstructors()).filter(c -> c.getParameterCount() == 4).findFirst().orElseThrow();
        Object skinValue = ctor.newInstance("mineskin", hash, variantValue, property);
        storage.getClass().getMethod("setSkin", UUID.class, skinValueClass).invoke(storage, player.getUuid(), skinValue);
        Method apply = Arrays.stream(sr.getMethods()).filter(m -> m.getName().equals("applySkin") && m.getParameterCount() == 4).findFirst().orElseThrow();
        apply.invoke(null, server, List.of(player.getGameProfile()), skinValue, true);
    }

    private static void resetSkin(MinecraftServer server, ServerPlayerEntity player) {
        try {
            Class<?> sr = Class.forName("net.lionarius.skinrestorer.SkinRestorer");
            Object storage = sr.getMethod("getSkinStorage").invoke(null);
            storage.getClass().getMethod("deleteSkin", UUID.class).invoke(storage, player.getUuid());
            Class<?> skinValueClass = Class.forName("net.lionarius.skinrestorer.skin.SkinValue");
            Object empty = skinValueClass.getField("EMPTY").get(null);
            Method apply = Arrays.stream(sr.getMethods()).filter(m -> m.getName().equals("applySkin") && m.getParameterCount() == 4).findFirst().orElseThrow();
            apply.invoke(null, server, List.of(player.getGameProfile()), empty, true);
            LAST_HASH.remove(player.getUuid());
            player.sendMessage(Text.literal("[Bestiary] Đã reset skin Bestiary."), false);
        } catch (Exception e) {
            LOGGER.error("Unable to reset skin for {}", player.getGameProfile().getName(), e);
            player.sendMessage(Text.literal("[Bestiary] Không thể reset skin."), false);
        }
    }

    private record SignedTexture(String value, String signature) {}
}

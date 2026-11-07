package vn.svframe.bestiary.skinbridge;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayNetworking;
import net.fabricmc.loader.api.FabricLoader;

import java.nio.file.Files;
import java.nio.file.Path;

public final class BestiarySkinBridgeClient implements ClientModInitializer {
    @Override public void onInitializeClient() {
        ClientPlayConnectionEvents.JOIN.register((handler, sender, client) -> client.execute(BestiarySkinBridgeClient::sendPreference));
    }

    private static void sendPreference() {
        try {
            if (!ClientPlayNetworking.canSend(SkinPayload.ID)) return;
            Path dir = FabricLoader.getInstance().getGameDir().resolve(".bestiary");
            Path meta = dir.resolve("player-skin.json");
            if (!Files.isRegularFile(meta)) return;
            JsonObject json = JsonParser.parseString(Files.readString(meta)).getAsJsonObject();
            String action = json.has("action") ? json.get("action").getAsString() : "apply";
            if ("reset".equals(action)) {
                ClientPlayNetworking.send(new SkinPayload(SkinPayload.PROTOCOL, "reset", "classic", "", new byte[0]));
                return;
            }
            Path png = dir.resolve("player-skin.png");
            if (!Files.isRegularFile(png)) return;
            byte[] data = Files.readAllBytes(png);
            if (data.length == 0 || data.length > SkinPayload.MAX_BYTES) return;
            String variant = json.has("variant") ? json.get("variant").getAsString() : "classic";
            String sha = json.has("sha256") ? json.get("sha256").getAsString() : "";
            ClientPlayNetworking.send(new SkinPayload(SkinPayload.PROTOCOL, "apply", variant, sha, data));
        } catch (Exception ignored) {
            // Skin sync is optional and must never block joining a server.
        }
    }
}

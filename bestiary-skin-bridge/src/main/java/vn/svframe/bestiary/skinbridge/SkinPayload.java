package vn.svframe.bestiary.skinbridge;

import net.minecraft.network.PacketByteBuf;
import net.minecraft.network.codec.PacketCodec;
import net.minecraft.network.packet.CustomPayload;
import net.minecraft.util.Identifier;

public record SkinPayload(int protocol, String action, String variant, String sha256, byte[] png) implements CustomPayload {
    public static final int PROTOCOL = 1;
    public static final int MAX_BYTES = 1024 * 1024;
    public static final Id<SkinPayload> ID = new Id<>(Identifier.of("bestiary", "skin_upload"));
    public static final PacketCodec<PacketByteBuf, SkinPayload> CODEC = PacketCodec.of(
        (value, buf) -> {
            buf.writeVarInt(value.protocol());
            buf.writeString(value.action(), 8);
            buf.writeString(value.variant(), 8);
            buf.writeString(value.sha256(), 64);
            buf.writeByteArray(value.png());
        },
        buf -> new SkinPayload(
            buf.readVarInt(),
            buf.readString(8),
            buf.readString(8),
            buf.readString(64),
            buf.readByteArray(MAX_BYTES)
        )
    );

    @Override public Id<? extends CustomPayload> getId() { return ID; }
}

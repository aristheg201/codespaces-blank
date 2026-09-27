package vn.svframe.bestiary.client.mixin;

import net.minecraft.resource.InputSupplier;
import net.minecraft.resource.ZipResourcePack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import vn.svframe.bestiary.client.resource.BoundedByteCache;
import vn.svframe.bestiary.client.resource.ZipResourceCache;

import java.io.InputStream;

@Mixin(ZipResourcePack.class)
abstract class ZipResourcePackMixin {
    @Unique
    private BoundedByteCache bestiary$byteCache;

    @Inject(method = "openFile", at = @At("RETURN"), cancellable = true)
    private void bestiary$cacheSmallStructuralResources(
            String path,
            CallbackInfoReturnable<InputSupplier<InputStream>> cir
    ) {
        if (!ZipResourceCache.shouldCache(path)) return;

        InputSupplier<InputStream> original = cir.getReturnValue();
        if (original == null) return;

        BoundedByteCache cache = bestiary$getOrCreateCache();
        cir.setReturnValue(() -> ZipResourceCache.open(path, original, cache));
    }

    @Inject(method = "close", at = @At("HEAD"))
    private void bestiary$clearPackCache(CallbackInfo ci) {
        if (bestiary$byteCache != null) {
            bestiary$byteCache.clear();
            bestiary$byteCache = null;
        }
    }

    @Unique
    private BoundedByteCache bestiary$getOrCreateCache() {
        BoundedByteCache cache = bestiary$byteCache;
        if (cache == null) {
            cache = ZipResourceCache.newPackCache();
            bestiary$byteCache = cache;
        }
        return cache;
    }
}

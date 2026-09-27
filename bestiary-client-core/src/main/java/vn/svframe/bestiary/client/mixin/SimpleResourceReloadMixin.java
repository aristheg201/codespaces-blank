package vn.svframe.bestiary.client.mixin;

import net.minecraft.resource.ResourceReload;
import net.minecraft.resource.ResourceReloader;
import net.minecraft.resource.SimpleResourceReload;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.ModifyVariable;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import vn.svframe.bestiary.client.config.PerformanceConfig;
import vn.svframe.bestiary.client.profiler.ReloadProfiler;
import vn.svframe.bestiary.client.profiler.TimedResourceReloader;

import java.util.ArrayList;
import java.util.List;

@Mixin(SimpleResourceReload.class)
abstract class SimpleResourceReloadMixin {
    @ModifyVariable(method = "start", at = @At("HEAD"), argsOnly = true, index = 1)
    private static List<ResourceReloader> bestiary$wrapReloaders(List<ResourceReloader> reloaders) {
        if (!PerformanceConfig.reloadProfilerEnabled()) return reloaders;

        long generation = ReloadProfiler.begin(reloaders.size());
        List<ResourceReloader> wrapped = new ArrayList<>(reloaders.size());
        for (ResourceReloader reloader : reloaders) {
            wrapped.add(new TimedResourceReloader(generation, reloader));
        }
        return wrapped;
    }

    @Inject(method = "start", at = @At("RETURN"))
    private static void bestiary$attachCompletion(
            CallbackInfoReturnable<ResourceReload> cir
    ) {
        if (!PerformanceConfig.reloadProfilerEnabled()) return;

        Long generation = ReloadProfiler.takeStartingGeneration();
        if (generation != null) {
            ReloadProfiler.attach(generation, cir.getReturnValue());
        }
    }
}

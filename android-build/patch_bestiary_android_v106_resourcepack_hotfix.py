from pathlib import Path

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'
RES = APP / 'src/main/res'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


# ---------------------------------------------------------------------------
# Bestiary Android 1.0.6 resource-pack stability hardening.
#
# Server resource packs can have a small ZIP size while expanding into hundreds
# of MiB of decoded RGBA data. During ResourceManager reload, old and new
# resources can overlap transiently and texture staging/native driver memory can
# dominate the process. The safety policy therefore targets native/GPU headroom,
# not just Java heap size, and applies to every renderer by default.
# ---------------------------------------------------------------------------
profile = JAVA / 'BestiaryPerformanceProfile.java'
s = profile.read_text(encoding='utf-8')
req('private static final int REVISION = 6;' in s, 'performance revision 6 marker missing')
s = s.replace('private static final int REVISION = 6;', 'private static final int REVISION = 8;', 1)

verbose_key = '    private static final String VERBOSE_NATIVE_LOG_KEY = "bestiary_verbose_native_log";\n'
req(verbose_key in s, 'verbose native log key marker missing')
s = s.replace(
    verbose_key,
    verbose_key + '    private static final String RESOURCE_PACK_SAFE_KEY = "bestiary_resourcepack_safe_mode";\n',
    1,
)

old = '''        int targetHeap = defaultHeapMb(ram);
        int targetRatio = defaultResolutionRatio(ram, minSide);
        int currentHeap = prefs.getInt("allocation", -1);
        int currentRatio = prefs.getInt("resolutionRatio", -1);'''
req(old in s, 'performance allocation marker missing')
new = '''        int targetHeap = defaultHeapMb(ram);
        int safeHeapCeiling = safeMaxHeapMb(ram);
        int targetRatio = defaultResolutionRatio(ram, minSide);
        int currentHeap = prefs.getInt("allocation", -1);
        int currentRatio = prefs.getInt("resolutionRatio", -1);'''
s = s.replace(old, new, 1)

old = '''        if (!prefs.contains("allocation")) {
            edit.putInt("allocation", targetHeap);
            currentHeap = targetHeap;
            heapChanged = true;
        } else if (legacyManagedValues && currentHeap != targetHeap) {
            edit.putInt("allocation", targetHeap);
            currentHeap = targetHeap;
            heapChanged = true;
        }'''
req(old in s, 'performance heap migration block missing')
new = '''        if (!prefs.contains("allocation")) {
            edit.putInt("allocation", targetHeap);
            currentHeap = targetHeap;
            heapChanged = true;
        } else if (currentHeap > safeHeapCeiling) {
            Log.w(TAG, "Unsafe Android heap allocation " + currentHeap + "MB clamped to "
                    + safeHeapCeiling + "MB on totalRam=" + ram + "MB");
            edit.putInt("allocation", safeHeapCeiling);
            currentHeap = safeHeapCeiling;
            heapChanged = true;
        } else if (legacyManagedValues && currentHeap != targetHeap) {
            edit.putInt("allocation", targetHeap);
            currentHeap = targetHeap;
            heapChanged = true;
        }'''
s = s.replace(old, new, 1)

safe_pref_marker = '        if (!prefs.contains(VERBOSE_NATIVE_LOG_KEY)) edit.putBoolean(VERBOSE_NATIVE_LOG_KEY, false);\n'
req(safe_pref_marker in s, 'performance default preference marker missing')
s = s.replace(
    safe_pref_marker,
    safe_pref_marker + '        if (!prefs.contains(RESOURCE_PACK_SAFE_KEY)) edit.putBoolean(RESOURCE_PACK_SAFE_KEY, true);\n',
    1,
)

old = '''    public static int initialHeapMb(int maxHeapMb) {
        if (maxHeapMb <= 768) return 128;
        if (maxHeapMb <= 1536) return 256;
        if (maxHeapMb <= 2304) return 384;
        return 512;
    }

    public static float targetRefreshRate() {'''
req(old in s, 'initial heap marker missing')
new = '''    public static int initialHeapMb(int maxHeapMb) {
        if (maxHeapMb <= 768) return 128;
        if (maxHeapMb <= 1536) return 256;
        if (maxHeapMb <= 2304) return 384;
        return 512;
    }

    /**
     * Android hard ceiling for the Java heap. Resource-pack decoding and texture
     * upload consume substantial native/GPU memory outside -Xmx, so allowing the
     * JVM to approach total device RAM makes LMKD/native OOM much more likely.
     */
    public static int safeMaxHeapMb(int totalRamMb) {
        if (totalRamMb >= 12000) return 4096;
        if (totalRamMb >= 7500) return 3072;
        if (totalRamMb >= 5500) return 2560;
        if (totalRamMb >= 3800) return 1792;
        if (totalRamMb >= 2800) return 1280;
        return 1024;
    }

    public static int clampHeapForLaunch(Context context, int requestedMb) {
        int totalRam = Tools.getTotalDeviceMemory(context);
        int ceiling = safeMaxHeapMb(totalRam);
        int clamped = Math.max(512, Math.min(requestedMb, ceiling));
        if (clamped != requestedMb) {
            Log.w(TAG, "Launch heap clamped requested=" + requestedMb + "MB effective="
                    + clamped + "MB totalRam=" + totalRam + "MB");
        }
        return clamped;
    }

    public static boolean resourcePackSafeModeEnabled() {
        SharedPreferences prefs = LauncherPreferences.DEFAULT_PREF;
        return prefs == null || prefs.getBoolean(RESOURCE_PACK_SAFE_KEY, true);
    }

    public static float targetRefreshRate() {'''
s = s.replace(old, new, 1)

old = '''                + " minSide=" + minSide + " xmxMb=" + currentHeap
                + " xmsMb=" + initialHeapMb(currentHeap)'''
req(old in s, 'performance log heap marker missing')
s = s.replace(old, '''                + " minSide=" + minSide + " xmxMb=" + currentHeap
                + " safeHeapCeilingMb=" + safeHeapCeiling
                + " xmsMb=" + initialHeapMb(currentHeap)''', 1)
profile.write_text(s, encoding='utf-8')


# First-run options from the consolidated v1.0.6 patch must never request
# mipmaps on the low-end profile. Existing users are handled by the runtime safe
# mode below, and can explicitly opt out in Renderer settings if desired.
game_defaults = JAVA / 'BestiaryGamePerformanceDefaults.java'
g = game_defaults.read_text(encoding='utf-8')
old_mipmap_default = '        MCOptionUtils.set("mipmapLevels", "2");\n'
req(old_mipmap_default in g, 'first-run mipmap level 2 marker missing')
g = g.replace(old_mipmap_default, '        MCOptionUtils.set("mipmapLevels", "0");\n', 1)
game_defaults.write_text(g, encoding='utf-8')


# Runtime enforcement: SharedPreferences/static fields can be stale, so clamp
# again at the actual JVM launch boundary. Also write HotSpot fatal-error logs to
# the instance log directory; this is essentially free during normal execution
# and gives us evidence if the next failure is a native SIGSEGV instead of LMKD.
jre = JAVA / 'utils/JREUtils.java'
j = jre.read_text(encoding='utf-8')
old = '''        int bestiaryMaxHeapMb = LauncherPreferences.PREF_RAM_ALLOCATION;
        int bestiaryInitialHeapMb = BestiaryPerformanceProfile.initialHeapMb(bestiaryMaxHeapMb);
        userArgs.add("-Xms" + bestiaryInitialHeapMb + "M");
        userArgs.add("-Xmx" + bestiaryMaxHeapMb + "M");
        Logger.appendToLog("Bestiary memory policy: Xms=" + bestiaryInitialHeapMb
                + "M Xmx=" + bestiaryMaxHeapMb + "M");'''
req(old in j, 'runtime heap policy marker missing')
new = '''        int bestiaryRequestedHeapMb = LauncherPreferences.PREF_RAM_ALLOCATION;
        int bestiaryMaxHeapMb = BestiaryPerformanceProfile.clampHeapForLaunch(activity, bestiaryRequestedHeapMb);
        int bestiaryInitialHeapMb = BestiaryPerformanceProfile.initialHeapMb(bestiaryMaxHeapMb);
        userArgs.add("-Xms" + bestiaryInitialHeapMb + "M");
        userArgs.add("-Xmx" + bestiaryMaxHeapMb + "M");

        File bestiaryCrashDir = new File(gameDirectory, "logs");
        if (!bestiaryCrashDir.isDirectory()) bestiaryCrashDir.mkdirs();
        boolean hasHotspotErrorFile = false;
        for (String arg : userArgs) {
            if (arg != null && arg.startsWith("-XX:ErrorFile=")) {
                hasHotspotErrorFile = true;
                break;
            }
        }
        String bestiaryErrorFile = new File(bestiaryCrashDir, "bestiary-hs_err_pid%p.log").getAbsolutePath();
        if (!hasHotspotErrorFile) userArgs.add("-XX:ErrorFile=" + bestiaryErrorFile);

        Logger.appendToLog("Bestiary memory policy: requested=" + bestiaryRequestedHeapMb
                + "M Xms=" + bestiaryInitialHeapMb + "M Xmx=" + bestiaryMaxHeapMb
                + "M safeMode=" + BestiaryPerformanceProfile.resourcePackSafeModeEnabled()
                + " hotspotErrorFile=" + (hasHotspotErrorFile ? "custom" : bestiaryErrorFile));'''
j = j.replace(old, new, 1)
jre.write_text(j, encoding='utf-8')


# Sodium 0.6.13 no longer defines the two legacy rules that Amethyst's generic
# workaround writes. Remove only those exact obsolete lines rather than claiming
# a protection that Sodium ignores.
tools = JAVA / 'Tools.java'
t = tools.read_text(encoding='utf-8')
start = '        boolean hasSodiumMod = hasMods(sodiumMods);\n'
start_at = t.find(start)
req(start_at >= 0, 'Bestiary Sodium policy start missing')
end_marker = '        // We use a janky lwjgl setup. We don\'t want more people complaining it crashes.\n'
end_at = t.find(end_marker, start_at)
req(end_at > start_at, 'Bestiary Sodium policy end missing')
sodium_policy = r'''        boolean hasSodiumMod = hasMods(sodiumMods);
        if (hasSodiumMod) {
            for (String modName : sodiumMods) {
                if (!hasMods(modName)) continue;
                File mixinPropertiesConfigFile = new File(getGameDir(), "config/" + modName + "-mixins.properties");
                List<String> lines = null;
                try {
                    lines = org.apache.commons.io.FileUtils.readLines(mixinPropertiesConfigFile, "UTF-8");
                } catch (IOException ignored) {}
                if (lines == null) lines = new ArrayList<>();

                boolean changed = false;
                String legacyIntrinsic = "mixin.features.buffer_builder.intrinsics=false";
                String legacyChunk = "mixin.features.chunk_rendering=false";
                while (lines.remove(legacyIntrinsic)) changed = true;
                while (lines.remove(legacyChunk)) changed = true;
                if (changed) {
                    try {
                        org.apache.commons.io.FileUtils.writeLines(mixinPropertiesConfigFile, lines);
                    } catch (IOException ignored) {}
                }
                Log.i("BestiarySodium", "mod=" + modName
                        + " versionPolicy=0.6.13-native removedObsoleteOverrides=" + changed);
            }
        }
'''
t = t[:start_at] + sodium_policy + t[end_at:]
tools.write_text(t, encoding='utf-8')


# Resource-pack safety is not a Mali-G57 special case. The measured Bestiary
# server pack expands to hundreds of MiB of RGBA textures, and mip levels amplify
# that on every backend. Default safe mode forces Minecraft mipmaps to zero before
# the game starts. Users can opt out explicitly in Renderer settings.
safety_java = r'''package net.kdt.pojavlaunch;

import android.util.Log;

import net.kdt.pojavlaunch.utils.MCOptionUtils;

public final class BestiaryResourcePackSafety {
    private static final String TAG = "BestiaryResourcePack";

    private BestiaryResourcePackSafety() {}

    public static void applyMinecraftOptions() {
        if (!BestiaryPerformanceProfile.resourcePackSafeModeEnabled()) {
            Log.i(TAG, "Resource-pack safe mode disabled by user");
            return;
        }

        String oldMipmaps = MCOptionUtils.get("mipmapLevels");
        boolean changed = !"0".equals(oldMipmaps);
        if (changed) {
            MCOptionUtils.set("mipmapLevels", "0");
            MCOptionUtils.save();
        }
        Log.w(TAG, "Resource-pack safe mode active; renderer=" + Tools.LOCAL_RENDERER
                + " mipmaps=" + (changed ? "0 (was " + oldMipmaps + ")" : "0"));
    }
}
'''
(JAVA / 'BestiaryResourcePackSafety.java').write_text(safety_java, encoding='utf-8')


main = JAVA / 'MainActivity.java'
m = main.read_text(encoding='utf-8')
options_hook = '        BestiaryGamePerformanceDefaults.installIfFresh(installBestiaryDefaults);\n'
req(options_hook in m, 'MainActivity Bestiary options hook missing')
if 'BestiaryResourcePackSafety.applyMinecraftOptions();' not in m:
    m = m.replace(options_hook, options_hook + '        BestiaryResourcePackSafety.applyMinecraftOptions();\n', 1)

launcher_info = '        Tools.printLauncherInfo(mVersion, LauncherPreferences.PREF_CUSTOM_JAVA_ARGS, Tools.getTotalDeviceMemory(this));\n'
req(launcher_info in m, 'launcher info marker missing')
if 'Bestiary resource-pack safety:' not in m:
    m = m.replace(launcher_info, launcher_info + '''        Logger.appendToLog("Bestiary resource-pack safety: enabled="
                + BestiaryPerformanceProfile.resourcePackSafeModeEnabled()
                + " totalRam=" + Tools.getTotalDeviceMemory(this) + "MB configuredHeap="
                + LauncherPreferences.PREF_RAM_ALLOCATION + "MB safeHeapCeiling="
                + BestiaryPerformanceProfile.safeMaxHeapMb(Tools.getTotalDeviceMemory(this)) + "MB"
                + " mipmaps=" + MCOptionUtils.get("mipmapLevels"));
''', 1)
main.write_text(m, encoding='utf-8')


# Make the safety policy visible and reversible instead of silently hardcoding it.
pref_renderer = RES / 'xml/pref_renderer.xml'
x = pref_renderer.read_text(encoding='utf-8')
if 'android:key="bestiary_resourcepack_safe_mode"' not in x:
    marker = '    <net.kdt.pojavlaunch.prefs.BackButtonPreference/>\n\n'
    req(marker in x, 'renderer preference back button marker missing')
    category = '''    <PreferenceCategory android:title="Bestiary">
        <SwitchPreference
            android:title="Chế độ an toàn resource pack"
            android:summary="Khuyên dùng cho Cobblemon/server pack nặng. Buộc Minecraft mipmap = 0 để giảm mạnh native/GPU texture memory khi reload."
            android:key="bestiary_resourcepack_safe_mode"
            android:defaultValue="true" />
    </PreferenceCategory>

'''
    x = x.replace(marker, marker + category, 1)
pref_renderer.write_text(x, encoding='utf-8')


# Contract checks.
profile_text = profile.read_text(encoding='utf-8')
req('REVISION = 8' in profile_text, 'performance revision 8 missing')
req('RESOURCE_PACK_SAFE_KEY' in profile_text, 'resource-pack safety preference missing')
req('safeMaxHeapMb' in profile_text, 'safe heap ceiling missing')
req('return 1792;' in profile_text, '4GB-class native headroom ceiling missing')
req('clampHeapForLaunch' in profile_text, 'runtime heap clamp helper missing')
req('resourcePackSafeModeEnabled' in profile_text, 'resource-pack safe-mode helper missing')
req('MCOptionUtils.set("mipmapLevels", "0")' in game_defaults.read_text(encoding='utf-8'), 'first-run mipmap zero missing')

jre_text = jre.read_text(encoding='utf-8')
req('bestiaryRequestedHeapMb' in jre_text, 'runtime requested heap tracking missing')
req('clampHeapForLaunch(activity' in jre_text, 'runtime hard heap clamp missing')
req('bestiary-hs_err_pid%p.log' in jre_text, 'HotSpot fatal-error file missing')

tools_text = tools.read_text(encoding='utf-8')
req('versionPolicy=0.6.13-native' in tools_text, 'Sodium 0.6.13 policy missing')
req('while (lines.remove(legacyIntrinsic))' in tools_text, 'obsolete Sodium intrinsic cleanup missing')
req('while (lines.remove(legacyChunk))' in tools_text, 'obsolete Sodium chunk cleanup missing')
req('fullChunkRendering=' not in tools_text, 'obsolete Bestiary Sodium chunk policy remains')

safety_text = (JAVA / 'BestiaryResourcePackSafety.java').read_text(encoding='utf-8')
req('Resource-pack safe mode active' in safety_text, 'general resource-pack safety class missing')
req('MCOptionUtils.set("mipmapLevels", "0")' in safety_text, 'runtime mipmap zero policy missing')
main_text = main.read_text(encoding='utf-8')
req('BestiaryResourcePackSafety.applyMinecraftOptions()' in main_text, 'resource-pack safety hook missing')
req('Bestiary resource-pack safety:' in main_text, 'resource-pack safety telemetry missing')
req('android:key="bestiary_resourcepack_safe_mode"' in pref_renderer.read_text(encoding='utf-8'), 'resource-pack safety UI missing')

print('Bestiary Android 1.0.6 general resource-pack stability hardening applied')

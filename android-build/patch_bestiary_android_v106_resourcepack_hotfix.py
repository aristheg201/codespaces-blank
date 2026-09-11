from pathlib import Path

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


# ---------------------------------------------------------------------------
# Bestiary Android 1.0.6 resource-pack stability hotfix.
# Resource reload temporarily duplicates decoded textures/models while the old
# GPU/native resources are still alive. Android therefore needs native headroom.
# The OPPO/Mali-G57 failure also exposed a renderer-specific texture reload path,
# so this hotfix contains both the memory safety invariant and the targeted
# Mali-G57 + MobileGlues compatibility profile.
# ---------------------------------------------------------------------------
profile = JAVA / 'BestiaryPerformanceProfile.java'
s = profile.read_text(encoding='utf-8')
req('private static final int REVISION = 6;' in s, 'performance revision 6 marker missing')
s = s.replace('private static final int REVISION = 6;', 'private static final int REVISION = 7;', 1)

# Clamp persisted allocation on every profile migration, including arbitrary old
# user values. This is a safety invariant rather than a performance preference.
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
     * Hard Android safety ceiling. Reserve room for JVM native structures,
     * decoded resource-pack images, OpenGL/MobileGlues allocations and Android.
     */
    public static int safeMaxHeapMb(int totalRamMb) {
        if (totalRamMb >= 12000) return 4096;
        if (totalRamMb >= 7500) return 3072;
        if (totalRamMb >= 5500) return 2560;
        if (totalRamMb >= 3800) return 2048;
        if (totalRamMb >= 2800) return 1536;
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

    public static float targetRefreshRate() {'''
s = s.replace(old, new, 1)

old = '''                + " minSide=" + minSide + " xmxMb=" + currentHeap
                + " xmsMb=" + initialHeapMb(currentHeap)'''
req(old in s, 'performance log heap marker missing')
s = s.replace(old, '''                + " minSide=" + minSide + " xmxMb=" + currentHeap
                + " safeHeapCeilingMb=" + safeHeapCeiling
                + " xmsMb=" + initialHeapMb(currentHeap)''', 1)
profile.write_text(s, encoding='utf-8')


# Runtime enforcement: even if preferences/static fields are stale, the embedded
# JVM cannot launch above the Android safety ceiling.
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
        Logger.appendToLog("Bestiary memory policy: requested=" + bestiaryRequestedHeapMb
                + "M Xms=" + bestiaryInitialHeapMb + "M Xmx=" + bestiaryMaxHeapMb + "M");'''
j = j.replace(old, new, 1)
jre.write_text(j, encoding='utf-8')


# Sodium 0.6.13 no longer defines the two legacy rules that Amethyst's generic
# workaround writes. Leaving them in sodium-mixins.properties produces warnings
# and, worse, creates the illusion that a stability guard is active when it is
# actually ignored. Remove only those exact obsolete Bestiary/Amethyst lines.
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


# Targeted compatibility policy for the failing hardware family. The server pack
# contains thousands of textures and its second ResourceManager reload causes a
# large texture-upload spike. On Mali-G57 + MobileGlues, disable Minecraft mipmaps
# to cut texture allocation/upload work materially. Do not change user settings on
# Adreno, Xclipse, LTW or Zink.
compat_java = r'''package net.kdt.pojavlaunch;

import android.util.Log;

import net.kdt.pojavlaunch.utils.GLInfoUtils;
import net.kdt.pojavlaunch.utils.MCOptionUtils;

import java.util.Locale;

public final class BestiaryRendererCompatibility {
    private static final String TAG = "BestiaryRendererCompat";

    private BestiaryRendererCompatibility() {}

    public static boolean isMaliG57MobileGlues() {
        if (!"opengles_mobileglues".equals(Tools.LOCAL_RENDERER)) return false;
        try {
            GLInfoUtils.GLInfo info = GLInfoUtils.getGlInfo();
            String renderer = info == null || info.renderer == null ? "" : info.renderer;
            return renderer.toLowerCase(Locale.ROOT).contains("mali-g57");
        } catch (Throwable t) {
            Log.w(TAG, "GPU compatibility detection failed", t);
            return false;
        }
    }

    public static void applyMinecraftOptions() {
        if (!isMaliG57MobileGlues()) return;

        String oldMipmaps = MCOptionUtils.get("mipmapLevels");
        boolean changed = false;
        try {
            if (oldMipmaps != null && Integer.parseInt(oldMipmaps) > 0) {
                MCOptionUtils.set("mipmapLevels", "0");
                changed = true;
            }
        } catch (NumberFormatException ignored) {
            MCOptionUtils.set("mipmapLevels", "0");
            changed = true;
        }

        if (changed) MCOptionUtils.save();
        Log.w(TAG, "Mali-G57 + MobileGlues resource-pack safe mode active; mipmaps="
                + (changed ? "0 (was " + oldMipmaps + ")" : String.valueOf(oldMipmaps)));
    }
}
'''
(JAVA / 'BestiaryRendererCompatibility.java').write_text(compat_java, encoding='utf-8')


# MainActivity has already loaded options.txt in onCreate. initLayout then resolves
# the actual renderer. Apply the targeted option policy immediately after that
# renderer is known and before Minecraft starts.
main = JAVA / 'MainActivity.java'
m = main.read_text(encoding='utf-8')
compat_hook = '            BestiaryRendererCompatibility.applyMinecraftOptions();\n'
if compat_hook not in m:
    needle = '            setTitle("Minecraft " + minecraftProfile.lastVersionId);\n'
    req(needle in m, 'MainActivity renderer-resolved marker missing')
    m = m.replace(needle, compat_hook + '\n' + needle, 1)

# Capture memory policy in the launcher log immediately before entering JVM.
needle = '        Tools.printLauncherInfo(mVersion, LauncherPreferences.PREF_CUSTOM_JAVA_ARGS, Tools.getTotalDeviceMemory(this));\n'
req(needle in m, 'launcher info marker missing')
m = m.replace(needle, needle + '''        Logger.appendToLog("Bestiary resource-pack safety: totalRam="
                + Tools.getTotalDeviceMemory(this) + "MB configuredHeap="
                + LauncherPreferences.PREF_RAM_ALLOCATION + "MB safeHeapCeiling="
                + BestiaryPerformanceProfile.safeMaxHeapMb(Tools.getTotalDeviceMemory(this)) + "MB"
                + " maliG57MobileGlues=" + BestiaryRendererCompatibility.isMaliG57MobileGlues());
''', 1)
main.write_text(m, encoding='utf-8')


# Contract checks.
profile_text = profile.read_text(encoding='utf-8')
req('REVISION = 7' in profile_text, 'performance revision 7 missing')
req('safeMaxHeapMb' in profile_text, 'safe heap ceiling missing')
req('clampHeapForLaunch' in profile_text, 'runtime heap clamp helper missing')
req('Unsafe Android heap allocation' in profile_text, 'persisted heap clamp logging missing')
jre_text = jre.read_text(encoding='utf-8')
req('bestiaryRequestedHeapMb' in jre_text, 'runtime requested heap tracking missing')
req('clampHeapForLaunch(activity' in jre_text, 'runtime hard heap clamp missing')
tools_text = tools.read_text(encoding='utf-8')
req('versionPolicy=0.6.13-native' in tools_text, 'Sodium 0.6.13 policy missing')
req('while (lines.remove(legacyIntrinsic))' in tools_text, 'obsolete Sodium intrinsic cleanup missing')
req('while (lines.remove(legacyChunk))' in tools_text, 'obsolete Sodium chunk cleanup missing')
req('fullChunkRendering=' not in tools_text, 'obsolete Bestiary Sodium chunk policy remains')
compat_text = (JAVA / 'BestiaryRendererCompatibility.java').read_text(encoding='utf-8')
req('mali-g57' in compat_text, 'Mali-G57 detection missing')
req('MCOptionUtils.set("mipmapLevels", "0")' in compat_text, 'Mali-G57 mipmap safety policy missing')
main_text = main.read_text(encoding='utf-8')
req('BestiaryRendererCompatibility.applyMinecraftOptions()' in main_text, 'renderer compatibility hook missing')
req('Bestiary resource-pack safety' in main_text, 'resource-pack safety telemetry missing')
print('Bestiary Android 1.0.6 resource-pack renderer/memory stability hotfix applied')

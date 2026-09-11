from pathlib import Path
import re

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


# ---------------------------------------------------------------------------
# Bestiary Android 1.0.6: mobile-first performance policy.
# - Keep Java 21 defaults from 1.0.5.
# - Budget render resolution by RAM instead of blindly using most of a low-res
#   display's native pixels.
# - Do not auto-enable Android sustained-performance mode or big-core pinning.
# - Keep Sodium's chunk renderer enabled on the Bestiary MobileGlues path while
#   retaining upstream's conservative mitigation on other renderer backends.
# ---------------------------------------------------------------------------
build = APP / 'build.gradle'
s = build.read_text(encoding='utf-8')
req('versionName "1.0.5"' in s, '1.0.5 versionName marker missing')
s = s.replace('versionName "1.0.5"', 'versionName "1.0.6"', 1)
if 'versionCode 10000005' in s:
    s = s.replace('versionCode 10000005', 'versionCode 10000006', 1)
build.write_text(s, encoding='utf-8')


profile_java = r'''package net.kdt.pojavlaunch;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.DisplayMetrics;
import android.util.Log;

import net.kdt.pojavlaunch.prefs.LauncherPreferences;

public final class BestiaryPerformanceProfile {
    private static final String TAG = "BestiaryPerformance";
    private static final String REVISION_KEY = "bestiary_performance_revision";
    private static final String JVM_MODE_KEY = "bestiary_jvm_mode";
    private static final int REVISION = 4;

    private BestiaryPerformanceProfile() {}

    public static void install(Context context) {
        SharedPreferences prefs = LauncherPreferences.DEFAULT_PREF;
        int previousRevision = prefs.getInt(REVISION_KEY, 0);
        if (previousRevision >= REVISION) return;

        int ram = Tools.getTotalDeviceMemory(context);
        int cores = Runtime.getRuntime().availableProcessors();
        DisplayMetrics dm = context.getResources().getDisplayMetrics();
        int minSide = Math.max(1, Math.min(dm.widthPixels, dm.heightPixels));

        String currentJavaArgs = prefs.getString("javaArgs", "");
        String currentJvmMode = prefs.getString(JVM_MODE_KEY, "");
        boolean legacyGeneratedJvm = BestiaryJvmFlagGenerator.isLegacyGenerated(currentJavaArgs);
        boolean java21Managed = legacyGeneratedJvm || "JAVA21_DEFAULTS".equals(currentJvmMode);
        boolean freshBestiary = previousRevision == 0;

        int targetHeap = defaultHeapMb(ram);
        int targetRatio = defaultResolutionRatio(ram, minSide);
        int oldAutoHeap = oldV104HeapMb(ram);
        int oldAutoRatio = oldV104ResolutionRatio(minSide);
        int currentHeap = prefs.getInt("allocation", -1);
        int currentRatio = prefs.getInt("resolutionRatio", -1);

        // Exact old generated values + a Bestiary-managed JVM profile are strong
        // provenance that these values were launcher defaults, not user choices.
        boolean migrateManagedPerformance = !freshBestiary
                && java21Managed
                && currentRatio == oldAutoRatio;

        SharedPreferences.Editor edit = prefs.edit();
        boolean heapChanged = false;
        boolean ratioChanged = false;
        boolean sustainedChanged = false;
        boolean affinityChanged = false;

        if (freshBestiary || currentHeap < 0) {
            edit.putInt("allocation", targetHeap);
            currentHeap = targetHeap;
            heapChanged = true;
        } else if (migrateManagedPerformance && currentHeap == oldAutoHeap && targetHeap != currentHeap) {
            edit.putInt("allocation", targetHeap);
            currentHeap = targetHeap;
            heapChanged = true;
        }

        if (freshBestiary || currentRatio < 0) {
            edit.putInt("resolutionRatio", targetRatio);
            currentRatio = targetRatio;
            ratioChanged = true;
        } else if (migrateManagedPerformance && currentRatio != targetRatio) {
            edit.putInt("resolutionRatio", targetRatio);
            currentRatio = targetRatio;
            ratioChanged = true;
        }

        // Sustained performance mode is an energy/thermal stability policy, not
        // a universal FPS boost. Default it off and let users opt in if their
        // device specifically benefits during long sessions.
        boolean oldAutoSustained = cores >= 6;
        if (freshBestiary || !prefs.contains("sustainedPerformance")) {
            edit.putBoolean("sustainedPerformance", false);
            sustainedChanged = true;
        } else if (migrateManagedPerformance
                && prefs.getBoolean("sustainedPerformance", false) == oldAutoSustained
                && oldAutoSustained) {
            edit.putBoolean("sustainedPerformance", false);
            sustainedChanged = true;
        }

        // Static big-core pinning can cause a quick thermal spike and then worse
        // frame pacing. Android's scheduler has better live thermal information.
        boolean oldAutoAffinity = cores >= 8;
        if (freshBestiary || !prefs.contains("bigCoreAffinity")) {
            edit.putBoolean("bigCoreAffinity", false);
            affinityChanged = true;
        } else if (migrateManagedPerformance
                && prefs.getBoolean("bigCoreAffinity", false) == oldAutoAffinity
                && oldAutoAffinity) {
            edit.putBoolean("bigCoreAffinity", false);
            affinityChanged = true;
        }

        // Avoid double throttling/pacing. Minecraft/Sodium can still apply their
        // own FPS cap; the Android surface should not force VSync on top of it.
        if (freshBestiary || !prefs.contains("force_vsync")) edit.putBoolean("force_vsync", false);
        if (freshBestiary || !prefs.contains("alternate_surface")) edit.putBoolean("alternate_surface", true);

        if (legacyGeneratedJvm) {
            edit.putString("javaArgs", "");
            edit.putString(JVM_MODE_KEY, "JAVA21_DEFAULTS");
            currentJvmMode = "JAVA21_DEFAULTS";
        } else {
            String trimmed = currentJavaArgs == null ? "" : currentJavaArgs.trim();
            currentJvmMode = trimmed.isEmpty() ? "JAVA21_DEFAULTS" : "CUSTOM";
            edit.putString(JVM_MODE_KEY, currentJvmMode);
        }

        edit.putInt(REVISION_KEY, REVISION).apply();
        Log.i(TAG, "rev=" + previousRevision + "->" + REVISION
                + " ramMb=" + ram + " cores=" + cores + " minSide=" + minSide
                + " heapMb=" + currentHeap + " ratio=" + currentRatio
                + " targetShortSide=" + targetShortSide(ram)
                + " jvmMode=" + currentJvmMode
                + " migrated=" + migrateManagedPerformance
                + " heapChanged=" + heapChanged
                + " ratioChanged=" + ratioChanged
                + " sustainedChanged=" + sustainedChanged
                + " affinityChanged=" + affinityChanged);
    }

    private static int defaultHeapMb(int ramMb) {
        if (ramMb >= 11000) return 3072;
        if (ramMb >= 7500) return 2560;
        if (ramMb >= 5500) return 2048;
        if (ramMb >= 3800) return 1536;
        if (ramMb >= 2800) return 1280;
        return 1024;
    }

    private static int targetShortSide(int ramMb) {
        if (ramMb < 2800) return 432;
        if (ramMb < 3800) return 480;
        if (ramMb < 5500) return 540;
        if (ramMb < 7500) return 600;
        if (ramMb < 11000) return 720;
        return 800;
    }

    private static int defaultResolutionRatio(int ramMb, int minSide) {
        int target = targetShortSide(ramMb);
        if (minSide <= target) return 100;
        int raw = (target * 100) / minSide;
        // Amethyst's resolution slider advances in 5-point steps. Round down so
        // the selected framebuffer never exceeds the intended pixel budget.
        int ratio = (raw / 5) * 5;
        if (ratio < 25) ratio = 25;
        if (ratio > 100) ratio = 100;
        return ratio;
    }

    private static int oldV104HeapMb(int ramMb) {
        return ramMb >= 8192 ? 3072 : ramMb >= 6144 ? 2560 : ramMb >= 4096 ? 2048 : 1536;
    }

    private static int oldV104ResolutionRatio(int minSide) {
        return minSide >= 1440 ? 55 : minSide >= 1080 ? 65 : minSide >= 900 ? 75 : 85;
    }
}
'''
(JAVA / 'BestiaryPerformanceProfile.java').write_text(profile_java, encoding='utf-8')


# ---------------------------------------------------------------------------
# Sodium compatibility/performance.
# Upstream assumes Sodium reaches launch only through its explicit force-run
# path and therefore disables Sodium chunk rendering for stability. Bestiary
# deliberately ships Sodium in the Android profile and defaults to MobileGlues,
# so that assumption no longer applies. Keep the buffer-builder intrinsic guard,
# but do not disable Sodium's chunk renderer on MobileGlues. Other backends keep
# the upstream conservative behavior.
# ---------------------------------------------------------------------------
tools = JAVA / 'Tools.java'
t = tools.read_text(encoding='utf-8')
pattern = re.compile(
    r'''        // We only ever reach this point when user has already used the force run switch\n'''
    r'''        boolean hasSodiumMod = false;\n'''
    r'''        for \(String modName : sodiumMods\) \{\n'''
    r'''            if \(hasMods\(sodiumMods\)\) \{\n'''
    r'''                hasSodiumMod = true;\n'''
    r'''                File mixinPropertiesConfigFile = new File\(getGameDir\(\), "config/" \+ modName \+ "-mixins.properties"\);\n'''
    r'''                // Write mixin configs to somewhat help stability\. We don't want more people complaining\.\n'''
    r'''                String\[\] propertiesToAdd = \{\n'''
    r'''                        "mixin\.features\.buffer_builder\.intrinsics=false",\n'''
    r'''                        "mixin\.features\.chunk_rendering=false"\n'''
    r'''                \};\n'''
    r'''                List<String> mixinPropertiesConfigStrings = null;\n'''
    r'''                try \{\n'''
    r'''                    mixinPropertiesConfigStrings = org\.apache\.commons\.io\.FileUtils\.readLines\(mixinPropertiesConfigFile, "UTF-8"\);\n'''
    r'''                \} catch \(IOException ignored\) \{\}\n'''
    r'''                if \(mixinPropertiesConfigStrings == null\) \{\n'''
    r'''                    mixinPropertiesConfigStrings = new ArrayList<>\(\);\n'''
    r'''                \}\n'''
    r'''                for \(String newLine : propertiesToAdd\) \{\n'''
    r'''                    if \(!mixinPropertiesConfigStrings\.contains\(newLine\)\) \{\n'''
    r'''                        mixinPropertiesConfigStrings\.add\(newLine\);\n'''
    r'''                    \}\n'''
    r'''                \}\n'''
    r'''                try \{\n'''
    r'''                    org\.apache\.commons\.io\.FileUtils\.writeLines\(mixinPropertiesConfigFile, mixinPropertiesConfigStrings\);\n'''
    r'''                \} catch \(IOException ignored\) \{\} // If we can't write it, we tried our best\.\n'''
    r'''\n'''
    r'''            \}\n'''
    r'''        \}\n''',
    re.M,
)
match = pattern.search(t)
req(match is not None, 'upstream Sodium mitigation block missing')
replacement = r'''        boolean hasSodiumMod = hasMods(sodiumMods);
        if (hasSodiumMod) {
            boolean bestiaryMobileGlues = "opengles_mobileglues".equals(Tools.LOCAL_RENDERER);
            for (String modName : sodiumMods) {
                if (!hasMods(modName)) continue;
                File mixinPropertiesConfigFile = new File(getGameDir(), "config/" + modName + "-mixins.properties");
                List<String> mixinPropertiesConfigStrings = null;
                try {
                    mixinPropertiesConfigStrings = org.apache.commons.io.FileUtils.readLines(mixinPropertiesConfigFile, "UTF-8");
                } catch (IOException ignored) {}
                if (mixinPropertiesConfigStrings == null) mixinPropertiesConfigStrings = new ArrayList<>();

                String intrinsicGuard = "mixin.features.buffer_builder.intrinsics=false";
                if (!mixinPropertiesConfigStrings.contains(intrinsicGuard)) {
                    mixinPropertiesConfigStrings.add(intrinsicGuard);
                }

                String chunkDisable = "mixin.features.chunk_rendering=false";
                if (bestiaryMobileGlues) {
                    // Migrate the line written by older Bestiary/Amethyst builds.
                    // This restores Sodium's primary chunk-rendering optimization.
                    while (mixinPropertiesConfigStrings.remove(chunkDisable)) {}
                } else if (!mixinPropertiesConfigStrings.contains(chunkDisable)) {
                    // Preserve upstream stability behavior on unvalidated backends.
                    mixinPropertiesConfigStrings.add(chunkDisable);
                }

                try {
                    org.apache.commons.io.FileUtils.writeLines(mixinPropertiesConfigFile, mixinPropertiesConfigStrings);
                } catch (IOException ignored) {}
                Log.i("BestiarySodium", "renderer=" + Tools.LOCAL_RENDERER
                        + " mod=" + modName
                        + " fullChunkRendering=" + bestiaryMobileGlues);
            }
        }
'''
t = t[:match.start()] + replacement + t[match.end():]
tools.write_text(t, encoding='utf-8')


# Keep network provenance aligned with the installed Android version.
for name in ('BestiaryBootstrap.java', 'BestiaryAppUpdater.java'):
    path = JAVA / name
    if path.is_file():
        text = path.read_text(encoding='utf-8')
        text = re.sub(r'BestiaryLauncher-Android/1\.0\.\d+', 'BestiaryLauncher-Android/1.0.6', text)
        path.write_text(text, encoding='utf-8')


# Contract checks before Gradle spends time compiling.
req('versionName "1.0.6"' in build.read_text(encoding='utf-8'), '1.0.6 version missing')
profile = (JAVA / 'BestiaryPerformanceProfile.java').read_text(encoding='utf-8')
req('REVISION = 4' in profile, 'performance profile revision 4 missing')
req('targetShortSide' in profile, 'target short-side resolution budget missing')
req('sustainedPerformance", false' in profile, 'sustained performance safe default missing')
req('bigCoreAffinity", false' in profile, 'affinity safe default missing')
req('oldV104ResolutionRatio' in profile, 'managed v1.0.4 resolution migration missing')
tools_text = tools.read_text(encoding='utf-8')
req('fullChunkRendering=' in tools_text, 'Bestiary Sodium renderer policy missing')
req('while (mixinPropertiesConfigStrings.remove(chunkDisable)) {}' in tools_text, 'stale Sodium chunk-disable migration missing')
req('mixin.features.buffer_builder.intrinsics=false' in tools_text, 'Sodium intrinsic stability guard missing')
req('if (bestiaryMobileGlues)' in tools_text, 'MobileGlues Sodium conditional missing')
print('Bestiary Android 1.0.6 low-end render/Sodium performance patch applied')

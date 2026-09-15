from pathlib import Path

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'
RES = APP / 'src/main/res'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


# Bestiary Android 1.0.6 resource-pack stability hardening.
# Revision 10 preserves full visual quality. It does not resize resource-pack
# assets, lower texture resolution, disable mipmaps, or alter renderer choice.
# Stability comes from native/GPU headroom and lower reload concurrency only.
profile = JAVA / 'BestiaryPerformanceProfile.java'
s = profile.read_text(encoding='utf-8')
req('private static final int REVISION = 6;' in s, 'performance revision 6 marker missing')
s = s.replace('private static final int REVISION = 6;', 'private static final int REVISION = 10;', 1)

verbose_key = '    private static final String VERBOSE_NATIVE_LOG_KEY = "bestiary_verbose_native_log";\n'
req(verbose_key in s, 'verbose native log key marker missing')
s = s.replace(
    verbose_key,
    verbose_key
    + '    private static final String RESOURCE_PACK_SAFE_KEY = "bestiary_resourcepack_safe_mode";\n'
    + '    private static final String RESTORE_MIPMAP_QUALITY_KEY = "bestiary_restore_mipmap_quality";\n',
    1,
)

old = '''        int targetHeap = defaultHeapMb(ram);
        int targetRatio = defaultResolutionRatio(ram, minSide);
        int currentHeap = prefs.getInt("allocation", -1);
        int currentRatio = prefs.getInt("resolutionRatio", -1);'''
req(old in s, 'performance allocation marker missing')
s = s.replace(old, '''        int targetHeap = defaultHeapMb(ram);
        int safeHeapCeiling = safeMaxHeapMb(ram);
        int targetRatio = defaultResolutionRatio(ram, minSide);
        int currentHeap = prefs.getInt("allocation", -1);
        int currentRatio = prefs.getInt("resolutionRatio", -1);
        boolean restoreLegacyForcedMipmaps = previousRevision >= 8 && previousRevision < REVISION
                && prefs.getBoolean(RESOURCE_PACK_SAFE_KEY, true);''', 1)

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
s = s.replace(old, '''        if (!prefs.contains("allocation")) {
            currentHeap = Math.min(targetHeap, safeHeapCeiling);
            edit.putInt("allocation", currentHeap);
            heapChanged = true;
        } else if (currentHeap > safeHeapCeiling) {
            Log.w(TAG, "Unsafe Android heap allocation " + currentHeap + "MB clamped to "
                    + safeHeapCeiling + "MB on totalRam=" + ram + "MB");
            edit.putInt("allocation", safeHeapCeiling);
            currentHeap = safeHeapCeiling;
            heapChanged = true;
        } else if (legacyManagedValues && currentHeap != targetHeap) {
            int migratedHeap = Math.min(targetHeap, safeHeapCeiling);
            edit.putInt("allocation", migratedHeap);
            currentHeap = migratedHeap;
            heapChanged = true;
        }''', 1)

safe_pref_marker = '        if (!prefs.contains(VERBOSE_NATIVE_LOG_KEY)) edit.putBoolean(VERBOSE_NATIVE_LOG_KEY, false);\n'
req(safe_pref_marker in s, 'performance default preference marker missing')
s = s.replace(
    safe_pref_marker,
    safe_pref_marker
    + '        if (!prefs.contains(RESOURCE_PACK_SAFE_KEY)) edit.putBoolean(RESOURCE_PACK_SAFE_KEY, true);\n'
    + '        if (restoreLegacyForcedMipmaps) edit.putBoolean(RESTORE_MIPMAP_QUALITY_KEY, true);\n',
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
s = s.replace(old, '''    public static int initialHeapMb(int maxHeapMb) {
        if (maxHeapMb <= 768) return 128;
        if (maxHeapMb <= 1536) return 256;
        if (maxHeapMb <= 2304) return 384;
        return 512;
    }

    /**
     * Reserve native/GPU headroom for server resource-pack decoding/reload.
     * NativeImage, atlas staging and GL driver allocations are outside -Xmx.
     * This changes memory budgeting only; it does not reduce visual quality.
     */
    public static int safeMaxHeapMb(int totalRamMb) {
        if (totalRamMb >= 12000) return 4096;
        if (totalRamMb >= 9500) return 3072;
        if (totalRamMb >= 7500) return 2304;
        if (totalRamMb >= 5500) return 1792;
        if (totalRamMb >= 3800) return 1536;
        if (totalRamMb >= 2800) return 1024;
        return 768;
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

    public static int safeBackgroundThreads() {
        return 2;
    }

    public static boolean mipmapQualityRestorePending() {
        SharedPreferences prefs = LauncherPreferences.DEFAULT_PREF;
        return prefs != null && prefs.getBoolean(RESTORE_MIPMAP_QUALITY_KEY, false);
    }

    public static void clearMipmapQualityRestorePending() {
        SharedPreferences prefs = LauncherPreferences.DEFAULT_PREF;
        if (prefs != null) prefs.edit().putBoolean(RESTORE_MIPMAP_QUALITY_KEY, false).apply();
    }

    public static float targetRefreshRate() {''', 1)

old = '''                + " minSide=" + minSide + " xmxMb=" + currentHeap
                + " xmsMb=" + initialHeapMb(currentHeap)'''
req(old in s, 'performance log heap marker missing')
s = s.replace(old, '''                + " minSide=" + minSide + " xmxMb=" + currentHeap
                + " safeHeapCeilingMb=" + safeHeapCeiling
                + " xmsMb=" + initialHeapMb(currentHeap)''', 1)
profile.write_text(s, encoding='utf-8')


# Preserve the existing Bestiary first-run quality profile. The consolidated
# low-end patch uses mipmapLevels=2; this hotfix intentionally leaves it alone.
game_defaults = JAVA / 'BestiaryGamePerformanceDefaults.java'
g = game_defaults.read_text(encoding='utf-8')
req('        MCOptionUtils.set("mipmapLevels", "2");\n' in g, 'quality mipmap level 2 marker missing')
req('MCOptionUtils.set("mipmapLevels", "0")' not in g, 'quality regression: mipmap zero in first-run defaults')


# Enforce the safe heap at the actual JVM launch boundary and retain a HotSpot
# fatal-error file if a future failure is a native JVM crash rather than LMKD.
# Bound Minecraft/ModernFix background workers to two in safe mode unless the
# user explicitly supplied max.bg.threads. This reduces peak concurrent decode
# pressure without changing any texture/model/render quality setting.
jre = JAVA / 'utils/JREUtils.java'
j = jre.read_text(encoding='utf-8')
old = '''        int bestiaryMaxHeapMb = LauncherPreferences.PREF_RAM_ALLOCATION;
        int bestiaryInitialHeapMb = BestiaryPerformanceProfile.initialHeapMb(bestiaryMaxHeapMb);
        userArgs.add("-Xms" + bestiaryInitialHeapMb + "M");
        userArgs.add("-Xmx" + bestiaryMaxHeapMb + "M");
        Logger.appendToLog("Bestiary memory policy: Xms=" + bestiaryInitialHeapMb
                + "M Xmx=" + bestiaryMaxHeapMb + "M");'''
req(old in j, 'runtime heap policy marker missing')
j = j.replace(old, '''        int bestiaryRequestedHeapMb = LauncherPreferences.PREF_RAM_ALLOCATION;
        int bestiaryMaxHeapMb = BestiaryPerformanceProfile.clampHeapForLaunch(activity, bestiaryRequestedHeapMb);
        int bestiaryInitialHeapMb = BestiaryPerformanceProfile.initialHeapMb(bestiaryMaxHeapMb);
        userArgs.add("-Xms" + bestiaryInitialHeapMb + "M");
        userArgs.add("-Xmx" + bestiaryMaxHeapMb + "M");

        boolean hasBackgroundThreadOverride = false;
        for (String arg : userArgs) {
            if (arg != null && arg.startsWith("-Dmax.bg.threads=")) {
                hasBackgroundThreadOverride = true;
                break;
            }
        }
        if (BestiaryPerformanceProfile.resourcePackSafeModeEnabled() && !hasBackgroundThreadOverride) {
            userArgs.add("-Dmax.bg.threads=" + BestiaryPerformanceProfile.safeBackgroundThreads());
        }

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
                + " bgThreads=" + (hasBackgroundThreadOverride ? "custom" :
                    (BestiaryPerformanceProfile.resourcePackSafeModeEnabled()
                        ? BestiaryPerformanceProfile.safeBackgroundThreads() : "default"))
                + " visualQuality=preserved"
                + " hotspotErrorFile=" + (hasHotspotErrorFile ? "custom" : bestiaryErrorFile));''', 1)
jre.write_text(j, encoding='utf-8')


# Sodium 0.6.13 ignores Amethyst's two legacy mixin keys; remove only those exact
# stale entries instead of leaving a fake compatibility guard in the config.
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


# v2/v3 forced mipmapLevels=0. Revision 10 restores that launcher-created
# quality reduction exactly once for upgraded installs, then never touches the
# user's mipmap setting again. Fresh installs stay at the existing level 2.
safety_java = r'''package net.kdt.pojavlaunch;

import android.util.Log;
import net.kdt.pojavlaunch.utils.MCOptionUtils;

public final class BestiaryResourcePackSafety {
    private static final String TAG = "BestiaryResourcePack";

    private BestiaryResourcePackSafety() {}

    public static void restoreVisualQualityIfNeeded() {
        if (!BestiaryPerformanceProfile.mipmapQualityRestorePending()) {
            Log.i(TAG, "Resource-pack safety active with visual quality preserved; renderer=" + Tools.LOCAL_RENDERER);
            return;
        }

        String currentMipmaps = MCOptionUtils.get("mipmapLevels");
        if ("0".equals(currentMipmaps)) {
            MCOptionUtils.set("mipmapLevels", "2");
            MCOptionUtils.save();
            Log.w(TAG, "Restored mipmapLevels=2 after legacy resource-pack safe mode");
        } else {
            Log.i(TAG, "Legacy mipmap restore not needed; current=" + currentMipmaps);
        }
        BestiaryPerformanceProfile.clearMipmapQualityRestorePending();
    }
}
'''
(JAVA / 'BestiaryResourcePackSafety.java').write_text(safety_java, encoding='utf-8')

main = JAVA / 'MainActivity.java'
m = main.read_text(encoding='utf-8')
options_hook = '        BestiaryGamePerformanceDefaults.installIfFresh(installBestiaryDefaults);\n'
req(options_hook in m, 'MainActivity Bestiary options hook missing')
if 'BestiaryResourcePackSafety.restoreVisualQualityIfNeeded();' not in m:
    m = m.replace(options_hook, options_hook + '        BestiaryResourcePackSafety.restoreVisualQualityIfNeeded();\n', 1)
main.write_text(m, encoding='utf-8')


# Bestiary 1.0.6 is newer than the currently published Android updater product
# (1.0.4). Keep self-update dormant until a newer Android APK is intentionally
# published. Bootstrap/modpack sync remains enabled and unchanged.
launcher = JAVA / 'LauncherActivity.java'
ls = launcher.read_text(encoding='utf-8')
update_hook = '        BestiaryAppUpdater.check(this);\n'
req(update_hook in ls, 'Android self-updater hook missing before 1.0.6 guard')
ls = ls.replace(update_hook, '', 1)
launcher.write_text(ls, encoding='utf-8')

# Never expose transport URLs or raw exception messages to players if the
# updater is re-enabled in a later release. Full technical detail stays in logcat.
updater = JAVA / 'BestiaryAppUpdater.java'
u = updater.read_text(encoding='utf-8')
unsafe_toast = '                Tools.runOnUiThread(() -> android.widget.Toast.makeText(activity, "Cập nhật lỗi: " + t.getMessage(), android.widget.Toast.LENGTH_LONG).show());\n'
req(unsafe_toast in u, 'unsafe Android updater error toast marker missing')
u = u.replace(
    unsafe_toast,
    '                Tools.runOnUiThread(() -> android.widget.Toast.makeText(activity, "Cập nhật thất bại. Vui lòng thử lại sau.", android.widget.Toast.LENGTH_LONG).show());\n',
    1,
)
updater.write_text(u, encoding='utf-8')


# Visible and reversible safety switch. Safety affects memory/concurrency only.
pref_renderer = RES / 'xml/pref_renderer.xml'
x = pref_renderer.read_text(encoding='utf-8')
if 'android:key="bestiary_resourcepack_safe_mode"' not in x:
    marker = '    <net.kdt.pojavlaunch.prefs.BackButtonPreference/>\n\n'
    req(marker in x, 'renderer preference back button marker missing')
    x = x.replace(marker, marker + '''    <PreferenceCategory android:title="Bestiary">
        <SwitchPreference
            android:title="Chế độ an toàn resource pack"
            android:summary="Khuyên dùng cho Cobblemon/server pack nặng. Chừa native/GPU RAM và giảm worker reload; không giảm texture, model, animation hay mipmap."
            android:key="bestiary_resourcepack_safe_mode"
            android:defaultValue="true" />
    </PreferenceCategory>

''', 1)
pref_renderer.write_text(x, encoding='utf-8')


# Contract checks.
profile_text = profile.read_text(encoding='utf-8')
req('REVISION = 10' in profile_text, 'performance revision 10 missing')
req('RESOURCE_PACK_SAFE_KEY' in profile_text, 'resource-pack safety preference missing')
req('RESTORE_MIPMAP_QUALITY_KEY' in profile_text, 'legacy mipmap restore marker missing')
req('safeMaxHeapMb' in profile_text and 'return 2304;' in profile_text, '8GB native headroom ceiling missing')
req('safeBackgroundThreads' in profile_text and 'return 2;' in profile_text, 'safe reload worker policy missing')
req('clampHeapForLaunch' in profile_text, 'runtime heap clamp helper missing')
req('resourcePackSafeModeEnabled' in profile_text, 'resource-pack safe-mode helper missing')
req('mipmapQualityRestorePending' in profile_text, 'quality restore helper missing')

quality_defaults = game_defaults.read_text(encoding='utf-8')
req('MCOptionUtils.set("mipmapLevels", "2")' in quality_defaults, 'mipmap quality default is not level 2')
req('MCOptionUtils.set("mipmapLevels", "0")' not in quality_defaults, 'quality regression: first-run mipmap forced to zero')

jre_text = jre.read_text(encoding='utf-8')
req('bestiaryRequestedHeapMb' in jre_text, 'runtime requested heap tracking missing')
req('clampHeapForLaunch(activity' in jre_text, 'runtime hard heap clamp missing')
req('-Dmax.bg.threads=' in jre_text, 'safe background worker override missing')
req('hasBackgroundThreadOverride' in jre_text, 'user max.bg.threads preservation missing')
req('visualQuality=preserved' in jre_text, 'visual-quality preservation log missing')
req('bestiary-hs_err_pid%p.log' in jre_text, 'HotSpot fatal-error file missing')

tools_text = tools.read_text(encoding='utf-8')
req('versionPolicy=0.6.13-native' in tools_text, 'Sodium 0.6.13 policy missing')
req('while (lines.remove(legacyIntrinsic))' in tools_text, 'obsolete Sodium intrinsic cleanup missing')
req('while (lines.remove(legacyChunk))' in tools_text, 'obsolete Sodium chunk cleanup missing')
req('fullChunkRendering=' not in tools_text, 'obsolete Bestiary Sodium chunk policy remains')

safety_text = (JAVA / 'BestiaryResourcePackSafety.java').read_text(encoding='utf-8')
req('restoreVisualQualityIfNeeded' in safety_text, 'visual-quality restore class missing')
req('MCOptionUtils.set("mipmapLevels", "2")' in safety_text, 'legacy mipmap quality restoration missing')
req('MCOptionUtils.set("mipmapLevels", "0")' not in safety_text, 'quality regression: safety class forces mipmap zero')
req('BestiaryResourcePackSafety.restoreVisualQualityIfNeeded()' in main.read_text(encoding='utf-8'), 'quality restore hook missing')
req('không giảm texture, model, animation hay mipmap' in pref_renderer.read_text(encoding='utf-8'), 'quality-preserving UI text missing')

launcher_text = launcher.read_text(encoding='utf-8')
updater_text = updater.read_text(encoding='utf-8')
req('BestiaryAppUpdater.check(this);' not in launcher_text, 'Android self-updater unexpectedly active in 1.0.6')
req('"Cập nhật lỗi: " + t.getMessage()' not in updater_text, 'raw updater exception still exposed to UI')
req('Cập nhật thất bại. Vui lòng thử lại sau.' in updater_text, 'sanitized updater error message missing')

print('Bestiary Android 1.0.6 resource-pack v4 + dormant self-updater guard applied')

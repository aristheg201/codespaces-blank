from pathlib import Path
import re

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'
RES = APP / 'src/main/res'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


# One consolidated 1.0.6 performance patch, applied directly after 1.0.2.
# Historical 1.0.4/1.0.5 performance patches are intentionally not required.
build = APP / 'build.gradle'
s = build.read_text(encoding='utf-8')
req('versionName "1.0.2"' in s, '1.0.2 versionName marker missing')
s = s.replace('versionName "1.0.2"', 'versionName "1.0.6"', 1)
if 'versionCode 10000003' in s:
    s = s.replace('versionCode 10000003', 'versionCode 10000006', 1)
build.write_text(s, encoding='utf-8')


# Java 21 defaults. Keep the class because settings code calls it, but do not
# inject desktop/server GC recipes into Android. Only migrate exact Bestiary
# strings from already-installed 1.0.2/1.0.4 builds.
generator_java = r'''package net.kdt.pojavlaunch;

import android.content.Context;

public final class BestiaryJvmFlagGenerator {
    private static final String[] LEGACY_GENERATED = new String[] {
            "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=100 -XX:+DisableExplicitGC -Dfile.encoding=UTF-8",
            "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=100 -XX:+DisableExplicitGC -XX:+UseStringDeduplication -Dfile.encoding=UTF-8",
            "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=75 -XX:G1ReservePercent=15 -XX:InitiatingHeapOccupancyPercent=30 -XX:+DisableExplicitGC -Dfile.encoding=UTF-8",
            "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=75 -XX:G1ReservePercent=15 -XX:InitiatingHeapOccupancyPercent=30 -XX:+DisableExplicitGC -XX:+UseStringDeduplication -Dfile.encoding=UTF-8"
    };

    private BestiaryJvmFlagGenerator() {}

    public static String generate(Context context) {
        return "";
    }

    public static boolean isLegacyGenerated(String args) {
        String normalized = normalize(args);
        if (normalized.isEmpty()) return false;
        for (String legacy : LEGACY_GENERATED) {
            if (legacy.equals(normalized)) return true;
        }
        return false;
    }

    private static String normalize(String value) {
        return value == null ? "" : value.trim().replaceAll("\\s+", " ");
    }
}
'''
(JAVA / 'BestiaryJvmFlagGenerator.java').write_text(generator_java, encoding='utf-8')


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
        int currentHeap = prefs.getInt("allocation", -1);
        int currentRatio = prefs.getInt("resolutionRatio", -1);

        // Recognize exact older Bestiary-generated defaults so upgrades can be
        // corrected without overwriting arbitrary user tuning.
        boolean legacyManagedValues = !freshBestiary && java21Managed
                && isLegacyAutoRatio(currentRatio, minSide);

        SharedPreferences.Editor edit = prefs.edit();
        if (freshBestiary || currentHeap < 0) {
            edit.putInt("allocation", targetHeap);
            currentHeap = targetHeap;
        } else if (legacyManagedValues && isLegacyAutoHeap(currentHeap, ram)) {
            edit.putInt("allocation", targetHeap);
            currentHeap = targetHeap;
        }

        if (freshBestiary || currentRatio < 0) {
            edit.putInt("resolutionRatio", targetRatio);
            currentRatio = targetRatio;
        } else if (legacyManagedValues && currentRatio != targetRatio) {
            edit.putInt("resolutionRatio", targetRatio);
            currentRatio = targetRatio;
        }

        // Do not auto-enable sustained mode or static big-core pinning. Both can
        // worsen long-session frame pacing on thermally constrained phones.
        if (freshBestiary || !prefs.contains("sustainedPerformance") || legacyManagedValues) {
            edit.putBoolean("sustainedPerformance", false);
        }
        if (freshBestiary || !prefs.contains("bigCoreAffinity") || legacyManagedValues) {
            edit.putBoolean("bigCoreAffinity", false);
        }
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
        Log.i(TAG, "revision=" + previousRevision + "->" + REVISION
                + " ramMb=" + ram + " cores=" + cores
                + " minSide=" + minSide + " heapMb=" + currentHeap
                + " ratio=" + currentRatio + " targetShortSide=" + targetShortSide(ram)
                + " jvmMode=" + currentJvmMode + " migrated=" + legacyManagedValues);
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
        int ratio = (raw / 5) * 5;
        if (ratio < 25) ratio = 25;
        if (ratio > 100) ratio = 100;
        return ratio;
    }

    private static boolean isLegacyAutoHeap(int heap, int ramMb) {
        int v104 = ramMb >= 8192 ? 3072 : ramMb >= 6144 ? 2560 : ramMb >= 4096 ? 2048 : 1536;
        int v105 = ramMb >= 11000 ? 3072 : ramMb >= 7500 ? 2560 : ramMb >= 5500 ? 2048 : ramMb >= 3800 ? 1536 : ramMb >= 2800 ? 1280 : 1024;
        return heap == v104 || heap == v105;
    }

    private static boolean isLegacyAutoRatio(int ratio, int minSide) {
        int v104 = minSide >= 1440 ? 55 : minSide >= 1080 ? 65 : minSide >= 900 ? 75 : 85;
        return ratio == v104;
    }
}
'''
(JAVA / 'BestiaryPerformanceProfile.java').write_text(profile_java, encoding='utf-8')


# Install the profile before the second preference load so new values take
# effect in the same process. This hook did not exist in the 1.0.2 baseline.
app = JAVA / 'PojavApplication.java'
s = app.read_text(encoding='utf-8')
if 'BestiaryPerformanceProfile.install(this);' not in s:
    needle = '\t\t\t\tLauncherPreferences.loadPreferences(this);\n'
    req(needle in s, 'PojavApplication preference load marker missing')
    s = s.replace(needle, needle + '\t\t\t\tBestiaryPerformanceProfile.install(this);\n\t\t\t\tLauncherPreferences.loadPreferences(this);\n', 1)
app.write_text(s, encoding='utf-8')


# Replace the old one-click generated-G1 button with an explicit reset to Java
# 21 defaults. RAM allocation stays independent from JVM arguments.
pref_java = RES / 'xml/pref_java.xml'
x = pref_java.read_text(encoding='utf-8')
req('android:key="bestiary_generate_jvm_flags"' in x, 'Bestiary JVM preference missing')
x = x.replace('android:title="Tạo JVM flags tự động"', 'android:title="Khôi phục JVM mặc định"')
x = x.replace(
    'android:summary="Sinh bộ flag Java 21 an toàn theo RAM đã cấp. Không ghi đè giới hạn RAM."',
    'android:summary="Khuyên dùng trên Android: để Java 21 tự chọn GC/ergonomics. Xóa JVM flags tùy chỉnh nhưng không đổi RAM."'
)
pref_java.write_text(x, encoding='utf-8')

java_fragment = JAVA / 'prefs/screens/LauncherPreferenceJavaFragment.java'
s = java_fragment.read_text(encoding='utf-8')
old = '''        requirePreference("bestiary_generate_jvm_flags").setOnPreferenceClickListener(preference -> {
            String generated = BestiaryJvmFlagGenerator.generate(requireContext());
            LauncherPreferences.DEFAULT_PREF.edit().putString("javaArgs", generated).apply();
            LauncherPreferences.PREF_CUSTOM_JAVA_ARGS = generated;
            if (editJVMArgs != null) editJVMArgs.setText(generated);
            new androidx.appcompat.app.AlertDialog.Builder(requireContext())
                    .setTitle("JVM FLAGS ĐÃ TẠO")
                    .setMessage(generated)
                    .setPositiveButton("OK", null)
                    .show();
            return true;
        });'''
req(old in s, '1.0.2 JVM generator handler missing')
new = '''        requirePreference("bestiary_generate_jvm_flags").setOnPreferenceClickListener(preference -> {
            LauncherPreferences.DEFAULT_PREF.edit()
                    .putString("javaArgs", "")
                    .putString("bestiary_jvm_mode", "JAVA21_DEFAULTS")
                    .apply();
            LauncherPreferences.PREF_CUSTOM_JAVA_ARGS = "";
            if (editJVMArgs != null) editJVMArgs.setText("");
            new androidx.appcompat.app.AlertDialog.Builder(requireContext())
                    .setTitle("JVM MẶC ĐỊNH JAVA 21")
                    .setMessage("Đã xóa JVM flags tùy chỉnh. Bestiary dùng GC và JVM ergonomics mặc định của Java 21; giới hạn RAM giữ nguyên.")
                    .setPositiveButton("OK", null)
                    .show();
            return true;
        });'''
s = s.replace(old, new, 1)
java_fragment.write_text(s, encoding='utf-8')


# Sodium: Bestiary deliberately ships Sodium on Android. Upstream Amethyst's
# generic force-run mitigation disables Sodium chunk rendering. Keep the safer
# buffer-builder intrinsic guard but restore the chunk renderer on MobileGlues.
tools = JAVA / 'Tools.java'
t = tools.read_text(encoding='utf-8')
start = '        // We only ever reach this point when user has already used the force run switch\n        boolean hasSodiumMod = false;\n'
start_at = t.find(start)
req(start_at >= 0, 'upstream Sodium mitigation start missing')
end_marker = '        // We use a janky lwjgl setup. We don\'t want more people complaining it crashes.\n'
end_at = t.find(end_marker, start_at)
req(end_at > start_at, 'upstream Sodium mitigation end missing')
replacement = r'''        boolean hasSodiumMod = hasMods(sodiumMods);
        if (hasSodiumMod) {
            boolean bestiaryMobileGlues = "opengles_mobileglues".equals(Tools.LOCAL_RENDERER);
            for (String modName : sodiumMods) {
                if (!hasMods(modName)) continue;
                File mixinPropertiesConfigFile = new File(getGameDir(), "config/" + modName + "-mixins.properties");
                List<String> lines = null;
                try {
                    lines = org.apache.commons.io.FileUtils.readLines(mixinPropertiesConfigFile, "UTF-8");
                } catch (IOException ignored) {}
                if (lines == null) lines = new ArrayList<>();

                String intrinsicGuard = "mixin.features.buffer_builder.intrinsics=false";
                if (!lines.contains(intrinsicGuard)) lines.add(intrinsicGuard);

                String chunkDisable = "mixin.features.chunk_rendering=false";
                if (bestiaryMobileGlues) {
                    while (lines.remove(chunkDisable)) {}
                } else if (!lines.contains(chunkDisable)) {
                    lines.add(chunkDisable);
                }

                try {
                    org.apache.commons.io.FileUtils.writeLines(mixinPropertiesConfigFile, lines);
                } catch (IOException ignored) {}
                Log.i("BestiarySodium", "renderer=" + Tools.LOCAL_RENDERER
                        + " mod=" + modName + " fullChunkRendering=" + bestiaryMobileGlues);
            }
        }
'''
t = t[:start_at] + replacement + t[end_at:]
tools.write_text(t, encoding='utf-8')


# Keep network provenance aligned with this build.
for name in ('BestiaryBootstrap.java', 'BestiaryAppUpdater.java'):
    path = JAVA / name
    if path.is_file():
        text = path.read_text(encoding='utf-8')
        text = re.sub(r'BestiaryLauncher-Android/1\.0\.\d+', 'BestiaryLauncher-Android/1.0.6', text)
        path.write_text(text, encoding='utf-8')


# Pre-build contract checks.
req('versionName "1.0.6"' in build.read_text(encoding='utf-8'), '1.0.6 version missing')
req('return "";' in (JAVA / 'BestiaryJvmFlagGenerator.java').read_text(encoding='utf-8'), 'Java 21 defaults missing')
req('REVISION = 4' in (JAVA / 'BestiaryPerformanceProfile.java').read_text(encoding='utf-8'), 'performance revision missing')
req('targetShortSide' in (JAVA / 'BestiaryPerformanceProfile.java').read_text(encoding='utf-8'), 'resolution budget missing')
req('BestiaryPerformanceProfile.install(this)' in app.read_text(encoding='utf-8'), 'performance startup hook missing')
req('Khôi phục JVM mặc định' in pref_java.read_text(encoding='utf-8'), 'JVM reset UI missing')
req('JVM MẶC ĐỊNH JAVA 21' in java_fragment.read_text(encoding='utf-8'), 'JVM reset handler missing')
req('fullChunkRendering=' in tools.read_text(encoding='utf-8'), 'Sodium renderer policy missing')
req('mixin.features.buffer_builder.intrinsics=false' in tools.read_text(encoding='utf-8'), 'Sodium intrinsic guard missing')
print('Bestiary Android 1.0.6 consolidated mobile performance patch applied')

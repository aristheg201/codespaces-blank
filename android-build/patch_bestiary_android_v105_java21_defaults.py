from pathlib import Path
import re

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'
RES = APP / 'src/main/res'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


# ---------------------------------------------------------------------------
# Bestiary Android 1.0.5: remove regressive desktop/server-style JVM tuning.
# Java 21's own collector ergonomics are the default. User-written custom args
# are preserved; only exact Bestiary-generated legacy strings are migrated out.
# ---------------------------------------------------------------------------
build = APP / 'build.gradle'
s = build.read_text(encoding='utf-8')
req('versionName "1.0.4"' in s, '1.0.4 versionName marker missing')
s = s.replace('versionName "1.0.4"', 'versionName "1.0.5"', 1)
if 'versionCode 10000004' in s:
    s = s.replace('versionCode 10000004', 'versionCode 10000005', 1)
build.write_text(s, encoding='utf-8')


# The old generator forced G1 policy that competes with Minecraft render/chunk
# work on mobile CPUs. Keep this compatibility class because settings code calls
# it, but an automatic profile now intentionally emits no custom JVM flags.
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

    /** Java 21 defaults are the Bestiary Android automatic profile. */
    public static String generate(Context context) {
        return "";
    }

    /** Match only strings Bestiary itself generated in 1.0.2/1.0.4. */
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


# Install conservative defaults only when a user has never chosen a value.
# Existing custom RAM/resolution/renderer choices remain untouched. The only
# migration is clearing a byte-for-byte equivalent legacy Bestiary JVM preset.
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
    private static final int REVISION = 3;

    private BestiaryPerformanceProfile() {}

    public static void install(Context context) {
        SharedPreferences prefs = LauncherPreferences.DEFAULT_PREF;
        if (prefs.getInt(REVISION_KEY, 0) >= REVISION) return;

        int ram = Tools.getTotalDeviceMemory(context);
        int cores = Runtime.getRuntime().availableProcessors();
        DisplayMetrics dm = context.getResources().getDisplayMetrics();
        int minSide = Math.min(dm.widthPixels, dm.heightPixels);
        String currentJavaArgs = prefs.getString("javaArgs", "");
        boolean legacyGeneratedJvm = BestiaryJvmFlagGenerator.isLegacyGenerated(currentJavaArgs);

        SharedPreferences.Editor edit = prefs.edit();
        if (!prefs.contains("allocation")) {
            edit.putInt("allocation", defaultHeapMb(ram));
        }
        if (!prefs.contains("resolutionRatio")) {
            int ratio = minSide >= 1440 ? 55 : minSide >= 1080 ? 65 : minSide >= 900 ? 75 : 85;
            edit.putInt("resolutionRatio", ratio);
        }
        if (!prefs.contains("sustainedPerformance")) edit.putBoolean("sustainedPerformance", cores >= 6);
        if (!prefs.contains("force_vsync")) edit.putBoolean("force_vsync", false);
        if (!prefs.contains("alternate_surface")) edit.putBoolean("alternate_surface", true);

        // Do not pin new installs to big cores. Android's scheduler normally has
        // better thermal/frequency visibility than a static launcher heuristic.
        if (!prefs.contains("bigCoreAffinity")) edit.putBoolean("bigCoreAffinity", false);

        if (legacyGeneratedJvm) {
            edit.putString("javaArgs", "");
            edit.putString(JVM_MODE_KEY, "JAVA21_DEFAULTS");
            Log.i(TAG, "Removed legacy Bestiary-generated JVM flags; Java 21 defaults enabled");
        } else {
            String trimmed = currentJavaArgs == null ? "" : currentJavaArgs.trim();
            edit.putString(JVM_MODE_KEY, trimmed.isEmpty() ? "JAVA21_DEFAULTS" : "CUSTOM");
        }

        edit.putInt(REVISION_KEY, REVISION).apply();
    }

    private static int defaultHeapMb(int ramMb) {
        // Thresholds account for Android reporting less than the marketed RAM.
        // Native renderer/driver/texture allocations live outside the Java heap.
        if (ramMb >= 11000) return 3072;
        if (ramMb >= 7500) return 2560;
        if (ramMb >= 5500) return 2048;
        if (ramMb >= 3800) return 1536;
        if (ramMb >= 2800) return 1280;
        return 1024;
    }
}
'''
(JAVA / 'BestiaryPerformanceProfile.java').write_text(profile_java, encoding='utf-8')


# Turn the old one-click generator into an explicit reset to Java 21 defaults.
pref_java = RES / 'xml/pref_java.xml'
x = pref_java.read_text(encoding='utf-8')
req('android:key="bestiary_generate_jvm_flags"' in x, 'Bestiary JVM preference missing')
x = x.replace('android:title="Tạo JVM flags tự động"', 'android:title="Khôi phục JVM mặc định"', 1)
x = x.replace(
    'android:summary="Sinh bộ flag Java 21 an toàn theo RAM đã cấp. Không ghi đè giới hạn RAM."',
    'android:summary="Khuyên dùng trên Android: để Java 21 tự chọn GC/ergonomics. Xóa JVM flags tùy chỉnh nhưng không đổi RAM."',
    1,
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
req(old in s, 'old JVM generator preference handler missing')
new = '''        requirePreference("bestiary_generate_jvm_flags").setOnPreferenceClickListener(preference -> {
            LauncherPreferences.DEFAULT_PREF.edit()
                    .putString("javaArgs", "")
                    .putString("bestiary_jvm_mode", "JAVA21_DEFAULTS")
                    .apply();
            LauncherPreferences.PREF_CUSTOM_JAVA_ARGS = "";
            if (editJVMArgs != null) editJVMArgs.setText("");
            new androidx.appcompat.app.AlertDialog.Builder(requireContext())
                    .setTitle("JVM MẶC ĐỊNH JAVA 21")
                    .setMessage("Đã xóa JVM flags tùy chỉnh. Bestiary sẽ dùng GC và JVM ergonomics mặc định của Java 21; giới hạn RAM vẫn giữ nguyên.")
                    .setPositiveButton("OK", null)
                    .show();
            return true;
        });'''
s = s.replace(old, new, 1)
java_fragment.write_text(s, encoding='utf-8')


# Keep network provenance aligned with the installed Android version.
for name in ('BestiaryBootstrap.java', 'BestiaryAppUpdater.java'):
    path = JAVA / name
    if path.is_file():
        text = path.read_text(encoding='utf-8')
        text = re.sub(r'BestiaryLauncher-Android/1\.0\.\d+', 'BestiaryLauncher-Android/1.0.5', text)
        path.write_text(text, encoding='utf-8')


# Contract checks before Gradle spends time compiling.
req('versionName "1.0.5"' in build.read_text(encoding='utf-8'), '1.0.5 version missing')
req('return "";' in (JAVA / 'BestiaryJvmFlagGenerator.java').read_text(encoding='utf-8'), 'automatic JVM flags are not empty')
req('isLegacyGenerated' in (JAVA / 'BestiaryJvmFlagGenerator.java').read_text(encoding='utf-8'), 'legacy JVM migration missing')
req('private static final int REVISION = 3;' in (JAVA / 'BestiaryPerformanceProfile.java').read_text(encoding='utf-8'), 'performance revision 3 missing')
req('edit.putString("javaArgs", "")' in (JAVA / 'BestiaryPerformanceProfile.java').read_text(encoding='utf-8'), 'legacy JVM clear missing')
req('edit.putBoolean("bigCoreAffinity", false)' in (JAVA / 'BestiaryPerformanceProfile.java').read_text(encoding='utf-8'), 'safe affinity default missing')
req('Khôi phục JVM mặc định' in pref_java.read_text(encoding='utf-8'), 'Java 21 defaults preference label missing')
req('JVM MẶC ĐỊNH JAVA 21' in java_fragment.read_text(encoding='utf-8'), 'Java defaults preference handler missing')
print('Bestiary Android 1.0.5 Java 21 defaults + low-end profile patch applied')

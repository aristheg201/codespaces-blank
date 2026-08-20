from pathlib import Path

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


# Version 1.0.4. 1.0.3 was reserved for the abandoned performance branch.
build = APP / 'build.gradle'
s = build.read_text(encoding='utf-8')
req('versionName "1.0.2"' in s, '1.0.2 versionName marker missing')
s = s.replace('versionName "1.0.2"', 'versionName "1.0.4"', 1)
if 'versionCode 10000003' in s:
    s = s.replace('versionCode 10000003', 'versionCode 10000004', 1)
build.write_text(s, encoding='utf-8')

# Mobile performance is mostly GPU/render-distance/GC pressure, not a contest to
# allocate the largest possible heap. Apply conservative defaults once and keep
# every later user change intact.
profile_java = r'''package net.kdt.pojavlaunch;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.DisplayMetrics;

import net.kdt.pojavlaunch.prefs.LauncherPreferences;

public final class BestiaryPerformanceProfile {
    private static final String REVISION_KEY = "bestiary_performance_revision";
    private static final int REVISION = 2;

    private BestiaryPerformanceProfile() {}

    public static void install(Context context) {
        SharedPreferences prefs = LauncherPreferences.DEFAULT_PREF;
        if (prefs.getInt(REVISION_KEY, 0) >= REVISION) return;

        int ram = Tools.getTotalDeviceMemory(context);
        int cores = Runtime.getRuntime().availableProcessors();
        DisplayMetrics dm = context.getResources().getDisplayMetrics();
        int minSide = Math.min(dm.widthPixels, dm.heightPixels);

        SharedPreferences.Editor edit = prefs.edit();
        // 7-8 GB phones do not benefit from a 3.9 GB heap here. Leave breathing
        // room for Android, native renderer buffers, textures and the launcher.
        if (!prefs.contains("allocation")) {
            int heap = ram >= 8192 ? 3072 : ram >= 6144 ? 2560 : ram >= 4096 ? 2048 : 1536;
            edit.putInt("allocation", heap);
        }
        if (!prefs.contains("resolutionRatio")) {
            int ratio = minSide >= 1440 ? 55 : minSide >= 1080 ? 65 : minSide >= 900 ? 75 : 85;
            edit.putInt("resolutionRatio", ratio);
        }
        if (!prefs.contains("sustainedPerformance")) edit.putBoolean("sustainedPerformance", cores >= 6);
        if (!prefs.contains("force_vsync")) edit.putBoolean("force_vsync", false);
        if (!prefs.contains("alternate_surface")) edit.putBoolean("alternate_surface", true);
        if (!prefs.contains("bigCoreAffinity")) edit.putBoolean("bigCoreAffinity", cores >= 8);
        if (!prefs.contains("javaArgs") || prefs.getString("javaArgs", "").trim().isEmpty()) {
            edit.putString("javaArgs", BestiaryJvmFlagGenerator.generate(context));
        }
        edit.putInt(REVISION_KEY, REVISION).apply();
    }
}
'''
(JAVA / 'BestiaryPerformanceProfile.java').write_text(profile_java, encoding='utf-8')

# Tune G1 for the smaller mobile heap. Avoid exotic flags that vary across the
# bundled Java runtimes.
generator = JAVA / 'BestiaryJvmFlagGenerator.java'
s = generator.read_text(encoding='utf-8')
req('flags.append("-XX:MaxGCPauseMillis=100 ");' in s, 'G1 pause marker missing')
s = s.replace('flags.append("-XX:MaxGCPauseMillis=100 ");', 'flags.append("-XX:MaxGCPauseMillis=75 ");\n        flags.append("-XX:G1ReservePercent=15 ");\n        flags.append("-XX:InitiatingHeapOccupancyPercent=30 ");', 1)
generator.write_text(s, encoding='utf-8')

app = JAVA / 'PojavApplication.java'
s = app.read_text(encoding='utf-8')
needle = '\t\t\t\tLauncherPreferences.loadPreferences(this);\n'
req(needle in s, 'preference load marker missing')
# Install defaults before the second preference load performed below, then reload
# the static preference fields so this process uses the new values immediately.
s = s.replace(needle, needle + '\t\t\t\tBestiaryPerformanceProfile.install(this);\n\t\t\t\tLauncherPreferences.loadPreferences(this);\n', 1)
app.write_text(s, encoding='utf-8')

req('versionName "1.0.4"' in build.read_text(encoding='utf-8'), '1.0.4 version missing')
req('resolutionRatio' in (JAVA / 'BestiaryPerformanceProfile.java').read_text(encoding='utf-8'), 'resolution profile missing')
req('G1ReservePercent=15' in generator.read_text(encoding='utf-8'), 'G1 reserve tuning missing')
print('Bestiary Android 1.0.4 adaptive performance patch applied')

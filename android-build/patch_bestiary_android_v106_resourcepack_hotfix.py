from pathlib import Path

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


# ---------------------------------------------------------------------------
# Bestiary Android 1.0.6 resource-pack stability hotfix.
# Resource reload temporarily duplicates decoded textures/models while the old
# GPU/native resources are still alive. Android therefore needs a real native
# memory reserve; a user-configured Xmx close to total device RAM is unsafe.
# ---------------------------------------------------------------------------
profile = JAVA / 'BestiaryPerformanceProfile.java'
s = profile.read_text(encoding='utf-8')
req('private static final int REVISION = 6;' in s, 'performance revision 6 marker missing')
s = s.replace('private static final int REVISION = 6;', 'private static final int REVISION = 7;', 1)

# Clamp persisted allocation on every profile migration, including arbitrary old
# user values. This is deliberately a safety invariant rather than a preference.
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
     * Hard safety ceiling for Android. This is not a performance recommendation;
     * it reserves memory for ART/JVM native structures, decoded resource-pack
     * images, OpenGL driver allocations, MobileGlues, audio and Android itself.
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


# Runtime enforcement: even if SharedPreferences/static fields are stale or a
# future settings path writes an unsafe value, the JVM can never launch above the
# Android memory safety ceiling.
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


# Capture enough process memory state in launcher log immediately before entering
# the embedded JVM. If Android kills the process during the next resource reload,
# the last log still records the effective heap and native-memory headroom policy.
main = JAVA / 'MainActivity.java'
m = main.read_text(encoding='utf-8')
needle = '        Tools.printLauncherInfo(mVersion, LauncherPreferences.PREF_CUSTOM_JAVA_ARGS, Tools.getTotalDeviceMemory(this));\n'
req(needle in m, 'launcher info marker missing')
m = m.replace(needle, needle + '''        Logger.appendToLog("Bestiary resource-pack safety: totalRam="
                + Tools.getTotalDeviceMemory(this) + "MB configuredHeap="
                + LauncherPreferences.PREF_RAM_ALLOCATION + "MB safeHeapCeiling="
                + BestiaryPerformanceProfile.safeMaxHeapMb(Tools.getTotalDeviceMemory(this)) + "MB");
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
req('Bestiary resource-pack safety' in main.read_text(encoding='utf-8'), 'resource-pack safety telemetry missing')
print('Bestiary Android 1.0.6 resource-pack memory stability hotfix applied')

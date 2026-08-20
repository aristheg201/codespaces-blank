from pathlib import Path
import base64
import re

ROOT = Path('amethyst')
APP = ROOT / 'app_pojavlauncher'
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'
FRAG = JAVA / 'fragments/MainMenuFragment.java'
RES = APP / 'src/main/res'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


def replace_once(path, old, new, message):
    text = path.read_text(encoding='utf-8')
    req(old in text, message)
    path.write_text(text.replace(old, new, 1), encoding='utf-8')


# ---------------------------------------------------------------------------
# Version/package metadata. Bestiary owns the APK identity and version.
# ---------------------------------------------------------------------------
build = APP / 'build.gradle'
s = build.read_text(encoding='utf-8')
req('versionName getVersionName()' in s, 'versionName marker missing')
s = s.replace('versionName getVersionName()', 'versionName "1.0.0"', 1)
build.write_text(s, encoding='utf-8')

# Launcher is portrait-first. Minecraft itself keeps the upstream game orientation.
manifest = APP / 'src/main/AndroidManifest.xml'
s = manifest.read_text(encoding='utf-8')
needle = 'android:name=".LauncherActivity"\n            android:label="@string/app_short_name"\n            android:windowSoftInputMode="adjustResize"/>'
req(needle in s, 'LauncherActivity manifest marker missing')
s = s.replace(
    needle,
    'android:name=".LauncherActivity"\n            android:label="@string/app_short_name"\n            android:screenOrientation="portrait"\n            android:windowSoftInputMode="adjustResize"/>',
    1,
)
# APK self-update is prepared but remains inert until products.android is published.
if 'android.permission.REQUEST_INSTALL_PACKAGES' not in s:
    s = s.replace(
        '<uses-permission android:name="android.permission.INTERNET" />',
        '<uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />',
        1,
    )
provider = '''        <provider
            android:name="androidx.core.content.FileProvider"
            android:authorities="${applicationId}.bestiary.updater"
            android:exported="false"
            android:grantUriPermissions="true">
            <meta-data
                android:name="android.support.FILE_PROVIDER_PATHS"
                android:resource="@xml/bestiary_update_paths" />
        </provider>
'''
if '.bestiary.updater' not in s:
    s = s.replace('        <activity\n            android:name=".MissingStorageActivity"', provider + '        <activity\n            android:name=".MissingStorageActivity"', 1)
manifest.write_text(s, encoding='utf-8')

xml_dir = RES / 'xml'
xml_dir.mkdir(parents=True, exist_ok=True)
(xml_dir / 'bestiary_update_paths.xml').write_text('''<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <cache-path name="updates" path="updates/" />
</paths>
''', encoding='utf-8')

# ---------------------------------------------------------------------------
# Exact Bestiary logo from the Windows build source. Do not redraw/re-export it.
# ---------------------------------------------------------------------------
chunks = sorted(Path('bestiary-build').glob('logo5-*'), key=lambda p: p.name)
req(chunks, 'Bestiary logo chunks are missing')
encoded = ''.join(p.read_text(encoding='utf-8').strip() for p in chunks)
try:
    logo = base64.b64decode(encoded, validate=True)
except Exception as exc:
    raise SystemExit('Bestiary logo chunks are invalid: ' + str(exc))
req(logo.startswith(b'\x89PNG\r\n\x1a\n'), 'Bestiary logo is not PNG')
drawable = RES / 'drawable-nodpi'
drawable.mkdir(parents=True, exist_ok=True)
(drawable / 'bestiary_logo.png').write_bytes(logo)

s = manifest.read_text(encoding='utf-8')
s = s.replace('android:icon="@mipmap/ic_launcher"', 'android:icon="@drawable/bestiary_logo"', 1)
s = s.replace('android:roundIcon="@mipmap/ic_launcher_round"', 'android:roundIcon="@drawable/bestiary_logo"', 1)
manifest.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# Distribution semantics: Android means Android. No Full/Lite leakage.
# ---------------------------------------------------------------------------
bootstrap_path = JAVA / 'BestiaryBootstrap.java'
b = bootstrap_path.read_text(encoding='utf-8')
# Production config uses minecraftVersion, not the historical defaultMinecraftVersion key.
b = b.replace('string(config, "defaultMinecraftVersion", minecraftVersion)', 'string(config, "minecraftVersion", minecraftVersion)')
needle = '            JsonObject item = el.getAsJsonObject();\n            String relative = normalize(item.get("path").getAsString());'
req(needle in b, 'manifest iteration marker missing')
b = b.replace(
    needle,
    '            JsonObject item = el.getAsJsonObject();\n            if (!includesAndroidProfile(item)) continue;\n            String relative = normalize(item.get("path").getAsString());',
    1,
)
# The manifest profile is authoritative. Do not silently delete Sodium/Iris from a curated Android set.
old_allowed = '''        // Renderer stack is platform-specific. Never force desktop Sodium/Iris onto Android.\n        if (lower.startsWith("mods/") && (lower.contains("sodium") || lower.contains("iris"))) return false;\n        return true;'''
req(old_allowed in b, 'old renderer blacklist marker missing')
b = b.replace(old_allowed, '        return true;', 1)
insert = '    private static boolean isAllowed(String path) {'
helper = '''    private static boolean includesAndroidProfile(JsonObject item) {
        JsonArray profiles = item.getAsJsonArray("profiles");
        if (profiles == null || profiles.size() == 0) return false;
        for (JsonElement profile : profiles) {
            if ("android".equalsIgnoreCase(profile.getAsString())) return true;
        }
        return false;
    }

'''
req(insert in b, 'isAllowed marker missing')
b = b.replace(insert, helper + insert, 1)
# Renderer compatibility is selected after the exact Android mod set exists.
needle = '                syncManagedFiles();\n                ensureBestiaryProfile();'
req(needle in b, 'sync renderer hook marker missing')
b = b.replace(needle, '                syncManagedFiles();\n                ensureBestiaryProfile();\n                BestiaryRendererPolicy.apply();', 1)

# Announcements are loaded from the same distribution source as desktop.
insert = '    private static void loadRuntimeMetadata() throws Exception {'
ann = '''    public static void showAnnouncements(Activity activity) {
        PojavApplication.sExecutorService.execute(() -> {
            String title = "THÔNG BÁO";
            String body = "Chưa có thông báo mới.";
            try {
                JsonObject root = JsonParser.parseString(readUrl(BASE + "/announcements.json")).getAsJsonObject();
                JsonArray items = root.getAsJsonArray("items");
                if (items != null && items.size() > 0) {
                    JsonObject item = items.get(0).getAsJsonObject();
                    if (item.has("title")) title = item.get("title").getAsString();
                    if (item.has("body")) body = item.get("body").getAsString()
                            .replace("**", "").replace("---", "");
                }
            } catch (Throwable ignored) {
                body = "Không tải được thông báo. Kiểm tra kết nối mạng rồi thử lại.";
            }
            final String dialogTitle = title;
            final String dialogBody = body;
            Tools.runOnUiThread(() -> new androidx.appcompat.app.AlertDialog.Builder(activity)
                    .setTitle(dialogTitle)
                    .setMessage(dialogBody)
                    .setPositiveButton("Đóng", null)
                    .show());
        });
    }

'''
req(insert in b, 'runtime metadata marker missing')
b = b.replace(insert, ann + insert, 1)
bootstrap_path.write_text(b, encoding='utf-8')

# ---------------------------------------------------------------------------
# Renderer policy. No mod JAR is modified. AUTO is conservative and uses
# Amethyst's maintained modern GLES path; users can override through a Bestiary
# pref later without touching the modpack.
# ---------------------------------------------------------------------------
renderer = r'''package net.kdt.pojavlaunch;

import android.os.Build;
import android.util.Log;

import net.kdt.pojavlaunch.prefs.LauncherPreferences;
import net.kdt.pojavlaunch.value.launcherprofiles.LauncherProfiles;
import net.kdt.pojavlaunch.value.launcherprofiles.MinecraftProfile;

import java.io.File;
import java.util.Locale;

public final class BestiaryRendererPolicy {
    private static final String TAG = "BestiaryRenderer";
    private static final String PREF = "bestiary_renderer";
    private static final String MOBILEGLUES = "opengles_mobileglues";

    private BestiaryRendererPolicy() {}

    public static void apply() {
        LauncherProfiles.load();
        String key = LauncherPreferences.DEFAULT_PREF.getString(LauncherPreferences.PREF_KEY_CURRENT_PROFILE, null);
        if (key == null) return;
        MinecraftProfile profile = LauncherProfiles.mainProfileJson.profiles.get(key);
        if (profile == null || !"Bestiary Rebirth".equals(profile.name)) return;

        String override = LauncherPreferences.DEFAULT_PREF.getString(PREF, "AUTO");
        String renderer = chooseRenderer(override);
        profile.pojavRendererName = renderer;
        LauncherProfiles.write();
        Log.i(TAG, "renderer=" + renderer + " gpuFamily=" + gpuFamily() + " sodium=" + hasMod("sodium") + " iris=" + hasMod("iris"));
    }

    private static String chooseRenderer(String override) {
        if (override != null && override.startsWith("opengles_")) return override;
        // MobileGlues is the maintained Amethyst path for the modern Fabric rendering stack.
        // The Android manifest decides whether Sodium/Iris/other render mods are installed.
        return MOBILEGLUES;
    }

    private static String gpuFamily() {
        String hw = (Build.HARDWARE + " " + Build.BOARD + " " + Build.MANUFACTURER).toLowerCase(Locale.ROOT);
        if (hw.contains("qcom") || hw.contains("qualcomm") || hw.contains("sm")) return "ADRENO";
        if (hw.contains("exynos")) return "EXYNOS";
        if (hw.contains("mt") || hw.contains("mediatek")) return "MALI";
        if (hw.contains("powervr")) return "POWERVR";
        return "UNKNOWN";
    }

    private static boolean hasMod(String token) {
        File dir = new File(Tools.DIR_GAME_NEW, "mods");
        File[] files = dir.listFiles();
        if (files == null) return false;
        String needle = token.toLowerCase(Locale.ROOT);
        for (File file : files) {
            if (file.isFile() && file.getName().toLowerCase(Locale.ROOT).contains(needle)) return true;
        }
        return false;
    }
}
'''
(JAVA / 'BestiaryRendererPolicy.java').write_text(renderer, encoding='utf-8')

# ---------------------------------------------------------------------------
# APK updater. It is dormant until app-updates.json contains products.android.
# It downloads to private cache, verifies SHA-256, then invokes Android's package
# installer. No silent installs and no unsigned public channel.
# ---------------------------------------------------------------------------
updater = r'''package net.kdt.pojavlaunch;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.util.Log;

import androidx.core.content.FileProvider;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;

public final class BestiaryAppUpdater {
    private static final String TAG = "BestiaryUpdater";
    private static final String CHANNEL = "https://raw.githubusercontent.com/aristheg201/bestiary-distribution/main/bestiary-distribution/app-updates.json";

    private BestiaryAppUpdater() {}

    public static void check(Activity activity) {
        PojavApplication.sExecutorService.execute(() -> {
            try {
                JsonObject root = JsonParser.parseString(readText(CHANNEL)).getAsJsonObject();
                JsonObject products = root.getAsJsonObject("products");
                if (products == null || !products.has("android")) return;
                JsonObject android = products.getAsJsonObject("android");
                String latest = android.get("version").getAsString();
                String current = BuildConfig.VERSION_NAME;
                if (compare(latest, current) <= 0) return;
                String url = android.has("apkUrl") ? android.get("apkUrl").getAsString() : android.get("installerUrl").getAsString();
                String expected = android.get("sha256").getAsString().toLowerCase(Locale.ROOT);
                if (!expected.matches("[a-f0-9]{64}")) throw new IllegalStateException("SHA update không hợp lệ");
                Tools.runOnUiThread(() -> new androidx.appcompat.app.AlertDialog.Builder(activity)
                        .setTitle("CÓ BẢN " + latest)
                        .setMessage("Tải và cài bản Bestiary Launcher Android mới? Gói APK sẽ được kiểm SHA-256 trước khi mở trình cài đặt Android.")
                        .setNegativeButton("Để sau", null)
                        .setPositiveButton("Cập nhật", (d, w) -> download(activity, latest, url, expected))
                        .show());
            } catch (Throwable t) {
                Log.w(TAG, "Update check skipped", t);
            }
        });
    }

    private static void download(Activity activity, String version, String source, String expected) {
        PojavApplication.sExecutorService.execute(() -> {
            try {
                File dir = new File(activity.getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Không tạo được thư mục update");
                File apk = new File(dir, "BestiaryLauncher-Android-" + version + ".apk");
                HttpURLConnection conn = open(source);
                try (InputStream in = new BufferedInputStream(conn.getInputStream()); FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024]; int n;
                    while ((n = in.read(buf)) != -1) if (n > 0) out.write(buf, 0, n);
                } finally { conn.disconnect(); }
                if (!expected.equals(sha256(apk))) { apk.delete(); throw new IllegalStateException("SHA-256 APK không khớp"); }
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".bestiary.updater", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                activity.startActivity(intent);
            } catch (Throwable t) {
                Log.e(TAG, "Update failed", t);
                Tools.runOnUiThread(() -> android.widget.Toast.makeText(activity, "Cập nhật lỗi: " + t.getMessage(), android.widget.Toast.LENGTH_LONG).show());
            }
        });
    }

    private static String readText(String source) throws Exception {
        HttpURLConnection conn = open(source);
        try (InputStream in = new BufferedInputStream(conn.getInputStream())) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[16 * 1024]; int n;
            while ((n = in.read(buf)) != -1) if (n > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } finally { conn.disconnect(); }
    }

    private static HttpURLConnection open(String source) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(source).openConnection();
        conn.setConnectTimeout(15000); conn.setReadTimeout(30000); conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent", "BestiaryLauncher-Android/1.0.0");
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) { conn.disconnect(); throw new IllegalStateException("HTTP " + code); }
        return conn;
    }

    private static int compare(String a, String b) {
        String[] aa = a.replaceFirst("^[vV]", "").split("\\.");
        String[] bb = b.replaceFirst("^[vV]", "").split("\\.");
        int count = Math.max(aa.length, bb.length);
        for (int i = 0; i < count; i++) {
            int av = i < aa.length ? number(aa[i]) : 0;
            int bv = i < bb.length ? number(bb[i]) : 0;
            if (av != bv) return av < bv ? -1 : 1;
        }
        return 0;
    }

    private static int number(String value) {
        try { return Integer.parseInt(value.replaceAll("[^0-9].*$", "")); } catch (Exception ignored) { return 0; }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new java.io.FileInputStream(file))) {
            byte[] buf = new byte[64 * 1024]; int n;
            while ((n = in.read(buf)) != -1) if (n > 0) md.update(buf, 0, n);
        }
        StringBuilder out = new StringBuilder();
        for (byte value : md.digest()) out.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return out.toString();
    }
}
'''
(JAVA / 'BestiaryAppUpdater.java').write_text(updater, encoding='utf-8')

# Check app updates after the launcher views exist. With no products.android this is a no-op.
launcher = JAVA / 'LauncherActivity.java'
ls = launcher.read_text(encoding='utf-8')
needle = '        bindViews();\n        if (!BestiaryOfflineAccount.hasAccount(this)) {'
req(needle in ls, 'LauncherActivity post-bind marker missing')
ls = ls.replace(needle, '        bindViews();\n        BestiaryAppUpdater.check(this);\n        if (!BestiaryOfflineAccount.hasAccount(this)) {', 1)
launcher.write_text(ls, encoding='utf-8')

# ---------------------------------------------------------------------------
# Bestiary portrait home. Existing IDs are retained so upstream lifecycle code
# remains valid; only the presentation and Bestiary-specific actions change.
# ---------------------------------------------------------------------------
layout = '''<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:id="@+id/fragment_menu_main"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/background_app">

    <ScrollView
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:fillViewport="true"
        app:layout_constraintTop_toTopOf="parent"
        app:layout_constraintBottom_toTopOf="@id/play_button">
        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="vertical"
            android:gravity="center_horizontal"
            android:paddingStart="20dp"
            android:paddingEnd="20dp"
            android:paddingTop="20dp"
            android:paddingBottom="18dp">

            <ImageView
                android:layout_width="112dp"
                android:layout_height="112dp"
                android:src="@drawable/bestiary_logo"
                android:contentDescription="Bestiary"
                android:scaleType="fitCenter" />
            <TextView
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="BESTIARY REBIRTH"
                android:textStyle="bold"
                android:textSize="24sp"
                android:layout_marginTop="10dp" />
            <TextView
                android:layout_width="wrap_content"
                android:layout_height="wrap_content"
                android:text="ANDROID · LOCAL/OFFLINE · FABRIC 1.21.1"
                android:textSize="12sp"
                android:alpha="0.75"
                android:layout_marginBottom="18dp" />

            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/news_button"
                style="@style/LauncherMenuButton.Universal"
                android:layout_width="match_parent"
                android:text="THÔNG BÁO" />
            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/discord_button"
                style="@style/LauncherMenuButton.Universal"
                android:layout_width="match_parent"
                android:text="DISCORD" />
            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/custom_control_button"
                style="@style/LauncherMenuButton.Universal"
                android:layout_width="match_parent"
                android:text="ĐIỀU KHIỂN" />
            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/install_jar_button"
                style="@style/LauncherMenuButton.Universal"
                android:layout_width="match_parent"
                android:text="CÀI MOD / THƯ VIỆN" />
            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/open_files_button"
                style="@style/LauncherMenuButton.Universal"
                android:layout_width="match_parent"
                android:text="MỞ THƯ MỤC GAME" />
            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/share_logs_button"
                style="@style/LauncherMenuButton.Universal"
                android:layout_width="match_parent"
                android:text="CHIA SẺ LOG" />

            <com.kdt.mcgui.mcVersionSpinner
                android:id="@+id/mc_version_spinner"
                android:layout_width="1dp"
                android:layout_height="1dp"
                android:visibility="invisible" />
            <ImageButton
                android:id="@+id/edit_profile_button"
                android:layout_width="1dp"
                android:layout_height="1dp"
                android:visibility="invisible"
                android:contentDescription="profile" />
        </LinearLayout>
    </ScrollView>

    <com.kdt.mcgui.MineButton
        android:id="@+id/play_button"
        android:layout_width="0dp"
        android:layout_height="62dp"
        android:layout_marginStart="18dp"
        android:layout_marginEnd="18dp"
        android:layout_marginBottom="16dp"
        android:text="CHƠI NGAY"
        android:textAllCaps="true"
        app:layout_constraintStart_toStartOf="parent"
        app:layout_constraintEnd_toEndOf="parent"
        app:layout_constraintBottom_toBottomOf="parent" />
</androidx.constraintlayout.widget.ConstraintLayout>
'''
(RES / 'layout/fragment_launcher.xml').write_text(layout, encoding='utf-8')

# Main menu actions: no online-profile checks and no upstream Sodium deletion dialog.
f = FRAG.read_text(encoding='utf-8')
if 'import net.kdt.pojavlaunch.BestiaryBootstrap;' not in f:
    f = f.replace('import net.kdt.pojavlaunch.CustomControlsActivity;', 'import net.kdt.pojavlaunch.BestiaryBootstrap;\nimport net.kdt.pojavlaunch.CustomControlsActivity;', 1)
f = f.replace('mNewsButton.setOnClickListener(v -> Tools.openURL(requireActivity(), Tools.URL_HOME));', 'mNewsButton.setOnClickListener(v -> BestiaryBootstrap.showAnnouncements(requireActivity()));', 1)
f = f.replace('mDiscordButton.setOnClickListener(v -> Tools.openURL(requireActivity(), getString(R.string.discord_invite)));', 'mDiscordButton.setOnClickListener(v -> Tools.openURL(requireActivity(), "https://discord.com/invite/HeYXW6AT3v"));', 1)
old = '''        if (hasOnlineProfile()) {
            mInstallJarButton.setOnClickListener(v -> runInstallerWithConfirmation(false));
            mInstallJarButton.setOnLongClickListener(v -> {
                runInstallerWithConfirmation(true);
                return true;
            });
        } else mInstallJarButton.setOnClickListener(v -> hasNoOnlineProfileDialog(requireActivity()));'''
req(old in f, 'online installer guard missing')
f = f.replace(old, '''        mInstallJarButton.setOnClickListener(v -> runInstallerWithConfirmation(false));
        mInstallJarButton.setOnLongClickListener(v -> {
            runInstallerWithConfirmation(true);
            return true;
        });''', 1)
play_re = re.compile(r'''        mPlayButton\.setOnClickListener\(v -> \{\n            if \(Tools\.hasMods\("sodium"\).*?\n        \}\);''', re.S)
match = play_re.search(f)
req(match is not None, 'upstream Sodium warning play block missing')
f = f[:match.start()] + '        mPlayButton.setOnClickListener(v -> ExtraCore.setValue(ExtraConstants.LAUNCH_GAME, true));' + f[match.end():]
old = '''        mOpenDirectoryButton.setOnClickListener((v)-> {
            if (Tools.isDemoProfile(v.getContext())){ // Say a different message when on demo profile since they might see the hidden demo folder
                hasNoOnlineProfileDialog(getActivity(), getString(R.string.demo_unsupported), getString(R.string.change_account));
            } else if (!hasOnlineProfile()) { // Otherwise display the generic pop-up to log in
                hasNoOnlineProfileDialog(requireActivity());
            } else openPath(v.getContext(), getCurrentProfileDirectory(), false);

        });'''
req(old in f, 'online directory guard missing')
f = f.replace(old, '        mOpenDirectoryButton.setOnClickListener((v) -> openPath(v.getContext(), getCurrentProfileDirectory(), false));', 1)
FRAG.write_text(f, encoding='utf-8')

# Contract: no Microsoft/auth picker is reachable from the launcher activity after Bestiary patches.
launcher_text = launcher.read_text(encoding='utf-8')
req('BestiaryOfflineAccount.prompt(this)' in launcher_text, 'offline account route missing')
req('Tools.swapFragment(this, SelectAuthFragment.class' not in launcher_text, 'Microsoft/auth picker still reachable')
req('BestiaryAppUpdater.check(this)' in launcher_text, 'APK updater hook missing')
req('includesAndroidProfile(item)' in bootstrap_path.read_text(encoding='utf-8'), 'android profile filter missing')
req('BestiaryRendererPolicy.apply()' in bootstrap_path.read_text(encoding='utf-8'), 'renderer policy hook missing')
req('CHƠI NGAY' in (RES / 'layout/fragment_launcher.xml').read_text(encoding='utf-8'), 'portrait Play CTA missing')
req((drawable / 'bestiary_logo.png').is_file(), 'Bestiary logo resource missing')

print('Bestiary Android 1.0.0 portrait/offline/profile/render/updater patch applied')

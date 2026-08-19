from __future__ import annotations

from pathlib import Path

ROOT = Path("amethyst")
APP = ROOT / "app_pojavlauncher"
JAVA = APP / "src/main/java/net/kdt/pojavlaunch"


def replace(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"patch marker not found in {path}: {old[:100]!r}")
    path.write_text(text.replace(old, new), encoding="utf-8")


# Android application identity. Java namespace stays upstream-compatible; only the installed package changes.
build_gradle = APP / "build.gradle"
replace(build_gradle, 'applicationId "org.angelauramc.amethyst"', 'applicationId "vn.svframe.bestiary.launcher"')
replace(build_gradle, 'versionCode 10000000', 'versionCode 10000001')
replace(build_gradle, 'resValue "string", "app_name", "Amethyst (Debug)"', 'resValue "string", "app_name", "Bestiary Launcher"')
replace(build_gradle, 'resValue "string", "app_short_name", "Amethyst (Debug)"', 'resValue "string", "app_short_name", "Bestiary"')
replace(build_gradle, "resValue 'string', 'application_package', 'org.angelauramc.amethyst.debug'", "resValue 'string', 'application_package', 'vn.svframe.bestiary.launcher.debug'")
replace(build_gradle, "resValue 'string', 'storageProviderAuthorities', 'org.angelauramc.amethyst.scoped.gamefolder.debug'", "resValue 'string', 'storageProviderAuthorities', 'vn.svframe.bestiary.launcher.scoped.gamefolder.debug'")
replace(build_gradle, "resValue 'string', 'shareProviderAuthority', 'org.angelauramc.amethyst.scoped.controlfolder.debug'", "resValue 'string', 'shareProviderAuthority', 'vn.svframe.bestiary.launcher.scoped.controlfolder.debug'")
replace(build_gradle, 'resValue "string", "app_name", "Amethyst"', 'resValue "string", "app_name", "Bestiary Launcher"')
replace(build_gradle, 'resValue "string", "app_short_name", "Amethyst"', 'resValue "string", "app_short_name", "Bestiary"')
replace(build_gradle, "resValue 'string', 'storageProviderAuthorities', 'org.angelauramc.amethyst.scoped.gamefolder'", "resValue 'string', 'storageProviderAuthorities', 'vn.svframe.bestiary.launcher.scoped.gamefolder'")
replace(build_gradle, "resValue 'string', 'application_package', 'org.angelauramc.amethyst'", "resValue 'string', 'application_package', 'vn.svframe.bestiary.launcher'")

# Keep Bestiary data in its own Android app sandbox/folder instead of impersonating Amethyst.
tools = JAVA / "Tools.java"
replace(tools, 'public static String APP_NAME = "Amethyst";', 'public static String APP_NAME = "Bestiary Launcher";')
replace(tools, 'Environment.getExternalStorageDirectory().getAbsolutePath() + "/games/Amethyst"', 'Environment.getExternalStorageDirectory().getAbsolutePath() + "/games/Bestiary"')
replace(tools, 'new File(Environment.getExternalStorageDirectory(),"games/Amethyst")', 'new File(Environment.getExternalStorageDirectory(),"games/Bestiary")')

bootstrap = r'''package net.kdt.pojavlaunch;

import android.app.Activity;
import android.content.SharedPreferences;
import android.util.Log;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import net.kdt.pojavlaunch.prefs.LauncherPreferences;
import net.kdt.pojavlaunch.value.launcherprofiles.LauncherProfiles;
import net.kdt.pojavlaunch.value.launcherprofiles.MinecraftProfile;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;

/** Bestiary-owned bootstrap/sync layer. It deliberately never deletes files it did not previously own. */
public final class BestiaryBootstrap {
    private static final String TAG = "BestiaryBootstrap";
    private static final String BASE = "https://raw.githubusercontent.com/aristheg201/bestiary-distribution/main/bestiary-distribution";
    private static final String STABLE = BASE + "/channels/stable.json";
    private static final String TESTING = BASE + "/channels/testing.json";
    private static final String FABRIC_PROFILE = "https://meta.fabricmc.net/v2/versions/loader/1.21.1/0.18.4/profile/json";
    private static final AtomicBoolean STARTED = new AtomicBoolean(false);
    private static volatile boolean ready = false;
    private static volatile String status = "Chưa đồng bộ";

    private BestiaryBootstrap() {}

    public static void start(Activity activity) {
        if (!STARTED.compareAndSet(false, true)) return;
        PojavApplication.sExecutorService.execute(() -> {
            try {
                status = "Đang chuẩn bị Bestiary Rebirth";
                ensureFabricProfile();
                syncManagedFiles();
                ensureBestiaryProfile();
                ready = true;
                status = "Sẵn sàng";
                Log.i(TAG, "Bestiary Android bootstrap complete");
            } catch (Throwable t) {
                status = "Đồng bộ lỗi: " + t.getMessage();
                Log.e(TAG, "Bootstrap failed", t);
            }
        });
    }

    public static boolean isReady() { return ready; }
    public static String getStatus() { return status; }

    private static void ensureFabricProfile() throws Exception {
        String json = readUrl(FABRIC_PROFILE);
        JsonObject profile = JsonParser.parseString(json).getAsJsonObject();
        String id = profile.get("id").getAsString();
        File dir = new File(Tools.DIR_HOME_VERSION, id);
        File file = new File(dir, id + ".json");
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Không tạo được thư mục Fabric");
        if (!file.exists() || !sha256(file).equals(sha256(json.getBytes(StandardCharsets.UTF_8)))) {
            writeAtomic(file, json.getBytes(StandardCharsets.UTF_8));
        }
    }

    private static void ensureBestiaryProfile() throws Exception {
        JsonObject profileJson = JsonParser.parseString(readUrl(FABRIC_PROFILE)).getAsJsonObject();
        String versionId = profileJson.get("id").getAsString();
        LauncherProfiles.load();
        String found = null;
        for (String key : LauncherProfiles.mainProfileJson.profiles.keySet()) {
            MinecraftProfile p = LauncherProfiles.mainProfileJson.profiles.get(key);
            if (p != null && "Bestiary Rebirth".equals(p.name)) { found = key; break; }
        }
        if (found == null) {
            found = UUID.randomUUID().toString();
            LauncherProfiles.mainProfileJson.profiles.put(found, new MinecraftProfile());
        }
        MinecraftProfile p = LauncherProfiles.mainProfileJson.profiles.get(found);
        p.name = "Bestiary Rebirth";
        p.lastVersionId = versionId;
        p.icon = "fabric";
        // MobileGlues is Amethyst's modern GLES compatibility path. Sodium remains optional, never required.
        if (p.pojavRendererName == null || p.pojavRendererName.isBlank()) p.pojavRendererName = "opengles_mobileglues";
        LauncherProfiles.write();
        SharedPreferences.Editor editor = LauncherPreferences.DEFAULT_PREF.edit();
        editor.putString(LauncherPreferences.PREF_KEY_CURRENT_PROFILE, found).apply();
    }

    private static void syncManagedFiles() throws Exception {
        File game = new File(Tools.DIR_GAME_NEW);
        if (!game.exists() && !game.mkdirs()) throw new IOException("Không tạo được thư mục game");
        File state = new File(Tools.DIR_GAME_HOME, "bestiary-managed.json");
        Set<String> oldOwned = readOwnership(state);
        Set<String> desired = new HashSet<>();

        JsonObject channel;
        try { channel = JsonParser.parseString(readUrl(STABLE)).getAsJsonObject(); }
        catch (Exception ignored) { channel = JsonParser.parseString(readUrl(TESTING)).getAsJsonObject(); }
        String manifestUrl = channel.has("manifestUrl") ? channel.get("manifestUrl").getAsString() : channel.get("manifest").getAsString();
        JsonObject manifest = JsonParser.parseString(readUrl(manifestUrl)).getAsJsonObject();
        JsonArray files = manifest.getAsJsonArray("files");
        if (files == null) throw new IOException("Manifest không có files");

        int index = 0;
        for (JsonElement el : files) {
            index++;
            JsonObject item = el.getAsJsonObject();
            String relative = normalize(item.get("path").getAsString());
            if (!isAllowed(relative)) continue;
            String expected = item.get("hash").getAsString().toLowerCase(Locale.ROOT);
            String url = item.has("downloadUrl") ? item.get("downloadUrl").getAsString() : item.get("url").getAsString();
            desired.add(relative);
            File target = safeResolve(game, relative);
            status = "Đồng bộ " + index + "/" + files.size() + ": " + target.getName();
            if (target.isFile() && expected.equals(sha256(target))) continue;
            if (target.getParentFile() != null && !target.getParentFile().exists() && !target.getParentFile().mkdirs()) throw new IOException("Không tạo được thư mục " + relative);
            downloadVerified(url, target, expected);
        }

        // Delete only files recorded as Bestiary-owned on the previous successful sync.
        for (String relative : oldOwned) {
            if (desired.contains(relative)) continue;
            File target = safeResolve(game, relative);
            if (target.isFile() && !target.delete()) Log.w(TAG, "Could not remove stale managed file: " + relative);
        }
        writeOwnership(state, desired);
    }

    private static boolean isAllowed(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.contains("../") || lower.startsWith("/")) return false;
        // Renderer stack is platform-specific. Never force desktop Sodium/Iris onto Android.
        if (lower.startsWith("mods/") && (lower.contains("sodium") || lower.contains("iris"))) return false;
        return true;
    }

    private static String normalize(String path) { return path.replace('\\', '/').replaceFirst("^/+", ""); }

    private static File safeResolve(File root, String relative) throws IOException {
        File out = new File(root, relative).getCanonicalFile();
        String rootPath = root.getCanonicalPath() + File.separator;
        if (!out.getPath().startsWith(rootPath)) throw new IOException("Đường dẫn manifest không hợp lệ: " + relative);
        return out;
    }

    private static Set<String> readOwnership(File state) {
        Set<String> out = new HashSet<>();
        if (!state.isFile()) return out;
        try {
            JsonObject obj = JsonParser.parseString(readFile(state)).getAsJsonObject();
            JsonArray arr = obj.getAsJsonArray("paths");
            if (arr != null) for (JsonElement e : arr) out.add(normalize(e.getAsString()));
        } catch (Throwable t) { Log.w(TAG, "Ignoring invalid ownership state", t); }
        return out;
    }

    private static void writeOwnership(File state, Set<String> paths) throws Exception {
        JsonObject obj = new JsonObject();
        JsonArray arr = new JsonArray();
        paths.stream().sorted().forEach(arr::add);
        obj.add("paths", arr);
        writeAtomic(state, Tools.GLOBAL_GSON.toJson(obj).getBytes(StandardCharsets.UTF_8));
    }

    private static void downloadVerified(String source, File target, String expected) throws Exception {
        File temp = new File(target.getParentFile(), target.getName() + ".bestiary.part");
        HttpURLConnection conn = open(source);
        try (InputStream in = new BufferedInputStream(conn.getInputStream());
             BufferedOutputStream out = new BufferedOutputStream(new FileOutputStream(temp))) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) >= 0) if (n > 0) out.write(buf, 0, n);
        } finally { conn.disconnect(); }
        String actual = sha256(temp);
        if (!expected.equals(actual)) { temp.delete(); throw new IOException("SHA-256 sai cho " + target.getName()); }
        if (target.exists() && !target.delete()) { temp.delete(); throw new IOException("Không thay được " + target.getName()); }
        if (!temp.renameTo(target)) { temp.delete(); throw new IOException("Atomic move lỗi cho " + target.getName()); }
    }

    private static String readUrl(String source) throws Exception {
        HttpURLConnection conn = open(source);
        try (InputStream in = new BufferedInputStream(conn.getInputStream())) {
            byte[] bytes = in.readAllBytes();
            return new String(bytes, StandardCharsets.UTF_8);
        } finally { conn.disconnect(); }
    }

    private static HttpURLConnection open(String source) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(source).openConnection();
        conn.setConnectTimeout(15000);
        conn.setReadTimeout(30000);
        conn.setInstanceFollowRedirects(true);
        conn.setRequestProperty("User-Agent", "BestiaryLauncher-Android/1.0.0");
        conn.setRequestProperty("Cache-Control", "no-cache");
        int code = conn.getResponseCode();
        if (code < 200 || code >= 300) { conn.disconnect(); throw new IOException("HTTP " + code + " từ " + source); }
        return conn;
    }

    private static String readFile(File file) throws Exception {
        try (FileInputStream in = new FileInputStream(file)) { return new String(in.readAllBytes(), StandardCharsets.UTF_8); }
    }

    private static void writeAtomic(File target, byte[] data) throws Exception {
        if (target.getParentFile() != null && !target.getParentFile().exists() && !target.getParentFile().mkdirs()) throw new IOException("Không tạo được thư mục");
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) { out.write(data); out.getFD().sync(); }
        if (target.exists() && !target.delete()) { temp.delete(); throw new IOException("Không thay được file"); }
        if (!temp.renameTo(target)) { temp.delete(); throw new IOException("Không chuyển file tạm"); }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buf = new byte[64 * 1024]; int n;
            while ((n = in.read(buf)) >= 0) if (n > 0) md.update(buf, 0, n);
        }
        return hex(md.digest());
    }

    private static String sha256(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256"); md.update(data); return hex(md.digest());
    }

    private static String hex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format(Locale.ROOT, "%02x", b & 0xff));
        return sb.toString();
    }
}
'''
(JAVA / "BestiaryBootstrap.java").write_text(bootstrap, encoding="utf-8")

launcher = JAVA / "LauncherActivity.java"
text = launcher.read_text(encoding="utf-8")
marker = "        setContentView(R.layout.activity_pojav_launcher);\n"
if marker not in text:
    raise SystemExit("LauncherActivity onCreate marker missing")
text = text.replace(marker, marker + "        BestiaryBootstrap.start(this);\n", 1)

launch_marker = "    private final ExtraListener<Boolean> mLaunchGameListener = (key, value) -> {\n"
if launch_marker not in text:
    raise SystemExit("Launch listener marker missing")
text = text.replace(
    launch_marker,
    launch_marker
    + "        if (!BestiaryBootstrap.isReady()) {\n"
    + "            Toast.makeText(this, BestiaryBootstrap.getStatus(), Toast.LENGTH_LONG).show();\n"
    + "            BestiaryBootstrap.start(this);\n"
    + "            return false;\n"
    + "        }\n\n",
    1,
)
launcher.write_text(text, encoding="utf-8")

# Add build provenance without pretending this is upstream Amethyst.
readme = ROOT / "BESTIARY_ANDROID.md"
readme.write_text(
    "# Bestiary Launcher Android\n\n"
    "Publisher: SVFrame Team Studio\n\n"
    "Upstream runtime: AngelAuraMC/Amethyst-Android pinned to commit 360d708262ff703d9b52782d20cd348410a33df5.\n\n"
    "Minecraft profile: 1.21.1 / Fabric Loader 0.18.4 / Java 21.\n\n"
    "Bestiary sync uses SHA-256 verified temporary downloads and an ownership state file. Only previously Bestiary-owned files can be removed. Sodium/Iris are excluded from Android managed sync; renderer-specific optimization remains optional.\n",
    encoding="utf-8",
)

print("Bestiary Android patches applied")

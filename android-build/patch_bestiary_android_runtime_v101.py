from pathlib import Path
import re

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


# ---------------------------------------------------------------------------
# 1. Version 1.0.1. Keep Android application identity, bump only this build.
# ---------------------------------------------------------------------------
build = APP / 'build.gradle'
s = build.read_text(encoding='utf-8')
req('versionName "1.0.0"' in s, '1.0.0 versionName marker missing')
s = s.replace('versionName "1.0.0"', 'versionName "1.0.1"', 1)
if 'versionCode 10000001' in s:
    s = s.replace('versionCode 10000001', 'versionCode 10000002', 1)
build.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# 2. Upstream intentionally refuses to download Minecraft for local accounts.
# Bestiary Android is local-only, so network availability, not account type,
# decides whether the normal Minecraft downloader may install the game.
# This reuses upstream's metadata/client/assets/libraries/JRE progress pipeline.
# ---------------------------------------------------------------------------
downloader = JAVA / 'tasks/MinecraftDownloader.java'
s = downloader.read_text(encoding='utf-8')
needle = '                if(isLocalProfile || !isOnline) {'
req(needle in s, 'MinecraftDownloader local-account gate missing')
s = s.replace(needle, '                if(!isOnline) {', 1)
downloader.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# 3. Local identity UX. Use a neutral default, close after Save, and refresh
# the spinner in place. Do not recreate LauncherActivity, which caused the
# first-run prompt to be scheduled again.
# ---------------------------------------------------------------------------
offline = JAVA / 'BestiaryOfflineAccount.java'
s = offline.read_text(encoding='utf-8')
req('input.setHint("VD: Arisgrindel");' in s, 'old username example missing')
s = s.replace('input.setHint("VD: Arisgrindel");', 'input.setHint("VD: abc123");', 1)
old = '''        String old = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_NAME, "");
        if (old != null) input.setText(old);'''
req(old in s, 'offline username default marker missing')
s = s.replace(old, '''        String old = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_NAME, "");
        if (old == null || old.trim().isEmpty()) input.setText("abc123");
        else input.setText(old);
        input.setSelection(input.getText().length());''', 1)
old = '''                dialog.dismiss();
                activity.recreate();'''
req(old in s, 'offline recreate marker missing')
s = s.replace(old, '''                dialog.dismiss();
                if (activity instanceof LauncherActivity) {
                    ((LauncherActivity) activity).refreshBestiaryAccount();
                }''', 1)
offline.write_text(s, encoding='utf-8')

spinner = APP / 'src/main/java/com/kdt/mcgui/mcAccountSpinner.java'
s = spinner.read_text(encoding='utf-8')
marker = '    private void performLogin(MinecraftAccount minecraftAccount){\n'
req(marker in s, 'mcAccountSpinner performLogin marker missing')
s = s.replace(marker, '''    /** Bestiary local-only identity refresh after the Save dialog closes. */
    public void bestiaryReloadAccounts() {
        reloadAccounts(true, 0);
    }

''' + marker, 1)
spinner.write_text(s, encoding='utf-8')

launcher = JAVA / 'LauncherActivity.java'
s = launcher.read_text(encoding='utf-8')
marker = '    @Override\n    protected void onResume() {\n'
req(marker in s, 'LauncherActivity onResume marker missing')
s = s.replace(marker, '''    public void refreshBestiaryAccount() {
        if (mAccountSpinner != null) mAccountSpinner.bestiaryReloadAccounts();
    }

''' + marker, 1)
launcher.write_text(s, encoding='utf-8')

# ---------------------------------------------------------------------------
# 4. Replace the generated bootstrap orchestration with an install/sync flow
# that prepares the vanilla source metadata before Fabric, strictly selects
# the Android profile, and reports progress through Amethyst's real progress UI.
# MinecraftDownloader then installs the client JAR, libraries, assets and JRE 21.
# ---------------------------------------------------------------------------
bootstrap = JAVA / 'BestiaryBootstrap.java'
b = bootstrap.read_text(encoding='utf-8')
if 'import com.kdt.mcgui.ProgressLayout;' not in b:
    marker = 'import com.google.gson.JsonArray;\n'
    req(marker in b, 'Gson import marker missing')
    b = b.replace(marker, 'import com.kdt.mcgui.ProgressLayout;\n\n' + marker, 1)

marker = '    private static final String TESTING = BASE + "/channels/testing.json";\n'
req(marker in b, 'TESTING constant marker missing')
if 'MOJANG_VERSION_MANIFEST' not in b:
    b = b.replace(marker, marker + '    private static final String MOJANG_VERSION_MANIFEST = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";\n', 1)

sync_pattern = re.compile(
    r'    private static void sync\(Activity activity, boolean launchAfter\) \{.*?\n    \}\n\n    public static boolean isReady\(\)',
    re.S,
)
match = sync_pattern.search(b)
req(match is not None, 'BestiaryBootstrap sync method marker missing')
sync_method = '''    private static void sync(Activity activity, boolean launchAfter) {
        if (!RUNNING.compareAndSet(false, true)) {
            Tools.runOnUiThread(() -> android.widget.Toast.makeText(activity, status, android.widget.Toast.LENGTH_LONG).show());
            return;
        }
        ready = false;
        readyForLaunch = false;
        PojavApplication.sExecutorService.execute(() -> {
            try {
                setBootstrapProgress(1, "Đang đọc cấu hình Android...");
                loadRuntimeMetadata();

                setBootstrapProgress(4, "Đang chuẩn bị Skin Bridge...");
                installBundledSkinBridge(activity);

                setBootstrapProgress(7, "Đang chuẩn bị Minecraft " + minecraftVersion + "...");
                ensureVanillaVersionMetadata();

                setBootstrapProgress(10, "Đang cài Fabric " + fabricLoaderVersion + "...");
                ensureFabricProfile();

                setBootstrapProgress(15, "Đang kiểm tra bộ mod Android...");
                syncManagedFiles();

                setBootstrapProgress(94, "Đang hoàn tất profile Bestiary...");
                ensureBestiaryProfile();
                BestiaryRendererPolicy.apply();

                ready = true;
                readyForLaunch = launchAfter;
                status = "Sẵn sàng. Minecraft, libraries và Java sẽ được kiểm tra trước khi vào game.";
                ProgressLayout.clearProgress(ProgressLayout.INSTALL_MODPACK);
                Log.i(TAG, "Bestiary Android bootstrap complete: minecraft=" + minecraftVersion
                        + " fabric=" + fabricLoaderVersion + " java=" + javaMajor + " profile=android");
                Tools.runOnUiThread(() -> {
                    android.widget.Toast.makeText(activity, "Đã đồng bộ bộ Android", android.widget.Toast.LENGTH_SHORT).show();
                    if (launchAfter) {
                        net.kdt.pojavlaunch.extra.ExtraCore.setValue(
                                net.kdt.pojavlaunch.extra.ExtraConstants.LAUNCH_GAME, true);
                    }
                });
            } catch (Throwable t) {
                status = "Cập nhật lỗi: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
                ProgressLayout.clearProgress(ProgressLayout.INSTALL_MODPACK);
                Log.e(TAG, "Bootstrap failed", t);
                Tools.runOnUiThread(() -> android.widget.Toast.makeText(activity, status, android.widget.Toast.LENGTH_LONG).show());
            } finally {
                RUNNING.set(false);
            }
        });
    }

    public static boolean isReady()'''
b = b[:match.start()] + sync_method + b[match.end():]

# Add vanilla metadata bootstrap and progress helper before runtime metadata.
marker = '    private static void loadRuntimeMetadata() throws Exception {\n'
req(marker in b, 'loadRuntimeMetadata marker missing')
helpers = '''    private static void setBootstrapProgress(int progress, String message) {
        status = message;
        ProgressLayout.setProgress(ProgressLayout.INSTALL_MODPACK, progress, message);
    }

    private static void ensureVanillaVersionMetadata() throws Exception {
        JsonObject root = JsonParser.parseString(readUrl(MOJANG_VERSION_MANIFEST)).getAsJsonObject();
        JsonArray versions = root.getAsJsonArray("versions");
        if (versions == null) throw new IOException("Mojang version manifest không có versions");

        JsonObject selected = null;
        for (JsonElement element : versions) {
            if (!element.isJsonObject()) continue;
            JsonObject candidate = element.getAsJsonObject();
            if (candidate.has("id") && minecraftVersion.equals(candidate.get("id").getAsString())) {
                selected = candidate;
                break;
            }
        }
        if (selected == null) throw new IOException("Không tìm thấy Minecraft " + minecraftVersion + " trong Mojang manifest");
        String source = selected.get("url").getAsString();
        String expectedSha1 = selected.has("sha1") ? selected.get("sha1").getAsString().toLowerCase(Locale.ROOT) : "";
        byte[] metadata = readUrlBytes(source);
        if (!expectedSha1.isEmpty() && !expectedSha1.equals(sha1(metadata))) {
            throw new IOException("SHA-1 metadata Minecraft " + minecraftVersion + " không khớp");
        }
        File dir = new File(Tools.DIR_HOME_VERSION, minecraftVersion);
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("Không tạo được thư mục Minecraft " + minecraftVersion);
        writeAtomic(new File(dir, minecraftVersion + ".json"), metadata);
    }

'''
b = b.replace(marker, helpers + marker, 1)

# Replace managed-file sync. It must fail if the manifest does not explicitly
# describe an Android profile. There is no fallback to Full or Lite.
sync_files_pattern = re.compile(
    r'    private static void syncManagedFiles\(\) throws Exception \{.*?\n    \}\n\n    private static boolean includesAndroidProfile',
    re.S,
)
match = sync_files_pattern.search(b)
req(match is not None, 'syncManagedFiles method marker missing')
sync_files = '''    private static void syncManagedFiles() throws Exception {
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

        JsonObject profileTable = manifest.getAsJsonObject("profiles");
        if (profileTable == null || !profileTable.has("android") || !profileTable.get("android").isJsonObject()) {
            throw new IOException("Manifest không khai báo profile android; không được fallback sang Full");
        }
        JsonObject androidProfile = profileTable.getAsJsonObject("android");
        JsonArray files = manifest.getAsJsonArray("files");
        if (files == null) throw new IOException("Manifest không có files");

        List<JsonObject> selected = new ArrayList<>();
        long selectedBytes = 0L;
        for (JsonElement element : files) {
            if (!element.isJsonObject()) continue;
            JsonObject item = element.getAsJsonObject();
            if (!includesAndroidProfile(item)) continue;
            selected.add(item);
            if (item.has("size")) selectedBytes += item.get("size").getAsLong();
        }

        int declaredCount = androidProfile.has("fileCount") ? androidProfile.get("fileCount").getAsInt() : -1;
        long declaredBytes = androidProfile.has("totalBytes") ? androidProfile.get("totalBytes").getAsLong() : -1L;
        if (declaredCount >= 0 && declaredCount != selected.size()) {
            throw new IOException("Android manifest lệch fileCount: khai báo " + declaredCount + ", lọc được " + selected.size());
        }
        if (declaredBytes >= 0 && declaredBytes != selectedBytes) {
            throw new IOException("Android manifest lệch totalBytes: khai báo " + declaredBytes + ", lọc được " + selectedBytes);
        }
        if (selected.isEmpty()) throw new IOException("Profile android không có file nào");

        Log.i(TAG, "Selected Android profile only: files=" + selected.size() + " bytes=" + selectedBytes);
        int completed = 0;
        for (JsonObject item : selected) {
            String relative = normalize(item.get("path").getAsString());
            if (!isAllowed(relative)) {
                completed++;
                continue;
            }
            String expected = item.get("hash").getAsString().toLowerCase(Locale.ROOT);
            String url = item.has("downloadUrl") ? item.get("downloadUrl").getAsString() : item.get("url").getAsString();
            desired.add(relative);
            File target = safeResolve(game, relative);

            int progress = 15 + (int) ((completed * 76L) / selected.size());
            setBootstrapProgress(progress, "Android " + (completed + 1) + "/" + selected.size() + ": " + target.getName());
            if (!target.isFile() || !expected.equals(sha256(target))) {
                if (target.getParentFile() != null && !target.getParentFile().exists() && !target.getParentFile().mkdirs()) {
                    throw new IOException("Không tạo được thư mục " + relative);
                }
                downloadVerified(url, target, expected);
            }
            completed++;
        }

        for (String relative : oldOwned) {
            if (desired.contains(relative)) continue;
            File target = safeResolve(game, relative);
            if (target.isFile() && !target.delete()) Log.w(TAG, "Could not remove stale managed file: " + relative);
        }
        writeOwnership(state, desired);
        setBootstrapProgress(92, "Đã đồng bộ " + selected.size() + " file của profile Android");
    }

    private static boolean includesAndroidProfile'''
b = b[:match.start()] + sync_files + b[match.end():]

# Record ownership metadata so diagnostics can prove which profile produced it.
old = '        obj.add("paths", arr);\n        writeAtomic(state, Tools.GLOBAL_GSON.toJson(obj).getBytes(StandardCharsets.UTF_8));'
req(old in b, 'writeOwnership marker missing')
b = b.replace(old, '        obj.addProperty("profile", "android");\n        obj.add("paths", arr);\n        writeAtomic(state, Tools.GLOBAL_GSON.toJson(obj).getBytes(StandardCharsets.UTF_8));', 1)

# Raw-byte metadata reader + SHA-1 verification for Mojang version JSON.
marker = '    private static String readUrl(String source) throws Exception {\n'
req(marker in b, 'readUrl marker missing')
network_helpers = '''    private static byte[] readUrlBytes(String source) throws Exception {
        HttpURLConnection conn = open(source);
        try (InputStream in = new BufferedInputStream(conn.getInputStream())) {
            return readAll(in);
        } finally { conn.disconnect(); }
    }

    private static String sha1(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-1");
        md.update(data);
        return hex(md.digest());
    }

'''
b = b.replace(marker, network_helpers + marker, 1)
b = b.replace('BestiaryLauncher-Android/1.0.0', 'BestiaryLauncher-Android/1.0.1')
bootstrap.write_text(b, encoding='utf-8')

# Keep updater User-Agent aligned with the installed build.
updater = JAVA / 'BestiaryAppUpdater.java'
if updater.is_file():
    s = updater.read_text(encoding='utf-8').replace('BestiaryLauncher-Android/1.0.0', 'BestiaryLauncher-Android/1.0.1')
    updater.write_text(s, encoding='utf-8')

# Contract checks performed before Gradle gets the privilege of wasting minutes.
req('if(!isOnline) {' in downloader.read_text(encoding='utf-8'), 'local Minecraft download bypass missing')
req('input.setHint("VD: abc123")' in offline.read_text(encoding='utf-8'), 'abc123 identity default missing')
req('activity.recreate()' not in offline.read_text(encoding='utf-8'), 'recreate popup loop still present')
req('bestiaryReloadAccounts()' in spinner.read_text(encoding='utf-8'), 'account spinner refresh missing')
req('ensureVanillaVersionMetadata()' in bootstrap.read_text(encoding='utf-8'), 'vanilla metadata bootstrap missing')
req('Manifest không khai báo profile android' in bootstrap.read_text(encoding='utf-8'), 'strict Android profile validation missing')
req('ProgressLayout.INSTALL_MODPACK' in bootstrap.read_text(encoding='utf-8'), 'Bestiary progress integration missing')
req('versionName "1.0.1"' in build.read_text(encoding='utf-8'), '1.0.1 version not applied')

print('Bestiary Android 1.0.1 runtime/install/profile/progress/account fix applied')

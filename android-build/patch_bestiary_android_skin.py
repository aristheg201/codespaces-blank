from pathlib import Path

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'
FRAG = JAVA / 'fragments/MainMenuFragment.java'
RES = APP / 'src/main/res'


def req(ok, message):
    if not ok:
        raise SystemExit(message)

# Local-only skin manager. It writes the exact file contract consumed by
# Bestiary Skin Bridge when the Fabric client joins the server.
skin_java = r'''package net.kdt.pojavlaunch;

import android.graphics.BitmapFactory;
import android.net.Uri;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;

import com.google.gson.JsonObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

public final class BestiarySkinManager {
    private static final String PREFS = "bestiary_skin";
    private static final String KEY_PENDING_VARIANT = "pending_variant";
    private static final int MAX_BYTES = 1024 * 1024;

    private BestiarySkinManager() {}

    public static void show(LauncherActivity activity) {
        File meta = new File(new File(Tools.DIR_GAME_NEW, ".bestiary"), "player-skin.json");
        String status = meta.isFile() ? "Skin local đã được cấu hình." : "Đang dùng skin mặc định.";
        new AlertDialog.Builder(activity)
                .setTitle("TÀI KHOẢN & SKIN")
                .setMessage("Tên ingame được lưu local. " + status + "\nPNG hỗ trợ: 64x64 hoặc 64x32, tối đa 1 MB.")
                .setItems(new String[]{"Chọn skin Classic", "Chọn skin Slim", "Reset skin", "Đổi tên ingame"}, (dialog, which) -> {
                    if (which == 0) choose(activity, "classic");
                    else if (which == 1) choose(activity, "slim");
                    else if (which == 2) reset(activity);
                    else BestiaryOfflineAccount.prompt(activity);
                })
                .setNegativeButton("Đóng", null)
                .show();
    }

    private static void choose(LauncherActivity activity, String variant) {
        activity.getSharedPreferences(PREFS, LauncherActivity.MODE_PRIVATE)
                .edit().putString(KEY_PENDING_VARIANT, variant).apply();
        activity.bestiarySkinPicker.launch(new String[]{"image/png"});
    }

    public static void onPicked(LauncherActivity activity, Uri uri) {
        if (uri == null) return;
        PojavApplication.sExecutorService.execute(() -> {
            try {
                byte[] data;
                try (InputStream in = activity.getContentResolver().openInputStream(uri)) {
                    if (in == null) throw new IllegalArgumentException("Không đọc được file skin");
                    data = readLimited(in, MAX_BYTES + 1);
                }
                if (data.length == 0 || data.length > MAX_BYTES) throw new IllegalArgumentException("Skin phải nhỏ hơn hoặc bằng 1 MB");
                BitmapFactory.Options options = new BitmapFactory.Options();
                options.inJustDecodeBounds = true;
                BitmapFactory.decodeByteArray(data, 0, data.length, options);
                boolean dimensionsOk = options.outWidth == 64 && (options.outHeight == 64 || options.outHeight == 32);
                if (!dimensionsOk) throw new IllegalArgumentException("Skin phải là PNG 64x64 hoặc 64x32");

                String variant = activity.getSharedPreferences(PREFS, LauncherActivity.MODE_PRIVATE)
                        .getString(KEY_PENDING_VARIANT, "classic");
                if (!"slim".equals(variant)) variant = "classic";

                File dir = new File(Tools.DIR_GAME_NEW, ".bestiary");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Không tạo được thư mục skin");
                File png = new File(dir, "player-skin.png");
                File tmp = new File(dir, "player-skin.png.tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(data); out.getFD().sync(); }
                if (png.exists() && !png.delete()) throw new IllegalStateException("Không thay được skin cũ");
                if (!tmp.renameTo(png)) throw new IllegalStateException("Không lưu được skin");

                JsonObject meta = new JsonObject();
                meta.addProperty("action", "apply");
                meta.addProperty("variant", variant);
                meta.addProperty("sha256", sha256(data));
                writeMeta(new File(dir, "player-skin.json"), Tools.GLOBAL_GSON.toJson(meta));
                Tools.runOnUiThread(() -> Toast.makeText(activity, "Đã lưu skin " + variant + ". Skin sẽ áp dụng khi vào server.", Toast.LENGTH_LONG).show());
            } catch (Throwable t) {
                Tools.runOnUiThread(() -> Toast.makeText(activity, "Skin lỗi: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private static void reset(LauncherActivity activity) {
        try {
            File dir = new File(Tools.DIR_GAME_NEW, ".bestiary");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Không tạo được thư mục skin");
            File png = new File(dir, "player-skin.png");
            if (png.isFile()) png.delete();
            JsonObject meta = new JsonObject();
            meta.addProperty("action", "reset");
            meta.addProperty("variant", "classic");
            meta.addProperty("sha256", "");
            writeMeta(new File(dir, "player-skin.json"), Tools.GLOBAL_GSON.toJson(meta));
            Toast.makeText(activity, "Đã reset skin. Thay đổi sẽ áp dụng khi vào server.", Toast.LENGTH_LONG).show();
        } catch (Throwable t) {
            Toast.makeText(activity, "Không reset được skin: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private static void writeMeta(File target, String text) throws Exception {
        File tmp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(text.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (target.exists() && !target.delete()) throw new IllegalStateException("Không thay được metadata skin");
        if (!tmp.renameTo(target)) throw new IllegalStateException("Không lưu được metadata skin");
    }

    private static byte[] readLimited(InputStream in, int limit) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        int total = 0, n;
        while ((n = in.read(buf)) != -1) {
            if (n <= 0) continue;
            total += n;
            if (total > limit) break;
            out.write(buf, 0, n);
        }
        return out.toByteArray();
    }

    private static String sha256(byte[] data) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        md.update(data);
        StringBuilder out = new StringBuilder();
        for (byte value : md.digest()) out.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return out.toString();
    }
}
'''
(JAVA / 'BestiarySkinManager.java').write_text(skin_java, encoding='utf-8')

# ActivityResult API is lifecycle-safe and avoids legacy onActivityResult plumbing.
launcher = JAVA / 'LauncherActivity.java'
s = launcher.read_text(encoding='utf-8')
needle = '    public final ActivityResultLauncher<Object> modInstallerLauncher =\n'
req(needle in s, 'LauncherActivity ActivityResult marker missing')
field = '''    public final ActivityResultLauncher<String[]> bestiarySkinPicker =
            registerForActivityResult(new ActivityResultContracts.OpenDocument(),
                    uri -> BestiarySkinManager.onPicked(this, uri));

'''
s = s.replace(needle, field + needle, 1)
launcher.write_text(s, encoding='utf-8')

# Bundle/install the Bestiary Skin Bridge as launcher runtime, not modpack content.
bootstrap = JAVA / 'BestiaryBootstrap.java'
b = bootstrap.read_text(encoding='utf-8')
needle = '                loadRuntimeMetadata();\n                status = "Đang chuẩn bị Fabric " + fabricLoaderVersion;'
req(needle in b, 'bootstrap runtime marker missing')
b = b.replace(needle, '                loadRuntimeMetadata();\n                status = "Đang chuẩn bị Skin Bridge";\n                installBundledSkinBridge(activity);\n                status = "Đang chuẩn bị Fabric " + fabricLoaderVersion;', 1)
insert = '    private static void loadRuntimeMetadata() throws Exception {'
helper = '''    private static void installBundledSkinBridge(Activity activity) throws Exception {
        byte[] bundled;
        try (InputStream in = activity.getAssets().open("bestiary/bestiary-skin-bridge.jar")) {
            bundled = readAll(in);
        }
        if (bundled.length == 0) throw new IOException("Skin Bridge trong APK bị rỗng");
        File mods = new File(Tools.DIR_GAME_NEW, "mods");
        if (!mods.exists() && !mods.mkdirs()) throw new IOException("Không tạo được thư mục mods");
        File target = new File(mods, "bestiary-skin-bridge.jar");
        String bundledSha = sha256(bundled);
        if (!target.isFile() || !bundledSha.equals(sha256(target))) writeAtomic(target, bundled);
    }

'''
req(insert in b, 'bootstrap loadRuntimeMetadata marker missing')
b = b.replace(insert, helper + insert, 1)
bootstrap.write_text(b, encoding='utf-8')

# Add Account & Skin to portrait home. XML must escape '&'.
layout = RES / 'layout/fragment_launcher.xml'
x = layout.read_text(encoding='utf-8')
needle = '''            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/discord_button"
                style="@style/LauncherMenuButton.Universal"
                android:layout_width="match_parent"
                android:text="DISCORD" />
'''
req(needle in x, 'portrait Discord button marker missing')
skin_button = needle + '''            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/skin_button"
                style="@style/LauncherMenuButton.Universal"
                android:layout_width="match_parent"
                android:text="TÀI KHOẢN &amp; SKIN" />
'''
x = x.replace(needle, skin_button, 1)
layout.write_text(x, encoding='utf-8')

# Wire the new button without touching Microsoft paths.
f = FRAG.read_text(encoding='utf-8')
if 'import net.kdt.pojavlaunch.BestiarySkinManager;' not in f:
    f = f.replace('import net.kdt.pojavlaunch.BestiaryBootstrap;', 'import net.kdt.pojavlaunch.BestiaryBootstrap;\nimport net.kdt.pojavlaunch.BestiarySkinManager;\nimport net.kdt.pojavlaunch.LauncherActivity;', 1)
needle = '        Button mDiscordButton = view.findViewById(R.id.discord_button);\n'
req(needle in f, 'MainMenu Discord binding marker missing')
f = f.replace(needle, needle + '        Button mSkinButton = view.findViewById(R.id.skin_button);\n', 1)
needle = '        mDiscordButton.setOnClickListener(v -> Tools.openURL(requireActivity(), "https://discord.com/invite/HeYXW6AT3v"));\n'
req(needle in f, 'Bestiary Discord listener marker missing')
f = f.replace(needle, needle + '        mSkinButton.setOnClickListener(v -> BestiarySkinManager.show((LauncherActivity) requireActivity()));\n', 1)
FRAG.write_text(f, encoding='utf-8')

req('bestiarySkinPicker' in launcher.read_text(encoding='utf-8'), 'skin picker hook missing')
req('installBundledSkinBridge(activity)' in bootstrap.read_text(encoding='utf-8'), 'bundled Skin Bridge hook missing')
req('TÀI KHOẢN &amp; SKIN' in layout.read_text(encoding='utf-8'), 'skin UI missing')
print('Bestiary Android local skin + bundled Skin Bridge patch applied')

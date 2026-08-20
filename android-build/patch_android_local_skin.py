from pathlib import Path

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'
FRAG = JAVA / 'fragments/MainMenuFragment.java'
LAYOUT = APP / 'src/main/res/layout/fragment_launcher.xml'


def req(ok, message):
    if not ok:
        raise SystemExit(message)

manager = r'''package net.kdt.pojavlaunch;

import android.content.Context;
import android.content.Intent;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.widget.Toast;

import androidx.appcompat.app.AlertDialog;
import androidx.fragment.app.Fragment;

import com.google.gson.JsonObject;

import net.kdt.pojavlaunch.prefs.LauncherPreferences;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

/** Writes the exact preference files consumed by BestiarySkinBridgeClient. */
public final class BestiarySkinManager {
    public static final int REQUEST_SKIN = 5107;
    private static final int MAX_BYTES = 1024 * 1024;
    private static final String PREF_PENDING_VARIANT = "bestiary_skin_pending_variant";

    private BestiarySkinManager() {}

    public static void show(Fragment fragment) {
        String[] choices = {"Chọn skin Classic", "Chọn skin Slim", "Reset skin"};
        new AlertDialog.Builder(fragment.requireContext())
                .setTitle("TÀI KHOẢN & SKIN")
                .setMessage("Tên ingame dùng Local/Offline. Skin chỉ nhận PNG 64x64 hoặc 64x32, tối đa 1 MB.")
                .setItems(choices, (dialog, which) -> {
                    if (which == 2) {
                        reset(fragment.requireContext());
                        return;
                    }
                    String variant = which == 1 ? "slim" : "classic";
                    LauncherPreferences.DEFAULT_PREF.edit().putString(PREF_PENDING_VARIANT, variant).apply();
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("image/png");
                    fragment.startActivityForResult(intent, REQUEST_SKIN);
                })
                .setNegativeButton("Đóng", null)
                .show();
    }

    public static boolean handleResult(Context context, int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_SKIN) return false;
        if (resultCode != android.app.Activity.RESULT_OK || data == null || data.getData() == null) return true;
        String variant = LauncherPreferences.DEFAULT_PREF.getString(PREF_PENDING_VARIANT, "classic");
        importSkin(context, data.getData(), "slim".equals(variant) ? "slim" : "classic");
        return true;
    }

    private static void importSkin(Context context, Uri uri, String variant) {
        try {
            byte[] png = readLimited(context, uri);
            if (png.length < 24 || png.length > MAX_BYTES ||
                    png[0] != (byte)0x89 || png[1] != 'P' || png[2] != 'N' || png[3] != 'G') {
                throw new IllegalArgumentException("File phải là PNG dưới 1 MB.");
            }
            BitmapFactory.Options options = new BitmapFactory.Options();
            options.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(png, 0, png.length, options);
            if (options.outWidth != 64 || (options.outHeight != 64 && options.outHeight != 32)) {
                throw new IllegalArgumentException("Skin phải có kích thước 64x64 hoặc 64x32.");
            }

            File dir = new File(Tools.DIR_GAME_NEW, ".bestiary");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Không tạo được thư mục .bestiary");
            writeAtomic(new File(dir, "player-skin.png"), png);

            JsonObject meta = new JsonObject();
            meta.addProperty("action", "apply");
            meta.addProperty("variant", variant);
            meta.addProperty("sha256", sha256(png));
            writeAtomic(new File(dir, "player-skin.json"), Tools.GLOBAL_GSON.toJson(meta).getBytes("UTF-8"));
            Toast.makeText(context, "Đã lưu skin " + ("slim".equals(variant) ? "Slim" : "Classic") + ". Skin sẽ đồng bộ khi vào server.", Toast.LENGTH_LONG).show();
        } catch (Throwable t) {
            Toast.makeText(context, "Skin không hợp lệ: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private static void reset(Context context) {
        try {
            File dir = new File(Tools.DIR_GAME_NEW, ".bestiary");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Không tạo được thư mục .bestiary");
            JsonObject meta = new JsonObject();
            meta.addProperty("action", "reset");
            meta.addProperty("variant", "classic");
            meta.addProperty("sha256", "");
            writeAtomic(new File(dir, "player-skin.json"), Tools.GLOBAL_GSON.toJson(meta).getBytes("UTF-8"));
            File png = new File(dir, "player-skin.png");
            if (png.exists() && !png.delete()) throw new IllegalStateException("Không xóa được skin cũ");
            Toast.makeText(context, "Đã đặt skin về mặc định. Thay đổi sẽ gửi khi vào server.", Toast.LENGTH_LONG).show();
        } catch (Throwable t) {
            Toast.makeText(context, "Không reset được skin: " + t.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    private static byte[] readLimited(Context context, Uri uri) throws Exception {
        try (InputStream in = context.getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IllegalArgumentException("Không đọc được file.");
            byte[] buffer = new byte[16 * 1024];
            int total = 0;
            int n;
            while ((n = in.read(buffer)) != -1) {
                total += n;
                if (total > MAX_BYTES) throw new IllegalArgumentException("Skin vượt quá 1 MB.");
                if (n > 0) out.write(buffer, 0, n);
            }
            return out.toByteArray();
        }
    }

    private static void writeAtomic(File target, byte[] data) throws Exception {
        File temp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) {
            out.write(data);
            out.getFD().sync();
        }
        if (target.exists() && !target.delete()) {
            temp.delete();
            throw new IllegalStateException("Không thay được " + target.getName());
        }
        if (!temp.renameTo(target)) {
            temp.delete();
            throw new IllegalStateException("Không lưu được " + target.getName());
        }
    }

    private static String sha256(byte[] data) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder out = new StringBuilder(digest.length * 2);
        for (byte value : digest) out.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return out.toString();
    }
}
'''
(JAVA / 'BestiarySkinManager.java').write_text(manager, encoding='utf-8')

layout = LAYOUT.read_text(encoding='utf-8')
needle = '''            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/news_button"'''
req(needle in layout, 'Bestiary home news marker missing')
skin_button = '''            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/bestiary_skin_button"
                style="@style/LauncherMenuButton.Universal"
                android:layout_width="match_parent"
                android:text="TÀI KHOẢN &amp; SKIN" />
            <com.kdt.mcgui.LauncherMenuButton
                android:id="@+id/news_button"'''
layout = layout.replace(needle, skin_button, 1)
LAYOUT.write_text(layout, encoding='utf-8')

src = FRAG.read_text(encoding='utf-8')
if 'import net.kdt.pojavlaunch.BestiarySkinManager;' not in src:
    src = src.replace('import net.kdt.pojavlaunch.BestiaryBootstrap;\n', 'import net.kdt.pojavlaunch.BestiaryBootstrap;\nimport net.kdt.pojavlaunch.BestiarySkinManager;\n', 1)
needle = '        Button mNewsButton = view.findViewById(R.id.news_button);\n'
req(needle in src, 'Main menu view marker missing')
src = src.replace(needle, '        Button mSkinButton = view.findViewById(R.id.bestiary_skin_button);\n' + needle, 1)
needle = '        mNewsButton.setOnClickListener(v -> BestiaryBootstrap.showAnnouncements(requireActivity()));\n'
req(needle in src, 'Bestiary announcements listener marker missing')
src = src.replace(needle, '        mSkinButton.setOnClickListener(v -> BestiarySkinManager.show(this));\n' + needle, 1)
resume = '''    @Override
    public void onResume() {'''
req(resume in src, 'MainMenu onResume marker missing')
callback = '''    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (BestiarySkinManager.handleResult(requireContext(), requestCode, resultCode, data)) return;
        super.onActivityResult(requestCode, resultCode, data);
    }

'''
src = src.replace(resume, callback + resume, 1)
FRAG.write_text(src, encoding='utf-8')

check = FRAG.read_text(encoding='utf-8')
req('BestiarySkinManager.show(this)' in check, 'Skin manager UI hook missing')
req('BestiarySkinManager.handleResult' in check, 'Skin picker callback missing')
req('TÀI KHOẢN &amp; SKIN' in LAYOUT.read_text(encoding='utf-8'), 'Skin button missing')
print('Bestiary Android local skin manager applied')

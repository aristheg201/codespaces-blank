from pathlib import Path
import base64
import hashlib
import zlib

APP = Path('amethyst/app_pojavlauncher')
JAVA = APP / 'src/main/java/net/kdt/pojavlaunch'
RES = APP / 'src/main/res'
ASSETS = APP / 'src/main/assets/bestiary'


def req(ok, message):
    if not ok:
        raise SystemExit(message)


# ---------------------------------------------------------------------------
# Version 1.0.2
# ---------------------------------------------------------------------------
build = APP / 'build.gradle'
s = build.read_text(encoding='utf-8')
req('versionName "1.0.1"' in s, '1.0.1 versionName marker missing')
s = s.replace('versionName "1.0.1"', 'versionName "1.0.2"', 1)
if 'versionCode 10000002' in s:
    s = s.replace('versionCode 10000002', 'versionCode 10000003', 1)
build.write_text(s, encoding='utf-8')


# ---------------------------------------------------------------------------
# 1) Bundle the exact user-supplied Pojav/Amethyst control layout (format v8).
# The compressed payload is only a source transport optimization. The APK asset
# is restored byte-for-byte and verified against its known SHA-256.
# ---------------------------------------------------------------------------
KEYBOARD_SHA256 = 'b6d4513326e8c008d26a1068fe2fde80f2e26997cc259d38fda92e1081d3f563'
KEYBOARD_ZLIB_B64 = '''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'''
keyboard_bytes = zlib.decompress(base64.b64decode(KEYBOARD_ZLIB_B64))
req(hashlib.sha256(keyboard_bytes).hexdigest() == KEYBOARD_SHA256, 'bundled keyboard SHA-256 mismatch')
ASSETS.mkdir(parents=True, exist_ok=True)
(ASSETS / 'keyboard_cobblemon.json').write_bytes(keyboard_bytes)

controls_java = r'''package net.kdt.pojavlaunch;

import android.content.Context;
import android.content.SharedPreferences;

import net.kdt.pojavlaunch.prefs.LauncherPreferences;
import net.kdt.pojavlaunch.utils.FileUtils;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;

/** Installs the Bestiary Cobblemon control layout exactly once per bundled layout revision. */
public final class BestiaryDefaultControls {
    private static final String PREF_REVISION = "bestiary_default_control_revision";
    private static final int REVISION = 1;
    private static final String FILE_NAME = "bestiary-cobblemon.json";

    private BestiaryDefaultControls() {}

    public static void install(Context context) throws Exception {
        SharedPreferences prefs = LauncherPreferences.DEFAULT_PREF;
        File target = new File(Tools.CTRLMAP_PATH, FILE_NAME);
        int installedRevision = prefs.getInt(PREF_REVISION, 0);
        boolean needsInstall = installedRevision < REVISION || !target.isFile() || target.length() == 0;

        if (needsInstall) {
            FileUtils.ensureParentDirectory(target);
            File temp = new File(target.getParentFile(), target.getName() + ".tmp");
            try (InputStream in = context.getAssets().open("bestiary/keyboard_cobblemon.json");
                 FileOutputStream out = new FileOutputStream(temp)) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) if (read > 0) out.write(buffer, 0, read);
                out.getFD().sync();
            }
            if (target.exists() && !target.delete()) throw new IllegalStateException("Không thay được layout điều khiển cũ");
            if (!temp.renameTo(target)) throw new IllegalStateException("Không cài được layout điều khiển Bestiary");

            // Upgrades from 1.0.1 should receive this default once. Later user choices are preserved.
            prefs.edit()
                    .putString("defaultCtrl", target.getAbsolutePath())
                    .putInt(PREF_REVISION, REVISION)
                    .apply();
        }

        String selected = prefs.getString("defaultCtrl", target.getAbsolutePath());
        if (selected == null || !new File(selected).isFile()) {
            selected = target.getAbsolutePath();
            prefs.edit().putString("defaultCtrl", selected).apply();
        }
        LauncherPreferences.PREF_DEFAULTCTRL_PATH = selected;
    }
}
'''
(JAVA / 'BestiaryDefaultControls.java').write_text(controls_java, encoding='utf-8')

app_java = JAVA / 'PojavApplication.java'
s = app_java.read_text(encoding='utf-8')
needle = '\t\t\t\tLauncherPreferences.loadPreferences(this);\n'
req(needle in s, 'PojavApplication preference load marker missing')
s = s.replace(needle, needle + '\t\t\t\tBestiaryDefaultControls.install(this);\n', 1)
app_java.write_text(s, encoding='utf-8')


# ---------------------------------------------------------------------------
# 2) Real skin manager UI: file picker, persistent model selector, visible PNG
# preview, reset-to-default, and rename. No more descriptive dead-end popup.
# ---------------------------------------------------------------------------
skin_java = r'''package net.kdt.pojavlaunch;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.BitmapDrawable;
import android.net.Uri;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
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

    private static int dp(LauncherActivity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    public static void show(LauncherActivity activity) {
        File dir = new File(Tools.DIR_GAME_NEW, ".bestiary");
        File png = new File(dir, "player-skin.png");
        String variant = activity.getSharedPreferences(PREFS, LauncherActivity.MODE_PRIVATE)
                .getString(KEY_PENDING_VARIANT, "classic");
        if (!"slim".equals(variant)) variant = "classic";

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(activity, 20);
        root.setPadding(pad, dp(activity, 8), pad, dp(activity, 4));

        ImageView preview = new ImageView(activity);
        preview.setAdjustViewBounds(true);
        preview.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams previewParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(activity, 220));
        previewParams.bottomMargin = dp(activity, 10);
        root.addView(preview, previewParams);

        TextView status = new TextView(activity);
        status.setGravity(Gravity.CENTER_HORIZONTAL);
        status.setText(png.isFile()
                ? "Skin đã chọn • PNG 64x64/64x32 • tối đa 1 MB"
                : "Đang dùng skin mặc định • Chọn PNG 64x64/64x32 • tối đa 1 MB");
        root.addView(status, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        RadioGroup models = new RadioGroup(activity);
        models.setOrientation(RadioGroup.HORIZONTAL);
        models.setGravity(Gravity.CENTER);
        RadioButton classic = new RadioButton(activity);
        classic.setText("DEFAULT / CLASSIC");
        RadioButton slim = new RadioButton(activity);
        slim.setText("SLIM");
        models.addView(classic);
        models.addView(slim);
        if ("slim".equals(variant)) slim.setChecked(true); else classic.setChecked(true);
        root.addView(models, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button choose = new Button(activity);
        choose.setText("CHỌN PNG");
        root.addView(choose, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button reset = new Button(activity);
        reset.setText("DÙNG SKIN MẶC ĐỊNH");
        root.addView(reset, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button rename = new Button(activity);
        rename.setText("ĐỔI TÊN INGAME");
        root.addView(rename, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        loadPreview(preview, png);

        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("TÀI KHOẢN & SKIN")
                .setView(root)
                .setNegativeButton("ĐÓNG", null)
                .create();

        models.setOnCheckedChangeListener((group, checkedId) -> {
            String selected = checkedId == slim.getId() ? "slim" : "classic";
            activity.getSharedPreferences(PREFS, LauncherActivity.MODE_PRIVATE)
                    .edit().putString(KEY_PENDING_VARIANT, selected).apply();
            if (png.isFile()) updateVariant(activity, selected);
        });

        choose.setOnClickListener(v -> {
            String selected = slim.isChecked() ? "slim" : "classic";
            activity.getSharedPreferences(PREFS, LauncherActivity.MODE_PRIVATE)
                    .edit().putString(KEY_PENDING_VARIANT, selected).apply();
            dialog.dismiss();
            activity.bestiarySkinPicker.launch(new String[]{"image/png"});
        });
        reset.setOnClickListener(v -> {
            reset(activity);
            dialog.dismiss();
            show(activity);
        });
        rename.setOnClickListener(v -> {
            dialog.dismiss();
            BestiaryOfflineAccount.prompt(activity);
        });
        dialog.show();
    }

    private static void loadPreview(ImageView preview, File png) {
        if (!png.isFile()) {
            preview.setImageDrawable(null);
            preview.setContentDescription("Skin mặc định");
            return;
        }
        Bitmap bitmap = BitmapFactory.decodeFile(png.getAbsolutePath());
        if (bitmap == null) {
            preview.setImageDrawable(null);
            return;
        }
        BitmapDrawable drawable = new BitmapDrawable(preview.getResources(), bitmap);
        drawable.setFilterBitmap(false);
        preview.setImageDrawable(drawable);
        preview.setContentDescription("Preview skin đã chọn");
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
                validatePng(data);

                String variant = activity.getSharedPreferences(PREFS, LauncherActivity.MODE_PRIVATE)
                        .getString(KEY_PENDING_VARIANT, "classic");
                if (!"slim".equals(variant)) variant = "classic";
                final String savedVariant = variant;

                File dir = new File(Tools.DIR_GAME_NEW, ".bestiary");
                if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Không tạo được thư mục skin");
                File png = new File(dir, "player-skin.png");
                File tmp = new File(dir, "player-skin.png.tmp");
                try (FileOutputStream out = new FileOutputStream(tmp)) { out.write(data); out.getFD().sync(); }
                if (png.exists() && !png.delete()) throw new IllegalStateException("Không thay được skin cũ");
                if (!tmp.renameTo(png)) throw new IllegalStateException("Không lưu được skin");

                writeApplyMeta(dir, savedVariant, data);
                Tools.runOnUiThread(() -> {
                    Toast.makeText(activity, "Đã lưu skin " + savedVariant + ".", Toast.LENGTH_SHORT).show();
                    show(activity);
                });
            } catch (Throwable t) {
                Tools.runOnUiThread(() -> Toast.makeText(activity, "Skin lỗi: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private static void validatePng(byte[] data) {
        if (data.length == 0 || data.length > MAX_BYTES) throw new IllegalArgumentException("Skin phải nhỏ hơn hoặc bằng 1 MB");
        if (data.length < 8 || data[0] != (byte) 0x89 || data[1] != 0x50 || data[2] != 0x4e || data[3] != 0x47
                || data[4] != 0x0d || data[5] != 0x0a || data[6] != 0x1a || data[7] != 0x0a) {
            throw new IllegalArgumentException("File đã chọn không phải PNG hợp lệ");
        }
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(data, 0, data.length, options);
        if (options.outWidth != 64 || (options.outHeight != 64 && options.outHeight != 32)) {
            throw new IllegalArgumentException("Skin phải là PNG 64x64 hoặc 64x32");
        }
    }

    private static void updateVariant(LauncherActivity activity, String variant) {
        PojavApplication.sExecutorService.execute(() -> {
            try {
                File dir = new File(Tools.DIR_GAME_NEW, ".bestiary");
                File png = new File(dir, "player-skin.png");
                if (!png.isFile()) return;
                byte[] data;
                try (InputStream in = new FileInputStream(png)) { data = readLimited(in, MAX_BYTES + 1); }
                validatePng(data);
                writeApplyMeta(dir, "slim".equals(variant) ? "slim" : "classic", data);
            } catch (Throwable t) {
                Tools.runOnUiThread(() -> Toast.makeText(activity, "Không đổi được model skin: " + t.getMessage(), Toast.LENGTH_LONG).show());
            }
        });
    }

    private static void writeApplyMeta(File dir, String variant, byte[] data) throws Exception {
        JsonObject meta = new JsonObject();
        meta.addProperty("action", "apply");
        meta.addProperty("variant", variant);
        meta.addProperty("sha256", sha256(data));
        writeMeta(new File(dir, "player-skin.json"), Tools.GLOBAL_GSON.toJson(meta));
    }

    private static void reset(LauncherActivity activity) {
        try {
            File dir = new File(Tools.DIR_GAME_NEW, ".bestiary");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("Không tạo được thư mục skin");
            File png = new File(dir, "player-skin.png");
            if (png.isFile() && !png.delete()) throw new IllegalStateException("Không xóa được skin cũ");
            JsonObject meta = new JsonObject();
            meta.addProperty("action", "reset");
            meta.addProperty("variant", "classic");
            meta.addProperty("sha256", "");
            writeMeta(new File(dir, "player-skin.json"), Tools.GLOBAL_GSON.toJson(meta));
            activity.getSharedPreferences(PREFS, LauncherActivity.MODE_PRIVATE)
                    .edit().putString(KEY_PENDING_VARIANT, "classic").apply();
            Toast.makeText(activity, "Đã chuyển về skin mặc định.", Toast.LENGTH_SHORT).show();
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
            if (total > limit) throw new IllegalArgumentException("File skin vượt quá giới hạn dung lượng");
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


# ---------------------------------------------------------------------------
# 3) JVM flag generator. It writes into the same javaArgs preference Amethyst
# already consumes. RAM remains controlled by the launcher, so no -Xmx/-Xms is
# generated and users cannot accidentally fight the memory slider.
# ---------------------------------------------------------------------------
generator_java = r'''package net.kdt.pojavlaunch;

import android.content.Context;

import net.kdt.pojavlaunch.prefs.LauncherPreferences;

public final class BestiaryJvmFlagGenerator {
    private BestiaryJvmFlagGenerator() {}

    public static String generate(Context context) {
        int allocation = LauncherPreferences.PREF_RAM_ALLOCATION;
        StringBuilder flags = new StringBuilder();
        flags.append("-XX:+UseG1GC ");
        flags.append("-XX:+ParallelRefProcEnabled ");
        flags.append("-XX:MaxGCPauseMillis=100 ");
        flags.append("-XX:+DisableExplicitGC ");
        if (allocation >= 3072) flags.append("-XX:+UseStringDeduplication ");
        flags.append("-Dfile.encoding=UTF-8");
        return flags.toString().trim();
    }
}
'''
(JAVA / 'BestiaryJvmFlagGenerator.java').write_text(generator_java, encoding='utf-8')

pref_java = RES / 'xml/pref_java.xml'
x = pref_java.read_text(encoding='utf-8')
needle = '''        <androidx.preference.EditTextPreference
            android:dialogTitle="@string/mcl_setting_title_javaargs"

            android:key="javaArgs"
            android:singleLine="true"
            android:summary="@string/mcl_setting_subtitle_javaargs"
            android:title="@string/mcl_setting_title_javaargs" />
'''
req(needle in x, 'javaArgs preference marker missing')
generate_pref = needle + '''
        <Preference
            android:key="bestiary_generate_jvm_flags"
            android:persistent="false"
            android:title="Tạo JVM flags tự động"
            android:summary="Sinh bộ flag Java 21 an toàn theo RAM đã cấp. Không ghi đè giới hạn RAM." />
'''
x = x.replace(needle, generate_pref, 1)
pref_java.write_text(x, encoding='utf-8')

java_fragment = JAVA / 'prefs/screens/LauncherPreferenceJavaFragment.java'
s = java_fragment.read_text(encoding='utf-8')
if 'import net.kdt.pojavlaunch.BestiaryJvmFlagGenerator;' not in s:
    s = s.replace('import net.kdt.pojavlaunch.R;\n', 'import net.kdt.pojavlaunch.R;\nimport net.kdt.pojavlaunch.BestiaryJvmFlagGenerator;\n', 1)
needle = '''        if (editJVMArgs != null) {
            editJVMArgs.setOnBindEditTextListener(TextView::setSingleLine);
        }

        requirePreference("install_jre").setOnPreferenceClickListener(preference->{'''
req(needle in s, 'LauncherPreferenceJavaFragment javaArgs marker missing')
replacement = '''        if (editJVMArgs != null) {
            editJVMArgs.setOnBindEditTextListener(TextView::setSingleLine);
        }

        requirePreference("bestiary_generate_jvm_flags").setOnPreferenceClickListener(preference -> {
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
        });

        requirePreference("install_jre").setOnPreferenceClickListener(preference->{'''
s = s.replace(needle, replacement, 1)
java_fragment.write_text(s, encoding='utf-8')


# ---------------------------------------------------------------------------
# Contract checks before Gradle spends time compiling.
# ---------------------------------------------------------------------------
req((ASSETS / 'keyboard_cobblemon.json').is_file(), 'keyboard asset missing')
req(hashlib.sha256((ASSETS / 'keyboard_cobblemon.json').read_bytes()).hexdigest() == KEYBOARD_SHA256, 'keyboard asset changed')
req('BestiaryDefaultControls.install(this)' in app_java.read_text(encoding='utf-8'), 'default-control startup hook missing')
req('CHỌN PNG' in (JAVA / 'BestiarySkinManager.java').read_text(encoding='utf-8'), 'skin picker UI missing')
req('DEFAULT / CLASSIC' in (JAVA / 'BestiarySkinManager.java').read_text(encoding='utf-8'), 'skin model selector missing')
req('loadPreview(preview, png)' in (JAVA / 'BestiarySkinManager.java').read_text(encoding='utf-8'), 'skin preview missing')
req('bestiary_generate_jvm_flags' in pref_java.read_text(encoding='utf-8'), 'JVM generator preference missing')
req('BestiaryJvmFlagGenerator.generate' in java_fragment.read_text(encoding='utf-8'), 'JVM generator wiring missing')
req('versionName "1.0.2"' in build.read_text(encoding='utf-8'), '1.0.2 version not applied')

print('Bestiary Android 1.0.2 controls + skin manager + JVM generator patch applied')

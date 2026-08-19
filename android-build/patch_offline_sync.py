from pathlib import Path

JAVA = Path('amethyst/app_pojavlauncher/src/main/java/net/kdt/pojavlaunch')
APP = Path('amethyst/app_pojavlauncher')

# 1) Bestiary is an offline/cracked launcher. Replace upstream auth picker with one in-game-name identity.
offline = r'''package net.kdt.pojavlaunch;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.text.InputType;
import android.widget.EditText;

import androidx.appcompat.app.AlertDialog;

import net.kdt.pojavlaunch.value.MinecraftAccount;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.regex.Pattern;

public final class BestiaryOfflineAccount {
    private static final String PREFS = "bestiary_identity";
    private static final String KEY_NAME = "username";
    private static final Pattern VALID = Pattern.compile("^[A-Za-z0-9_]{3,16}$");

    private BestiaryOfflineAccount() {}

    public static boolean hasAccount(Context context) {
        String name = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_NAME, "");
        return name != null && VALID.matcher(name).matches() && new File(Tools.DIR_ACCOUNT_NEW, name + ".json").isFile();
    }

    public static void ensureSelected(Context context) {
        String name = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_NAME, "");
        if (name != null && VALID.matcher(name).matches() && new File(Tools.DIR_ACCOUNT_NEW, name + ".json").isFile()) {
            PojavProfile.setCurrentProfile(context, name);
        }
    }

    public static void prompt(Activity activity) {
        final EditText input = new EditText(activity);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        input.setHint("VD: Arisgrindel");
        String old = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_NAME, "");
        if (old != null) input.setText(old);

        AlertDialog dialog = new AlertDialog.Builder(activity)
                .setTitle("Tên ingame")
                .setMessage("Nhập tên dùng trong Bestiary Rebirth. Chỉ chữ, số và dấu gạch dưới; 3-16 ký tự.")
                .setView(input)
                .setNegativeButton("Hủy", null)
                .setPositiveButton("Lưu", null)
                .create();
        dialog.setOnShowListener(ignored -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String name = input.getText().toString().trim();
            if (!VALID.matcher(name).matches()) {
                input.setError("Tên phải dài 3-16 ký tự và chỉ gồm A-Z, a-z, 0-9, _");
                return;
            }
            try {
                String previous = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_NAME, "");
                if (previous != null && !previous.isEmpty() && !previous.equals(name)) {
                    File oldFile = new File(Tools.DIR_ACCOUNT_NEW, previous + ".json");
                    if (oldFile.isFile()) oldFile.delete();
                }
                MinecraftAccount account = new MinecraftAccount();
                account.username = name;
                account.accessToken = "0";
                account.clientToken = "0";
                account.isMicrosoft = false;
                account.msaRefreshToken = "0";
                account.profileId = UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(StandardCharsets.UTF_8))
                        .toString().replace("-", "");
                account.save();
                activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_NAME, name).apply();
                PojavProfile.setCurrentProfile(activity, name);
                dialog.dismiss();
                activity.recreate();
            } catch (Exception e) {
                input.setError("Không lưu được tên: " + e.getMessage());
            }
        }));
        dialog.show();
    }
}
'''
(JAVA / 'BestiaryOfflineAccount.java').write_text(offline, encoding='utf-8')

launcher = JAVA / 'LauncherActivity.java'
s = launcher.read_text(encoding='utf-8')

old = '''    private final ExtraListener<Boolean> mSelectAuthMethod = (key, value) -> {\n        Fragment fragment = getSupportFragmentManager().findFragmentById(mFragmentView.getId());\n        // Allow starting the add account only from the main menu, should it be moved to fragment itself ?\n        if(!(fragment instanceof MainMenuFragment)) return false;\n\n        Tools.swapFragment(this, SelectAuthFragment.class, SelectAuthFragment.TAG, null);\n        return false;\n    };'''
new = '''    private final ExtraListener<Boolean> mSelectAuthMethod = (key, value) -> {\n        Fragment fragment = getSupportFragmentManager().findFragmentById(mFragmentView.getId());\n        if(!(fragment instanceof MainMenuFragment)) return false;\n        BestiaryOfflineAccount.prompt(this);\n        return false;\n    };'''
if old not in s:
    raise SystemExit('auth picker marker missing')
s = s.replace(old, new, 1)

# Do not start sync silently during activity creation. Select saved offline identity before spinner use.
old = '        setContentView(R.layout.activity_pojav_launcher);\n        BestiaryBootstrap.start(this);\n'
new = '        BestiaryOfflineAccount.ensureSelected(this);\n        setContentView(R.layout.activity_pojav_launcher);\n'
if old not in s:
    raise SystemExit('Bestiary onCreate marker missing')
s = s.replace(old, new, 1)

# Once views are bound, first launch asks for the in-game name instead of Microsoft auth.
old = '        bindViews();\n        checkNotificationPermission();\n'
new = '        bindViews();\n        if (!BestiaryOfflineAccount.hasAccount(this)) {\n            mFragmentView.post(() -> BestiaryOfflineAccount.prompt(this));\n        }\n        checkNotificationPermission();\n'
if old not in s:
    raise SystemExit('bindViews marker missing')
s = s.replace(old, new, 1)

# Play is the synchronization boundary: remote config + channel + manifest must be current before Minecraft starts.
old = '''        if (!BestiaryBootstrap.isReady()) {\n            Toast.makeText(this, BestiaryBootstrap.getStatus(), Toast.LENGTH_LONG).show();\n            BestiaryBootstrap.start(this);\n            return false;\n        }\n\n'''
new = '''        if (!BestiaryOfflineAccount.hasAccount(this)) {\n            BestiaryOfflineAccount.prompt(this);\n            return false;\n        }\n        if (!BestiaryBootstrap.consumeReadyForLaunch()) {\n            BestiaryBootstrap.syncThenLaunch(this);\n            return false;\n        }\n\n'''
if old not in s:
    raise SystemExit('launch sync marker missing')
s = s.replace(old, new, 1)
launcher.write_text(s, encoding='utf-8')

# Top-left identity control now says what it actually is.
spinner = APP / 'src/main/java/com/kdt/mcgui/mcAccountSpinner.java'
t = spinner.read_text(encoding='utf-8')
t = t.replace('mAccountList.add(getContext().getString(R.string.main_add_account));', 'mAccountList.add("Tên ingame");')
spinner.write_text(t, encoding='utf-8')

# 2) Make BestiaryBootstrap retryable and auto-continue into launch only after a successful verified sync.
p = JAVA / 'BestiaryBootstrap.java'
b = p.read_text(encoding='utf-8')
b = b.replace('private static final AtomicBoolean STARTED = new AtomicBoolean(false);', 'private static final AtomicBoolean RUNNING = new AtomicBoolean(false);')
b = b.replace('    private static volatile boolean ready = false;\n', '    private static volatile boolean ready = false;\n    private static volatile boolean readyForLaunch = false;\n')

start_old = '''    public static void start(Activity activity) {\n        if (!STARTED.compareAndSet(false, true)) return;\n        PojavApplication.sExecutorService.execute(() -> {\n            try {\n                status = "Đang đọc cấu hình Bestiary";\n                loadRuntimeMetadata();\n                status = "Đang chuẩn bị Fabric " + fabricLoaderVersion;\n                ensureFabricProfile();\n                syncManagedFiles();\n                ensureBestiaryProfile();\n                ready = true;\n                status = "Sẵn sàng";\n                Log.i(TAG, "Bestiary Android bootstrap complete");\n            } catch (Throwable t) {\n                status = "Đồng bộ lỗi: " + t.getMessage();\n                Log.e(TAG, "Bootstrap failed", t);\n            }\n        });\n    }\n\n    public static boolean isReady() { return ready; }\n    public static String getStatus() { return status; }\n'''
start_new = '''    public static void start(Activity activity) {\n        sync(activity, false);\n    }\n\n    public static void syncThenLaunch(Activity activity) {\n        sync(activity, true);\n    }\n\n    private static void sync(Activity activity, boolean launchAfter) {\n        if (!RUNNING.compareAndSet(false, true)) {\n            Tools.runOnUiThread(() -> android.widget.Toast.makeText(activity, status, android.widget.Toast.LENGTH_LONG).show());\n            return;\n        }\n        ready = false;\n        readyForLaunch = false;\n        status = "Đang kiểm tra bản cập nhật...";\n        Tools.runOnUiThread(() -> android.widget.Toast.makeText(activity, status, android.widget.Toast.LENGTH_SHORT).show());\n        PojavApplication.sExecutorService.execute(() -> {\n            try {\n                status = "Đang đọc cấu hình Bestiary";\n                loadRuntimeMetadata();\n                status = "Đang chuẩn bị Fabric " + fabricLoaderVersion;\n                ensureFabricProfile();\n                status = "Đang kiểm tra modpack";\n                syncManagedFiles();\n                ensureBestiaryProfile();\n                ready = true;\n                readyForLaunch = launchAfter;\n                status = "Đã cập nhật xong";\n                Log.i(TAG, "Bestiary Android sync complete");\n                Tools.runOnUiThread(() -> {\n                    android.widget.Toast.makeText(activity, status, android.widget.Toast.LENGTH_SHORT).show();\n                    if (launchAfter) ExtraCore.setValue(net.kdt.pojavlaunch.extra.ExtraConstants.LAUNCH_GAME, true);\n                });\n            } catch (Throwable t) {\n                status = "Cập nhật lỗi: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());\n                Log.e(TAG, "Sync failed", t);\n                Tools.runOnUiThread(() -> android.widget.Toast.makeText(activity, status, android.widget.Toast.LENGTH_LONG).show());\n            } finally {\n                RUNNING.set(false);\n            }\n        });\n    }\n\n    public static boolean isReady() { return ready; }\n    public static String getStatus() { return status; }\n    public static boolean consumeReadyForLaunch() {\n        if (!ready || !readyForLaunch) return false;\n        readyForLaunch = false;\n        return true;\n    }\n'''
if start_old not in b:
    raise SystemExit('bootstrap start implementation marker missing')
b = b.replace(start_old, start_new, 1)
p.write_text(b, encoding='utf-8')

print('Bestiary offline identity + sync-before-play patch applied')

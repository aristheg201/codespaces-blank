from pathlib import Path

JAVA = Path('amethyst/app_pojavlauncher/src/main/java/net/kdt/pojavlaunch')


def req(ok, message):
    if not ok:
        raise SystemExit(message)

skin = JAVA / 'BestiarySkinManager.java'
s = skin.read_text(encoding='utf-8')
needle = '                if (data.length == 0 || data.length > MAX_BYTES) throw new IllegalArgumentException("Skin phải nhỏ hơn hoặc bằng 1 MB");\n'
req(needle in s, 'skin size marker missing')
s = s.replace(
    needle,
    needle + '                if (data.length < 8 || data[0] != (byte) 0x89 || data[1] != 0x50 || data[2] != 0x4e || data[3] != 0x47 || data[4] != 0x0d || data[5] != 0x0a || data[6] != 0x1a || data[7] != 0x0a) throw new IllegalArgumentException("File đã chọn không phải PNG hợp lệ");\n',
    1,
)
old = '''            total += n;
            if (total > limit) break;
            out.write(buf, 0, n);'''
req(old in s, 'skin hard-limit marker missing')
s = s.replace(old, '''            total += n;
            if (total > limit) throw new IllegalArgumentException("File skin vượt quá giới hạn dung lượng");
            out.write(buf, 0, n);''', 1)
old = '''                if (!"slim".equals(variant)) variant = "classic";

                File dir = new File(Tools.DIR_GAME_NEW, ".bestiary");'''
req(old in s, 'skin variant marker missing')
s = s.replace(old, '''                if (!"slim".equals(variant)) variant = "classic";
                final String savedVariant = variant;

                File dir = new File(Tools.DIR_GAME_NEW, ".bestiary");''', 1)
s = s.replace('meta.addProperty("variant", variant);', 'meta.addProperty("variant", savedVariant);', 1)
s = s.replace('"Đã lưu skin " + variant + ". Skin sẽ áp dụng khi vào server."', '"Đã lưu skin " + savedVariant + ". Skin sẽ áp dụng khi vào server."', 1)
skin.write_text(s, encoding='utf-8')

bootstrap = JAVA / 'BestiaryBootstrap.java'
b = bootstrap.read_text(encoding='utf-8')
# patch_bestiary_android_v100.py keeps this path traversal guard as the first
# stable statement inside isAllowed(). Insert runtime-component ownership after it.
needle = '        if (lower.contains("../") || lower.startsWith("/")) return false;\n'
req(needle in b, 'bootstrap path guard marker missing')
b = b.replace(
    needle,
    needle + '        if (lower.startsWith("mods/") && lower.contains("bestiary-skin-bridge")) return false;\n',
    1,
)
bootstrap.write_text(b, encoding='utf-8')

req('File đã chọn không phải PNG hợp lệ' in skin.read_text(encoding='utf-8'), 'PNG signature validation missing')
req('final String savedVariant = variant;' in skin.read_text(encoding='utf-8'), 'skin lambda capture fix missing')
req('lower.contains("bestiary-skin-bridge")' in bootstrap.read_text(encoding='utf-8'), 'Skin Bridge ownership guard missing')
print('Bestiary Android hardening patch applied')

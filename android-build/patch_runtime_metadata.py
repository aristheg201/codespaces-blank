from pathlib import Path

JAVA = Path('amethyst/app_pojavlauncher/src/main/java/net/kdt/pojavlaunch')
p = JAVA / 'BestiaryBootstrap.java'
s = p.read_text(encoding='utf-8')

old = '    private static final String FABRIC_PROFILE = "https://meta.fabricmc.net/v2/versions/loader/1.21.1/0.18.4/profile/json";\n'
new = '''    private static final String CONFIG = BASE + "/config.json";\n    private static final String FABRIC_META = "https://meta.fabricmc.net/v2/versions/loader/%s/%s/profile/json";\n    private static volatile String minecraftVersion = "1.21.1";\n    private static volatile String fabricLoaderVersion = "0.18.4";\n    private static volatile int javaMajor = 21;\n    private static volatile String serverHost = "";\n    private static volatile int serverPort = 25565;\n'''
if old not in s: raise SystemExit('FABRIC_PROFILE marker missing')
s = s.replace(old, new, 1)

old = '                status = "Đang chuẩn bị Bestiary Rebirth";\n                ensureFabricProfile();\n'
new = '                status = "Đang đọc cấu hình Bestiary";\n                loadRuntimeMetadata();\n                status = "Đang chuẩn bị Fabric " + fabricLoaderVersion;\n                ensureFabricProfile();\n'
if old not in s: raise SystemExit('bootstrap start marker missing')
s = s.replace(old, new, 1)
s = s.replace('readUrl(FABRIC_PROFILE)', 'readUrl(fabricProfileUrl())')

insert_before = '    private static void ensureFabricProfile() throws Exception {\n'
helper = '''    private static void loadRuntimeMetadata() throws Exception {\n        try {\n            JsonObject config = JsonParser.parseString(readUrl(CONFIG)).getAsJsonObject();\n            minecraftVersion = string(config, "defaultMinecraftVersion", minecraftVersion);\n            fabricLoaderVersion = string(config, "defaultFabricLoader", fabricLoaderVersion);\n            javaMajor = integer(config, "javaMajor", javaMajor);\n            serverHost = string(config, "serverHost", serverHost);\n            serverPort = integer(config, "serverPort", serverPort);\n        } catch (Exception ignored) {}\n        JsonObject channel;\n        try { channel = JsonParser.parseString(readUrl(STABLE)).getAsJsonObject(); }\n        catch (Exception ignored) { channel = JsonParser.parseString(readUrl(TESTING)).getAsJsonObject(); }\n        if (channel.has("manifestUrl")) {\n            JsonObject manifest = JsonParser.parseString(readUrl(channel.get("manifestUrl").getAsString())).getAsJsonObject();\n            if (manifest.has("minecraft") && manifest.get("minecraft").isJsonObject()) {\n                JsonObject runtime = manifest.getAsJsonObject("minecraft");\n                String loader = string(runtime, "loader", "fabric");\n                if (!"fabric".equalsIgnoreCase(loader)) throw new IOException("Bestiary Android chỉ hỗ trợ Fabric: " + loader);\n                minecraftVersion = string(runtime, "version", minecraftVersion);\n                fabricLoaderVersion = string(runtime, "loaderVersion", fabricLoaderVersion);\n                javaMajor = integer(runtime, "javaMajor", javaMajor);\n            }\n        }\n    }\n\n    public static void appendQuickPlayArgs(java.util.List<String> args) {\n        String host = serverHost == null ? "" : serverHost.trim();\n        if (host.isEmpty()) return;\n        String endpoint = host;\n        if (host.indexOf(':') >= 0 && !host.startsWith("[") && !host.endsWith("]")) endpoint = "[" + host + "]";\n        args.add("--quickPlayMultiplayer");\n        args.add(endpoint + ":" + serverPort);\n    }\n\n    private static String fabricProfileUrl() {\n        try {\n            return String.format(Locale.ROOT, FABRIC_META,\n                    java.net.URLEncoder.encode(minecraftVersion, "UTF-8"),\n                    java.net.URLEncoder.encode(fabricLoaderVersion, "UTF-8"));\n        } catch (Exception e) { throw new RuntimeException(e); }\n    }\n\n    private static String string(JsonObject obj, String key, String fallback) {\n        try {\n            if (obj != null && obj.has(key) && !obj.get(key).isJsonNull()) {\n                String v = obj.get(key).getAsString().trim();\n                if (!v.isEmpty()) return v;\n            }\n        } catch (Exception ignored) {}\n        return fallback;\n    }\n\n    private static int integer(JsonObject obj, String key, int fallback) {\n        try { if (obj != null && obj.has(key)) return obj.get(key).getAsInt(); } catch (Exception ignored) {}\n        return fallback;\n    }\n\n'''
if insert_before not in s: raise SystemExit('ensureFabricProfile marker missing')
s = s.replace(insert_before, helper + insert_before, 1)
p.write_text(s, encoding='utf-8')

tools = JAVA / 'Tools.java'
t = tools.read_text(encoding='utf-8')
marker = '        javaArgList.add(versionInfo.mainClass);\n        javaArgList.addAll(Arrays.asList(launchArgs));\n'
if marker not in t: raise SystemExit('Tools launch marker missing')
t = t.replace(marker, marker + '        BestiaryBootstrap.appendQuickPlayArgs(javaArgList);\n', 1)
tools.write_text(t, encoding='utf-8')

print('Bestiary runtime metadata + Quick Play patch applied')

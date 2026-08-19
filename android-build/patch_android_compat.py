from pathlib import Path

p = Path("amethyst/app_pojavlauncher/src/main/java/net/kdt/pojavlaunch/BestiaryBootstrap.java")
s = p.read_text(encoding="utf-8")
s = s.replace("import java.io.BufferedOutputStream;", "import java.io.BufferedOutputStream;\nimport java.io.ByteArrayOutputStream;")
s = s.replace("import java.util.HashSet;", "import java.util.ArrayList;\nimport java.util.Collections;\nimport java.util.HashSet;\nimport java.util.List;")
s = s.replace("p.pojavRendererName.isBlank()", "p.pojavRendererName.trim().isEmpty()")
s = s.replace(
    "        paths.stream().sorted().forEach(arr::add);",
    "        List<String> sorted = new ArrayList<>(paths);\n        Collections.sort(sorted);\n        for (String item : sorted) arr.add(item);",
)
s = s.replace(
    "            byte[] bytes = in.readAllBytes();\n            return new String(bytes, StandardCharsets.UTF_8);",
    "            return new String(readAll(in), StandardCharsets.UTF_8);",
)
s = s.replace(
    "        try (FileInputStream in = new FileInputStream(file)) { return new String(in.readAllBytes(), StandardCharsets.UTF_8); }",
    "        try (FileInputStream in = new FileInputStream(file)) { return new String(readAll(in), StandardCharsets.UTF_8); }",
)
needle = "    private static void writeAtomic(File target, byte[] data) throws Exception {"
helper = '''    private static byte[] readAll(InputStream in) throws IOException {\n        ByteArrayOutputStream out = new ByteArrayOutputStream();\n        byte[] buf = new byte[16 * 1024];\n        int n;\n        while ((n = in.read(buf)) != -1) {\n            if (n > 0) out.write(buf, 0, n);\n        }\n        return out.toByteArray();\n    }\n\n'''
if needle not in s:
    raise SystemExit("BestiaryBootstrap writeAtomic marker missing")
s = s.replace(needle, helper + needle, 1)
p.write_text(s, encoding="utf-8")
print("Android Java 8 source compatibility patch applied")

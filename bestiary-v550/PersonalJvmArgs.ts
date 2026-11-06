import path from 'node:path';
import fs from 'fs-extra';
import type { ModpackLoader } from '../../shared/ipc';

/**
 * Forge-family installers generate a version.json with a JVM module path.
 * minecraft-launcher-core resolves the custom profile but omits its module
 * path. Read the installed official profile and pass the necessary JVM options
 * to the shared MinecraftLauncher, only for this personal instance.
 */
export async function withLoaderJvmArgs(
  loader: ModpackLoader,
  base: readonly string[],
  gameDirectory: string,
  profileId: string,
): Promise<string[]> {
  if (loader !== 'neoforge' && loader !== 'forge') return [...base];

  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(profileId)) {
    throw new Error('ID của Forge/NeoForge profile không hợp lệ.');
  }
  const root = path.resolve(gameDirectory);
  const libraryDirectory = path.join(root, 'libraries');
  const profileFile = path.join(root, 'versions', profileId, profileId + '.json');
  const profile = await fs.readJson(profileFile) as {
    id?: string;
    arguments?: { jvm?: unknown[] };
  };
  if (profile.id !== profileId || !Array.isArray(profile.arguments?.jvm)) {
    throw new Error('Forge/NeoForge profile không có JVM arguments hợp lệ.');
  }

  const original = profile.arguments.jvm;
  const argumentsToAdd: string[] = [];
  let foundModulePath = false;
  let foundAddModules = false;

  const expand = (value: string): string => {
    const expanded = value
      .replace(/\$\{library_directory\}/gu, libraryDirectory)
      .replace(/\$\{classpath_separator\}/gu, path.delimiter)
      .replace(/\$\{version_name\}/gu, profileId);
    if (/\$\{[^}]+\}/u.test(expanded)) {
      throw new Error('Tham số JVM của loader chứa biến chưa được giải quyết: ' + expanded.slice(0, 180));
    }
    return expanded;
  };

  for (let i = 0; i < original.length; i += 1) {
    const item = original[i];
    if (typeof item !== 'string') continue;

    if (item === '-p' || item === '--module-path') {
      const raw = original[++i];
      if (typeof raw !== 'string') throw new Error('NeoForge module-path không hợp lệ.');
      const paths = expand(raw).split(path.delimiter);
      if (!paths.length || paths.some((part) => part.length === 0)) {
        throw new Error('NeoForge module-path trống hoặc không hợp lệ.');
      }
      for (const entry of paths) {
        const fullPath = path.resolve(entry);
        const relative = path.relative(libraryDirectory, fullPath);
        if (relative.startsWith('..') || path.isAbsolute(relative)) {
          throw new Error('NeoForge module-path nằm ngoài thư viện instance: ' + entry);
        }
        if (!(await fs.pathExists(fullPath))) {
          throw new Error('Thiếu thư viện NeoForge bắt buộc: ' + relative);
        }
      }
      argumentsToAdd.push('--module-path=' + paths.join(path.delimiter));
      foundModulePath = true;
      continue;
    }

    if (item === '--add-modules' || item === '--add-opens' || item === '--add-exports') {
      const value = original[++i];
      if (typeof value !== 'string' || !value.length) {
        throw new Error('NeoForge JVM option thiếu giá trị: ' + item);
      }
      const expanded = expand(value);
      argumentsToAdd.push(item + '=' + expanded);
      if (item === '--add-modules' && expanded.includes('ALL-MODULE-PATH')) foundAddModules = true;
      continue;
    }

    // Preserve the relevant official system properties for Forge bootstrap.
    if (item.startsWith('-DlibraryDirectory=') || item.startsWith('-DignoreList=') ||
        item.startsWith('-Djava.net.preferIPv6Addresses=')) {
      argumentsToAdd.push(expand(item));
    }
  }

  if (loader === 'neoforge' && (!foundModulePath || !foundAddModules)) {
    throw new Error('NeoForge profile thiếu --module-path hoặc --add-modules.');
  }
  if (!argumentsToAdd.length) {
    throw new Error('Không tìm thấy JVM flags trong Forge/NeoForge profile.');
  }
  return [...base, ...argumentsToAdd];
}

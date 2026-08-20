const fs = require('node:fs');
const p = 'manager/src/main/services/GithubDistributionService.ts';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const req = (ok, msg) => { if (!ok) throw new Error(msg); };

const oldNormalize = `    const normalizeProfiles = (value: unknown): Array<'full' | 'lite' | 'android'> => Array.isArray(value)\n      ? [...new Set(value.filter((profile): profile is 'full' | 'lite' | 'android' => profile === 'full' || profile === 'lite' || profile === 'android'))]\n      : [];`;
req(s.includes(oldNormalize), '6.2 profile normalizer missing');
s = s.replace(oldNormalize, `    const normalizeProfiles = (value: unknown): Array<'full' | 'lite' | 'android' | 'server'> => Array.isArray(value)\n      ? [...new Set(value.filter((profile): profile is 'full' | 'lite' | 'android' | 'server' => profile === 'full' || profile === 'lite' || profile === 'android' || profile === 'server'))]\n      : [];`);

const oldPolicy = `    const profilesByPath = request.profilesByPath ?? {};\n    const manifestProfiles = new Map<string, Array<'full' | 'lite' | 'android'>>();\n    for (const file of files) {\n      const isModJar = /^mods\\/.+\\.jar$/iu.test(file.path);\n      const requestedProfiles = normalizeProfiles(profilesByPath[file.path]);\n      const profiles = requestedProfiles.length > 0 ? requestedProfiles : (isModJar ? [] : ['full', 'lite'] as Array<'full' | 'lite' | 'android'>);\n      if (isModJar && profiles.length === 0) {\n        throw new Error(\`Mod chưa phân loại FULL / LITE / BOTH: \${file.path}\`);\n      }\n      manifestProfiles.set(file.path, profiles);\n    }`;
req(s.includes(oldPolicy), '6.2 manifest profile policy block missing');
s = s.replace(oldPolicy, `    const profilesByPath = request.profilesByPath ?? {};\n    const enabledByPath = request.enabledByPath ?? {};\n    const sideByPath = request.sideByPath ?? {};\n    const androidCompatibilityByPath = request.androidCompatibilityByPath ?? {};\n    const publishFiles = files.filter((file) => !/^mods\\/.+\\.jar$/iu.test(file.path) || enabledByPath[file.path] !== false);\n    const manifestProfiles = new Map<string, Array<'full' | 'lite' | 'android' | 'server'>>();\n    for (const file of publishFiles) {\n      const isModJar = /^mods\\/.+\\.jar$/iu.test(file.path);\n      const requestedProfiles = normalizeProfiles(profilesByPath[file.path]);\n      const profiles = requestedProfiles.length > 0 ? requestedProfiles : (isModJar ? [] : ['full', 'lite'] as Array<'full' | 'lite' | 'android' | 'server'>);\n      if (isModJar) {\n        const side = sideByPath[file.path] ?? 'unknown';\n        if (side !== 'client' && side !== 'server' && side !== 'both') throw new Error(\`Mod chưa xác định CLIENT / SERVER / BOTH: \${file.path}\`);\n        if (profiles.length === 0) throw new Error(\`Mod chưa có profile phát hành: \${file.path}\`);\n        if (side === 'client' && profiles.includes('server')) throw new Error(\`CLIENT mod không được publish SERVER: \${file.path}\`);\n        if (side === 'server' && profiles.some((profile) => profile !== 'server')) throw new Error(\`SERVER mod không được publish sang client: \${file.path}\`);\n        if (profiles.includes('android') && androidCompatibilityByPath[file.path] === 'blocked') throw new Error(\`Mod bị BLOCK Android nhưng vẫn gán ANDROID: \${file.path}\`);\n      }\n      manifestProfiles.set(file.path, profiles);\n    }`);

for (const profile of ['full','lite','android']) {
  s = s.replaceAll(`files.filter((file) => manifestProfiles.get(file.path)?.includes('${profile}'))`, `publishFiles.filter((file) => manifestProfiles.get(file.path)?.includes('${profile}'))`);
}

const androidBlock = `        android: {\n          name: 'Android',\n          description: 'Bộ mod dành riêng cho Bestiary Launcher Android / Pojav.',\n          minimumRamMb: 3072,\n          recommendedRamMb: 4096,\n          fileCount: publishFiles.filter((file) => manifestProfiles.get(file.path)?.includes('android')).length,\n          totalBytes: publishFiles.filter((file) => manifestProfiles.get(file.path)?.includes('android')).reduce((sum, file) => sum + file.size, 0),\n        },`;
req(s.includes(androidBlock), 'Android profile summary block missing');
s = s.replace(androidBlock, androidBlock + `\n        server: {\n          name: 'Server',\n          description: 'Mod bắt buộc hoặc được phép chạy trên dedicated server.',\n          minimumRamMb: 0,\n          recommendedRamMb: 0,\n          fileCount: publishFiles.filter((file) => manifestProfiles.get(file.path)?.includes('server')).length,\n          totalBytes: publishFiles.filter((file) => manifestProfiles.get(file.path)?.includes('server')).reduce((sum, file) => sum + file.size, 0),\n        },`);

const manifestFiles = `      files: files.map((file) => ({\n        path: file.path,\n        hash: file.hash,\n        size: file.size,\n        profiles: manifestProfiles.get(file.path),\n        downloadUrl:`;
req(s.includes(manifestFiles), 'manifest files block missing');
s = s.replace(manifestFiles, `      files: publishFiles.map((file) => ({\n        path: file.path,\n        hash: file.hash,\n        size: file.size,\n        profiles: manifestProfiles.get(file.path),\n        side: /^mods\\/.+\\.jar$/iu.test(file.path) ? sideByPath[file.path] : undefined,\n        androidCompatibility: /^mods\\/.+\\.jar$/iu.test(file.path) ? (androidCompatibilityByPath[file.path] ?? 'auto') : undefined,\n        downloadUrl:`);

s = s.replace('fileCount: files.length,', 'fileCount: publishFiles.length,');
s = s.replace('totalBytes: files.reduce((sum, file) => sum + file.size, 0),', 'totalBytes: publishFiles.reduce((sum, file) => sum + file.size, 0),');

req(s.includes("includes('server')"), 'server profile summary missing after patch');
req(s.includes('enabledByPath') && s.includes('sideByPath') && s.includes('androidCompatibilityByPath'), 'Manager 6.3 publish policy fields missing');
fs.writeFileSync(p, s);
console.log('Manager 6.3 server profile, enabled state and side publish contracts patched.');

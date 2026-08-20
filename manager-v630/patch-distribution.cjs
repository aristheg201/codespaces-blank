const fs = require('node:fs');
const p = 'manager/src/main/services/GithubDistributionService.ts';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const req = (ok, msg) => { if (!ok) throw new Error(msg); };

const methodStart = s.search(/\n\s*(?:public\s+)?async\s+publish\s*\(/);
req(methodStart >= 0, 'publish method start missing');
let methodEnd = s.slice(methodStart + 1).search(/\n\s*(?:public\s+|private\s+)?(?:async\s+)?[A-Za-z_$][A-Za-z0-9_$]*\s*\(/);
req(methodEnd >= 0, 'publish method end missing');
methodEnd += methodStart + 1;
const before = s.slice(0, methodStart);
let body = s.slice(methodStart, methodEnd);
const after = s.slice(methodEnd);

const oldNormalize = `const normalizeProfiles = (value: unknown): Array<'full' | 'lite' | 'android'> => Array.isArray(value)\n      ? [...new Set(value.filter((profile): profile is 'full' | 'lite' | 'android' => profile === 'full' || profile === 'lite' || profile === 'android'))]\n      : [];`;
req(body.includes(oldNormalize), '6.2 profile normalizer missing');
body = body.replace(oldNormalize, `const normalizeProfiles = (value: unknown): Array<'full' | 'lite' | 'android' | 'server'> => Array.isArray(value)\n      ? [...new Set(value.filter((profile): profile is 'full' | 'lite' | 'android' | 'server' => profile === 'full' || profile === 'lite' || profile === 'android' || profile === 'server'))]\n      : [];`);

const oldPolicy = `const profilesByPath = request.profilesByPath ?? {};\n    const manifestProfiles = new Map<string, Array<'full' | 'lite' | 'android'>>();\n    for (const file of files) {\n      const isModJar = /^mods\\/.+\\.jar$/iu.test(file.path);\n      const requestedProfiles = normalizeProfiles(profilesByPath[file.path]);\n      const profiles = requestedProfiles.length > 0 ? requestedProfiles : (isModJar ? [] : ['full', 'lite'] as Array<'full' | 'lite' | 'android'>);\n      if (isModJar && profiles.length === 0) {\n        throw new Error(\`Mod chưa phân loại FULL / LITE / BOTH: \${file.path}\`);\n      }\n      manifestProfiles.set(file.path, profiles);\n    }`;
req(body.includes(oldPolicy), '6.2 manifest profile policy block missing');
body = body.replace(oldPolicy, `const profilesByPath = request.profilesByPath ?? {};\n    const enabledByPath = request.enabledByPath ?? {};\n    const sideByPath = request.sideByPath ?? {};\n    const androidCompatibilityByPath = request.androidCompatibilityByPath ?? {};\n    const publishFiles = files.filter((file) => !/^mods\\/.+\\.jar$/iu.test(file.path) || enabledByPath[file.path] !== false);\n    const manifestProfiles = new Map<string, Array<'full' | 'lite' | 'android' | 'server'>>();\n    for (const file of publishFiles) {\n      const isModJar = /^mods\\/.+\\.jar$/iu.test(file.path);\n      const requestedProfiles = normalizeProfiles(profilesByPath[file.path]);\n      const profiles = requestedProfiles.length > 0 ? requestedProfiles : (isModJar ? [] : ['full', 'lite'] as Array<'full' | 'lite' | 'android' | 'server'>);\n      if (isModJar) {\n        const side = sideByPath[file.path] ?? 'unknown';\n        if (side !== 'client' && side !== 'server' && side !== 'both') throw new Error(\`Mod chưa xác định CLIENT / SERVER / BOTH: \${file.path}\`);\n        if (profiles.length === 0) throw new Error(\`Mod chưa có profile phát hành: \${file.path}\`);\n        if (side === 'client' && profiles.includes('server')) throw new Error(\`CLIENT mod không được publish SERVER: \${file.path}\`);\n        if (side === 'server' && profiles.some((profile) => profile !== 'server')) throw new Error(\`SERVER mod không được publish sang client: \${file.path}\`);\n        if (profiles.includes('android') && androidCompatibilityByPath[file.path] === 'blocked') throw new Error(\`Mod bị BLOCK Android nhưng vẫn gán ANDROID: \${file.path}\`);\n      }\n      manifestProfiles.set(file.path, profiles);\n    }`);

body = body.replace(/\bfiles\.filter\(/g, 'publishFiles.filter(')
  .replace(/\bfiles\.map\(/g, 'publishFiles.map(')
  .replace(/\bfiles\.reduce\(/g, 'publishFiles.reduce(')
  .replace(/\bfiles\.length\b/g, 'publishFiles.length');

const androidBlock = `        android: {\n          name: 'Android',\n          description: 'Bộ mod dành riêng cho Bestiary Launcher Android / Pojav.',\n          minimumRamMb: 3072,\n          recommendedRamMb: 4096,\n          fileCount: publishFiles.filter((file) => manifestProfiles.get(file.path)?.includes('android')).length,\n          totalBytes: publishFiles.filter((file) => manifestProfiles.get(file.path)?.includes('android')).reduce((sum, file) => sum + file.size, 0),\n        },`;
req(body.includes(androidBlock), 'Android profile summary block missing');
body = body.replace(androidBlock, androidBlock + `\n        server: {\n          name: 'Server',\n          description: 'Mod bắt buộc hoặc được phép chạy trên dedicated server.',\n          minimumRamMb: 0,\n          recommendedRamMb: 0,\n          fileCount: publishFiles.filter((file) => manifestProfiles.get(file.path)?.includes('server')).length,\n          totalBytes: publishFiles.filter((file) => manifestProfiles.get(file.path)?.includes('server')).reduce((sum, file) => sum + file.size, 0),\n        },`);

const fileEntry = `        profiles: manifestProfiles.get(file.path),\n        downloadUrl:`;
req(body.includes(fileEntry), 'manifest file profile entry missing');
body = body.replace(fileEntry, `        profiles: manifestProfiles.get(file.path),\n        side: /^mods\\/.+\\.jar$/iu.test(file.path) ? sideByPath[file.path] : undefined,\n        androidCompatibility: /^mods\\/.+\\.jar$/iu.test(file.path) ? (androidCompatibilityByPath[file.path] ?? 'auto') : undefined,\n        downloadUrl:`);

s = before + body + after;
fs.writeFileSync(p, s);
console.log('Manager 6.3 server profile, enabled state and side publish contracts patched.');

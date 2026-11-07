const fs = require('node:fs');
const servicePath = 'manager/src/main/services/GithubDistributionService.ts';
const packagePath = 'manager/package.json';
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const req = (ok, msg) => { if (!ok) throw new Error(msg); };

let s = read(servicePath);
const oldNormalize = `    const normalizeProfiles = (value: unknown): Array<'full' | 'lite'> => Array.isArray(value)\n      ? [...new Set(value.filter((profile): profile is 'full' | 'lite' => profile === 'full' || profile === 'lite'))]\n      : [];`;
const newNormalize = `    const normalizeProfiles = (value: unknown): Array<'full' | 'lite' | 'android'> => Array.isArray(value)\n      ? [...new Set(value.filter((profile): profile is 'full' | 'lite' | 'android' => profile === 'full' || profile === 'lite' || profile === 'android'))]\n      : [];`;
req(s.includes(oldNormalize), 'profile normalizer marker missing');
s = s.replace(oldNormalize, newNormalize);
s = s.replace("    const manifestProfiles = new Map<string, Array<'full' | 'lite'>>();", "    const manifestProfiles = new Map<string, Array<'full' | 'lite' | 'android'>>();");
s = s.replace("      const profiles = requestedProfiles.length > 0 ? requestedProfiles : (isModJar ? [] : ['full', 'lite'] as Array<'full' | 'lite'>);", "      const profiles = requestedProfiles.length > 0 ? requestedProfiles : (isModJar ? [] : ['full', 'lite'] as Array<'full' | 'lite' | 'android'>);");

const liteBlock = `        lite: {\n          name: 'Lite',\n          description: 'Nhẹ hơn, ưu tiên FPS và thời gian tải.',\n          minimumRamMb: 3072,\n          recommendedRamMb: 4096,\n          fileCount: files.filter((file) => manifestProfiles.get(file.path)?.includes('lite')).length,\n          totalBytes: files.filter((file) => manifestProfiles.get(file.path)?.includes('lite')).reduce((sum, file) => sum + file.size, 0),\n        },`;
req(s.includes(liteBlock), 'lite profile summary marker missing');
s = s.replace(liteBlock, liteBlock + `\n        android: {\n          name: 'Android',\n          description: 'Bộ mod dành riêng cho Bestiary Launcher Android / Pojav.',\n          minimumRamMb: 3072,\n          recommendedRamMb: 4096,\n          fileCount: files.filter((file) => manifestProfiles.get(file.path)?.includes('android')).length,\n          totalBytes: files.filter((file) => manifestProfiles.get(file.path)?.includes('android')).reduce((sum, file) => sum + file.size, 0),\n        },`);
fs.writeFileSync(servicePath, s);

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = '6.0.6';
pkg.author = { name: 'SVFrame Team Studio' };
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
console.log('Bestiary Pack Manager 6.0.6 Android profile manifest patch applied.');

const fs = require('node:fs');

const servicePath = 'manager/src/main/services/GithubDistributionService.ts';
const packagePath = 'manager/package.json';
const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const req = (ok, msg) => { if (!ok) throw new Error(msg); };

let service = read(servicePath);

const publishMarker = "    const status = await this.ensureRepository();";
req(service.includes(publishMarker), 'publish status marker missing');
service = service.replace(publishMarker, `    const normalizeProfiles = (value: unknown): Array<'full' | 'lite'> => Array.isArray(value)\n      ? [...new Set(value.filter((profile): profile is 'full' | 'lite' => profile === 'full' || profile === 'lite'))]\n      : [];\n    const profilesByPath = request.profilesByPath ?? {};\n    const manifestProfiles = new Map<string, Array<'full' | 'lite'>>();\n    for (const file of files) {\n      const isModJar = /^mods\\/.+\\.jar$/iu.test(file.path);\n      const requestedProfiles = normalizeProfiles(profilesByPath[file.path]);\n      const profiles = requestedProfiles.length > 0 ? requestedProfiles : (isModJar ? [] : ['full', 'lite'] as Array<'full' | 'lite'>);\n      if (isModJar && profiles.length === 0) {\n        throw new Error(\`Mod chưa phân loại FULL / LITE / BOTH: \${file.path}\`);\n      }\n      manifestProfiles.set(file.path, profiles);\n    }\n\n    const status = await this.ensureRepository();`);

const oldFiles = `      files: files.map((file) => ({\n        path: file.path,\n        hash: file.hash,\n        size: file.size,\n        downloadUrl: \`https://github.com/\${repository}/releases/download/bestiary-objects/\${this.assetName(file.hash)}\`,\n      })),`;
req(service.includes(oldFiles), 'manifest files marker missing');
service = service.replace(oldFiles, `      profiles: {\n        full: {\n          name: 'Full',\n          description: 'Đầy đủ nội dung và hiệu ứng Bestiary.',\n          minimumRamMb: 6144,\n          recommendedRamMb: 8192,\n          fileCount: files.filter((file) => manifestProfiles.get(file.path)?.includes('full')).length,\n          totalBytes: files.filter((file) => manifestProfiles.get(file.path)?.includes('full')).reduce((sum, file) => sum + file.size, 0),\n        },\n        lite: {\n          name: 'Lite',\n          description: 'Nhẹ hơn, ưu tiên FPS và thời gian tải.',\n          minimumRamMb: 3072,\n          recommendedRamMb: 4096,\n          fileCount: files.filter((file) => manifestProfiles.get(file.path)?.includes('lite')).length,\n          totalBytes: files.filter((file) => manifestProfiles.get(file.path)?.includes('lite')).reduce((sum, file) => sum + file.size, 0),\n        },\n      },\n      files: files.map((file) => ({\n        path: file.path,\n        hash: file.hash,\n        size: file.size,\n        profiles: manifestProfiles.get(file.path),\n        downloadUrl: \`https://github.com/\${repository}/releases/download/bestiary-objects/\${this.assetName(file.hash)}\`,\n      })),`);
fs.writeFileSync(servicePath, service);

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = '6.0.5';
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
console.log('Bestiary Pack Manager 6.0.5 profile-aware manifest patch applied.');

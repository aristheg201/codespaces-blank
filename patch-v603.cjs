const fs = require('node:fs');

const typesPath = 'manager/src/shared/types.ts';
const settingsPath = 'manager/src/main/services/SettingsService.ts';
const servicePath = 'manager/src/main/services/GithubDistributionService.ts';
const appPath = 'manager/src/renderer/src/App.tsx';
const packagePath = 'manager/package.json';
const builderPath = 'manager/electron-builder.json';

const readText = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const mustReplace = (text, pattern, replacement, label) => {
  if (!pattern.test(text)) throw new Error(`Cannot patch ${label}`);
  return text.replace(pattern, replacement);
};

let types = readText(typesPath);
types = mustReplace(types,
  /export interface DistributionSettings \{\n  repository: string;\n  discordUrl: string;\n  announcementTitle: string;\n  announcementBody: string;\n\}/,
  `export interface DistributionSettings {\n  repository: string;\n  discordUrl: string;\n  announcementTitle: string;\n  announcementBody: string;\n  serverName: string;\n  serverHost: string;\n  serverPort: number;\n}`,
  'DistributionSettings');
fs.writeFileSync(typesPath, types);

let settings = readText(settingsPath);
settings = mustReplace(settings,
  /const DEFAULT_DISTRIBUTION: DistributionSettings = \{\n  repository: '',\n  discordUrl: '',\n  announcementTitle: '',\n  announcementBody: '',\n\};/,
  `const DEFAULT_DISTRIBUTION: DistributionSettings = {\n  repository: '',\n  discordUrl: '',\n  announcementTitle: '',\n  announcementBody: '',\n  serverName: 'Bestiary Rebirth',\n  serverHost: 'play.svframe.net',\n  serverPort: 25565,\n};`,
  'distribution defaults');
settings = mustReplace(settings,
  /  async setDistribution\(distribution: DistributionSettings\): Promise<AppSettings> \{[\s\S]*?\n  \}\n\n  private async save/,
  `  async setDistribution(distribution: DistributionSettings): Promise<AppSettings> {\n    const serverName = String(distribution.serverName ?? '').trim().slice(0, 80);\n    const serverHost = String(distribution.serverHost ?? '').trim().slice(0, 253);\n    const serverPort = Number(distribution.serverPort);\n    if (!serverName) throw new Error('Tên máy chủ không được để trống.');\n    if (!serverHost || !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$|^(?:\\d{1,3}\\.){3}\\d{1,3}$|^[0-9A-Fa-f:]+$/u.test(serverHost)) {\n      throw new Error('Host máy chủ không hợp lệ.');\n    }\n    if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) throw new Error('Port phải nằm trong khoảng 1-65535.');\n    this.settings.distribution = { ...DEFAULT_DISTRIBUTION, ...distribution, serverName, serverHost, serverPort };\n    await this.save();\n    return this.get();\n  }\n\n  private async save`,
  'setDistribution validation');
fs.writeFileSync(settingsPath, settings);

let service = readText(servicePath);
service = mustReplace(service,
  /    await this\.upsertContent\(repository, branch, 'bestiary-distribution\/config\.json', JSON\.stringify\(\{ discordUrl: this\.settings\.discordUrl\.trim\(\) \}, null, 2\), 'Update Bestiary launcher config'\);/,
  `    await this.upsertContent(repository, branch, 'bestiary-distribution/config.json', JSON.stringify({\n      discordUrl: this.settings.discordUrl.trim(),\n      serverName: this.settings.serverName.trim(),\n      serverHost: this.settings.serverHost.trim(),\n      serverPort: this.settings.serverPort,\n    }, null, 2), 'Update Bestiary launcher config');`,
  'launcher runtime config');
fs.writeFileSync(servicePath, service);

let app = readText(appPath);
app = mustReplace(app,
  /  const \[form, setForm\] = useState<DistributionSettings>\(settings\?\.distribution \|\| \{ repository:'', discordUrl:'', announcementTitle:'', announcementBody:'' \}\);/,
  `  const [form, setForm] = useState<DistributionSettings>(settings?.distribution || { repository:'', discordUrl:'', announcementTitle:'', announcementBody:'', serverName:'Bestiary Rebirth', serverHost:'play.svframe.net', serverPort:25565 });`,
  'settings form defaults');
app = mustReplace(app,
  /  const update = \(key: keyof DistributionSettings, value: string\) => setForm\(prev => \(\{ \.\.\.prev, \[key\]: value \}\)\);/,
  `  const update = <K extends keyof DistributionSettings>(key: K, value: DistributionSettings[K]) => setForm(prev => ({ ...prev, [key]: value }));`,
  'settings update helper');
app = mustReplace(app,
  /        <Field label="DISCORD URL" className="mt-5"><input value=\{form\.discordUrl\} onChange=\{e=>update\('discordUrl',e\.target\.value\)\} placeholder="https:\/\/discord\.gg\/\.\.\." className="input" \/><\/Field>/,
  `        <div className="mt-5 grid grid-cols-2 gap-3">\n          <Field label="TÊN MÁY CHỦ"><input value={form.serverName} onChange={e=>update('serverName',e.target.value)} placeholder="Bestiary Rebirth" className="input" /></Field>\n          <Field label="PORT"><input type="number" min={1} max={65535} value={form.serverPort} onChange={e=>update('serverPort', Number(e.target.value))} placeholder="25565" className="input" /></Field>\n        </div>\n        <Field label="HOST / IP" className="mt-4"><input value={form.serverHost} onChange={e=>update('serverHost',e.target.value)} placeholder="play.svframe.net" className="input" /></Field>\n        <div className="mt-2 text-[11px] leading-5 text-zinc-500">Launcher dùng địa chỉ này cho Quick Play. Thay đổi có hiệu lực sau lần publish tiếp theo, không cần build lại Launcher.</div>\n        <Field label="DISCORD URL" className="mt-5"><input value={form.discordUrl} onChange={e=>update('discordUrl',e.target.value)} placeholder="https://discord.gg/..." className="input" /></Field>`,
  'server fields UI');
fs.writeFileSync(appPath, app);

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
pkg.version = '6.0.3';
pkg.author = { name: 'SVFrame Team Studio' };
pkg.description = 'Bestiary Pack Manager';
fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');

const builder = JSON.parse(fs.readFileSync(builderPath, 'utf8'));
builder.copyright = 'Copyright © 2026 SVFrame Team Studio';
fs.writeFileSync(builderPath, JSON.stringify(builder, null, 2) + '\n');

console.log('Bestiary Pack Manager 6.0.3 server config + publisher metadata patch applied.');

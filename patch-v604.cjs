const fs = require('node:fs');
const typesPath = 'manager/src/shared/types.ts';
const settingsPath = 'manager/src/main/services/SettingsService.ts';
const servicePath = 'manager/src/main/services/GithubDistributionService.ts';
const appPath = 'manager/src/renderer/src/App.tsx';
const packagePath = 'manager/package.json';
const read = p => fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const req = (ok,msg) => { if(!ok) throw new Error(msg); };

let types=read(typesPath);
req(types.includes('  serverPort: number;\n}'),'DistributionSettings marker missing');
types=types.replace('  serverPort: number;\n}', `  serverPort: number;\n  minecraftVersion: string;\n  modLoader: 'fabric';\n  fabricLoaderVersion: string;\n  javaMajor: number;\n}`);
fs.writeFileSync(typesPath,types);

let settings=read(settingsPath);
req(settings.includes("  serverPort: 25565,\n};"),'defaults marker missing');
settings=settings.replace("  serverPort: 25565,\n};", `  serverPort: 25565,\n  minecraftVersion: '1.21.1',\n  modLoader: 'fabric',\n  fabricLoaderVersion: '0.18.4',\n  javaMajor: 21,\n};`);
const validationMarker = "    if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) throw new Error('Port phải nằm trong khoảng 1-65535.');";
req(settings.includes(validationMarker),'validation marker missing');
settings=settings.replace(validationMarker, validationMarker + `\n    const minecraftVersion = String(distribution.minecraftVersion ?? '').trim();\n    const fabricLoaderVersion = String(distribution.fabricLoaderVersion ?? '').trim();\n    const javaMajor = Number(distribution.javaMajor);\n    if (!/^\\d+\\.\\d+(?:\\.\\d+)?(?:[-+][0-9A-Za-z.-]+)?$/u.test(minecraftVersion)) throw new Error('Minecraft Version không hợp lệ.');\n    if (distribution.modLoader !== 'fabric') throw new Error('Bestiary hiện chỉ hỗ trợ Fabric loader.');\n    if (!/^\\d+\\.\\d+(?:\\.\\d+)?(?:[-+][0-9A-Za-z.-]+)?$/u.test(fabricLoaderVersion)) throw new Error('Fabric Loader Version không hợp lệ.');\n    if (javaMajor !== 21) throw new Error('Bestiary hiện chỉ hỗ trợ Java Runtime 21.');`);
const normalizedPattern = /this\.settings\.distribution = \{ \.\.\.DEFAULT_DISTRIBUTION, \.\.\.distribution, serverName, serverHost, serverPort \};/;
req(normalizedPattern.test(settings),'normalized settings marker missing');
settings=settings.replace(normalizedPattern, `this.settings.distribution = {\n      ...DEFAULT_DISTRIBUTION,\n      ...distribution,\n      serverName,\n      serverHost,\n      serverPort,\n      minecraftVersion,\n      modLoader: 'fabric',\n      fabricLoaderVersion,\n      javaMajor: 21,\n    };`);
fs.writeFileSync(settingsPath,settings);

let service=read(servicePath);
req(service.includes('      timestamp: Date.now(),\n      files:'),'manifest marker missing');
service=service.replace('      timestamp: Date.now(),\n      files:', `      timestamp: Date.now(),\n      minecraft: {\n        version: this.settings.minecraftVersion,\n        loader: this.settings.modLoader,\n        loaderVersion: this.settings.fabricLoaderVersion,\n        javaMajor: this.settings.javaMajor,\n      },\n      files:`);
req(service.includes('      serverPort: this.settings.serverPort,\n    }, null, 2)'),'runtime config marker missing');
service=service.replace('      serverPort: this.settings.serverPort,\n    }, null, 2)', `      serverPort: this.settings.serverPort,\n      minecraftVersion: this.settings.minecraftVersion,\n      modLoader: this.settings.modLoader,\n      defaultFabricLoader: this.settings.fabricLoaderVersion,\n      javaMajor: this.settings.javaMajor,\n    }, null, 2)`);
fs.writeFileSync(servicePath,service);

let app=read(appPath);
req(app.includes("serverPort:25565 });"),'form defaults marker missing');
app=app.replace("serverPort:25565 });", "serverPort:25565, minecraftVersion:'1.21.1', modLoader:'fabric', fabricLoaderVersion:'0.18.4', javaMajor:21 });");
const uiMarker = '<Field label="DISCORD URL" className="mt-5"><input value={form.discordUrl}';
req(app.includes(uiMarker),'settings UI marker missing');
const runtimeUi = `<div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">\n          <div className="text-xs font-black text-zinc-300">RUNTIME PINNED THEO RELEASE</div>\n          <div className="mt-3 grid grid-cols-2 gap-3">\n            <Field label="MINECRAFT VERSION"><input value={form.minecraftVersion} onChange={e=>update('minecraftVersion',e.target.value)} placeholder="1.21.1" className="input" /></Field>\n            <Field label="MOD LOADER"><input value={form.modLoader} readOnly className="input opacity-70" /></Field>\n            <Field label="FABRIC LOADER"><input value={form.fabricLoaderVersion} onChange={e=>update('fabricLoaderVersion',e.target.value)} placeholder="0.18.4" className="input" /></Field>\n            <Field label="JAVA RUNTIME"><input value={form.javaMajor} readOnly className="input opacity-70" /></Field>\n          </div>\n          <div className="mt-2 text-[11px] leading-5 text-zinc-500">Minecraft và Fabric Loader được pin theo release. Java hiện khóa ở 21. Launcher dùng đúng version đã publish, không tự nâng Fabric lên latest.</div>\n        </div>\n        `;
app=app.replace(uiMarker, runtimeUi + uiMarker);
fs.writeFileSync(appPath,app);

const pkg=JSON.parse(fs.readFileSync(packagePath,'utf8')); pkg.version='6.0.4'; fs.writeFileSync(packagePath,JSON.stringify(pkg,null,2)+'\n');
console.log('Bestiary Pack Manager 6.0.4 runtime pin patch applied.');

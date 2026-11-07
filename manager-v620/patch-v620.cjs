const fs=require('node:fs');
const typesPath='manager/src/shared/types.ts';
const settingsPath='manager/src/main/services/SettingsService.ts';
const servicePath='manager/src/main/services/GithubDistributionService.ts';
const appPath='manager/src/renderer/src/App.tsx';
const packagePath='manager/package.json';
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const req=(ok,msg)=>{if(!ok)throw new Error(msg);};

let types=read(typesPath);
req(types.includes("fabricLoaderVersion:string; javaMajor:number; }"),'DistributionSettings runtime marker missing');
types=types.replace("fabricLoaderVersion:string; javaMajor:number; }","fabricLoaderVersion:string; javaMajor:number; microsoftClientId:string; }");
fs.writeFileSync(typesPath,types);

let settings=read(settingsPath);
req(settings.includes("  javaMajor: 21,\n};"),'Manager distribution default marker missing');
settings=settings.replace("  javaMajor: 21,\n};","  javaMajor: 21,\n  microsoftClientId: '',\n};");
const validation="    if (javaMajor !== 21) throw new Error('Bestiary hiện chỉ hỗ trợ Java Runtime 21.');";
req(settings.includes(validation),'Manager runtime validation marker missing');
settings=settings.replace(validation,validation+`\n    const microsoftClientId = String(distribution.microsoftClientId ?? '').trim();\n    if (microsoftClientId && !/^[0-9A-Fa-f-]{20,64}$/u.test(microsoftClientId)) {\n      throw new Error('Microsoft Client ID không hợp lệ. Chỉ nhập Application (client) ID của Entra public client app, không nhập client secret.');\n    }`);
const normalized="      javaMajor: 21,\n    };";
req(settings.includes(normalized),'Manager normalized distribution marker missing');
settings=settings.replace(normalized,"      javaMajor: 21,\n      microsoftClientId,\n    };");
fs.writeFileSync(settingsPath,settings);

let service=read(servicePath);
const configMarker=`      minecraftVersion: this.settings.minecraftVersion,\n      modLoader: this.settings.modLoader,\n      defaultFabricLoader: this.settings.fabricLoaderVersion,\n      javaMajor: this.settings.javaMajor,\n    }, null, 2)`;
req(service.includes(configMarker),'Launcher config publish marker missing');
service=service.replace(configMarker,`      minecraftVersion: this.settings.minecraftVersion,\n      modLoader: this.settings.modLoader,\n      defaultFabricLoader: this.settings.fabricLoaderVersion,\n      javaMajor: this.settings.javaMajor,\n      microsoftClientId: this.settings.microsoftClientId.trim(),\n    }, null, 2)`);
fs.writeFileSync(servicePath,service);

let app=read(appPath);
app=app.replace('Release Console 6.1.0','Release Console 6.2.0').replace('Release Console 6.0.6','Release Console 6.2.0');
const javaField='<Field label="JAVA"><input className="input opacity-60" readOnly value={form.javaMajor}/></Field>';
req(app.includes(javaField),'Manager Runtime Java UI marker missing');
app=app.replace(javaField,javaField+`<div className="col-span-2"><Field label="MICROSOFT CLIENT ID"><input className="input" value={form.microsoftClientId||''} onChange={e=>update('microsoftClientId',e.target.value.trim())} placeholder="Application (client) ID · để trống để tắt Microsoft Login"/></Field><div className="mt-2 text-[9px] leading-4 text-zinc-600">Đây là public Application (client) ID của Microsoft Entra. Không nhập client secret. Launcher dùng Device Code Flow và không lưu mật khẩu Microsoft.</div></div>`);
fs.writeFileSync(appPath,app);

const pkg=JSON.parse(fs.readFileSync(packagePath,'utf8'));
pkg.version='6.2.0';
pkg.author='SVFrame Team Studio';
fs.writeFileSync(packagePath,JSON.stringify(pkg,null,2)+'\n');
console.log('Bestiary Pack Manager 6.2.0 Microsoft public-client configuration patch applied.');

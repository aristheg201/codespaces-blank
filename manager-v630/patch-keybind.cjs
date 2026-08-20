const fs = require('node:fs');
const req = (ok, msg) => { if (!ok) throw new Error(msg); };

{
  const p='manager/src/shared/types.ts';
  let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
  const marker="export type AndroidCompatibility = 'auto' | 'compatible' | 'blocked';";
  req(s.includes(marker),'types marker missing');
  if(!s.includes('export interface KeybindRule')) s=s.replace(marker, marker+"\nexport type KeybindMode = 'default' | 'locked';\nexport interface KeybindRule { id:string; label:string; key:string; mode:KeybindMode; enabled:boolean; }\nexport interface KeybindPolicy { schema:1; rules:KeybindRule[]; updatedAt:number; }");
  const api="  redetectMod(path?:string): Promise<WorkspaceSnapshot>;";
  req(s.includes(api),'ManagerApi redetect marker missing');
  if(!s.includes('getKeybindPolicy()')) s=s.replace(api, api+"\n  getKeybindPolicy(): Promise<KeybindPolicy>;\n  saveKeybindPolicy(policy:KeybindPolicy): Promise<KeybindPolicy>;\n  importKeybindsFromOptions(): Promise<KeybindPolicy>;");
  fs.writeFileSync(p,s);
}

{
  const p='manager/src/preload/index.ts';
  let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
  s=s.replace('ManagerApi, ModPolicy, ProgressState, PublishRequest', 'KeybindPolicy, ManagerApi, ModPolicy, ProgressState, PublishRequest');
  const marker="  redetectMod: (relativePath?: string) => ipcRenderer.invoke('mod-audit:redetect', relativePath),";
  req(s.includes(marker),'preload redetect marker missing');
  if(!s.includes("keybind:get")) s=s.replace(marker, marker+"\n  getKeybindPolicy: () => ipcRenderer.invoke('keybind:get'),\n  saveKeybindPolicy: (policy: KeybindPolicy) => ipcRenderer.invoke('keybind:save', policy),\n  importKeybindsFromOptions: () => ipcRenderer.invoke('keybind:import-options'),");
  fs.writeFileSync(p,s);
}

{
  const p='manager/src/main/index.ts';
  let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
  if(!s.includes("KeybindPolicyService")) {
    const importMarker="import { GithubDistributionService } from './services/GithubDistributionService';";
    req(s.includes(importMarker),'main distribution import marker missing');
    s=s.replace(importMarker, importMarker+"\nimport { KeybindPolicyService } from './services/KeybindPolicyService';");
  }
  if(!s.includes('let keybindPolicyService: KeybindPolicyService;')) {
    const marker='let distributionService: GithubDistributionService;';
    req(s.includes(marker),'main singleton marker missing');
    s=s.replace(marker, marker+'\nlet keybindPolicyService: KeybindPolicyService;');
  }
  const ipcMarker="  ipcMain.handle('mod-audit:redetect', (_event, relativePath?: string) => workspaceService.redetectMod(relativePath));";
  req(s.includes(ipcMarker),'main mod audit IPC marker missing');
  if(!s.includes("ipcMain.handle('keybind:get'")) s=s.replace(ipcMarker, ipcMarker+"\n  ipcMain.handle('keybind:get', () => keybindPolicyService.load(workspaceService.getRoot()));\n  ipcMain.handle('keybind:save', async (_event, policy) => { const result=await keybindPolicyService.save(workspaceService.getRoot(), policy); await workspaceService.rescan(); return result; });\n  ipcMain.handle('keybind:import-options', async () => { const result=await keybindPolicyService.importOptions(workspaceService.getRoot()); await workspaceService.rescan(); return result; });");
  const initMarker="distributionService = new GithubDistributionService(app.getPath('userData'), settings.distribution, sendProgress);";
  req(s.includes(initMarker),'main distribution init marker missing');
  if(!s.includes('keybindPolicyService = new KeybindPolicyService();')) s=s.replace(initMarker, initMarker+'\n  keybindPolicyService = new KeybindPolicyService();');
  fs.writeFileSync(p,s);
}

{
  const p='manager/src/renderer/src/store.ts';
  let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
  req(s.includes("type View = 'client' | 'release' | 'settings';"),'store view marker missing');
  s=s.replace("type View = 'client' | 'release' | 'settings';", "type View = 'client' | 'keybind' | 'release' | 'settings';");
  fs.writeFileSync(p,s);
}

{
  const p='manager/src/renderer/src/App.tsx';
  let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
  s=s.replace('  ImportStatus,\n', '  ImportStatus,\n  KeybindPolicy,\n  KeybindRule,\n');
  const navOld="const nav=[['client','01','MOD DEPLOYMENT','Side, profile & audit'],['release','02','PHÁT HÀNH','Manifest & channel'],['settings','03','CẤU HÌNH','Server & runtime']] as const;";
  req(s.includes(navOld),'sidebar nav marker missing');
  s=s.replace(navOld,"const nav=[['client','01','MOD DEPLOYMENT','Side, profile & audit'],['keybind','02','KEYBINDS','Phím mặc định & khóa'],['release','03','PHÁT HÀNH','Manifest & channel'],['settings','04','CẤU HÌNH','Server & runtime']] as const;");
  const releaseMarker='function Release(){';
  req(s.includes(releaseMarker),'Release marker missing');
  if(!s.includes('function KeybindManager(){')) {
    const component=fs.readFileSync('manager-v630/KeybindManager.fragment','utf8').replace(/\r\n/g,'\n');
    req(component.includes('function KeybindManager(){'),'keybind UI fragment invalid');
    s=s.replace(releaseMarker,component+releaseMarker);
  }
  const profileLine="const profilesByPath:Record<string,DistributionProfileId[]>=Object.fromEntries(snapshot.files.map(f=>[f.path,f.area==='mods'?policyOf(f).profiles:['full','lite']]));";
  req(s.includes(profileLine),'release profiles line missing');
  s=s.replace(profileLine,"const profilesByPath:Record<string,DistributionProfileId[]>=Object.fromEntries(snapshot.files.map(f=>[f.path,f.area==='mods'?policyOf(f).profiles:(f.path==='config/bestiary-keybinds.json'?['full','lite','android']:['full','lite'])]));");
  const rootSwitch="{view==='client'?<Client/>:view==='release'?<Release/>:<Settings/>}";
  req(s.includes(rootSwitch),'root view switch missing');
  s=s.replace(rootSwitch,"{view==='client'?<Client/>:view==='keybind'?<KeybindManager/>:view==='release'?<Release/>:<Settings/>}");
  fs.writeFileSync(p,s);
}

{
  const p='manager/src/main/services/GithubDistributionService.ts';
  let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
  const old="const profiles = requestedProfiles.length > 0 ? requestedProfiles : (isModJar ? [] : ['full', 'lite'] as Array<'full' | 'lite' | 'android' | 'server'>);";
  req(s.includes(old),'distribution profile fallback marker missing');
  s=s.replace(old,"const profiles = requestedProfiles.length > 0 ? requestedProfiles : (isModJar ? [] : (file.path === 'config/bestiary-keybinds.json' ? ['full','lite','android'] : ['full', 'lite']) as Array<'full' | 'lite' | 'android' | 'server'>);");
  fs.writeFileSync(p,s);
}

console.log('Manager 6.3 keybind policy/editor/publish integration patched.');

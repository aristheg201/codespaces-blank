const fs=require('node:fs');
const req=(ok,msg)=>{if(!ok)throw new Error(msg)};

{
 const p='manager/src/shared/types.ts';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
 s=s.replace('export interface KeybindPolicy { schema:1; rules:KeybindRule[]; updatedAt:number; }','export interface KeybindPolicy { schema:1; rules:KeybindRule[]; updatedAt:number; sourcePath?:string; sourceAvailable?:boolean; }');
 s=s.replace('  importKeybindsFromOptions(): Promise<KeybindPolicy>;','  chooseOptionsFile(): Promise<string|null>;\n  importKeybindsFromOptions(sourcePath?:string): Promise<KeybindPolicy>;');
 req(s.includes('chooseOptionsFile()'),'Keybind API type patch failed');fs.writeFileSync(p,s);
}
{
 const p='manager/src/preload/index.ts';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
 s=s.replace("  importKeybindsFromOptions: () => ipcRenderer.invoke('keybind:import-options'),","  chooseOptionsFile: () => ipcRenderer.invoke('keybind:choose-options'),\n  importKeybindsFromOptions: (sourcePath?: string) => ipcRenderer.invoke('keybind:import-options', sourcePath),");
 req(s.includes("keybind:choose-options"),'preload options picker patch failed');fs.writeFileSync(p,s);
}
{
 const p='manager/src/main/index.ts';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
 const old="  ipcMain.handle('keybind:import-options', async () => { const result=await keybindPolicyService.importOptions(workspaceService.getRoot()); await workspaceService.rescan(); return result; });";
 req(s.includes(old),'keybind import IPC marker missing');
 const next=`  ipcMain.handle('keybind:choose-options', async () => {\n    const result=await dialog.showOpenDialog(mainWindow!, { properties:['openFile'], filters:[{name:'Minecraft options.txt',extensions:['txt']}], title:'Chọn options.txt của Minecraft instance cần lấy keybind' });\n    return result.canceled||!result.filePaths[0]?null:result.filePaths[0];\n  });\n  ipcMain.handle('keybind:import-options', async (_event, sourcePath?: string) => { const result=await keybindPolicyService.importOptions(workspaceService.getRoot(), sourcePath); await workspaceService.rescan(); return result; });`;
 s=s.replace(old,next);fs.writeFileSync(p,s);
}
{
 const p='manager/src/renderer/src/App.tsx';let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
 const a=s.indexOf('function minecraftKeyFromCode(');const b=s.indexOf('function Release(){');req(a>=0&&b>a,'Keybind component boundaries missing');
 const fragment=fs.readFileSync('manager-v632/KeybindManager.fragment','utf8').replace(/\r\n/g,'\n');
 s=s.slice(0,a)+fragment+s.slice(b);
 s=s.replace('Release Console 6.3.0','Release Console 6.3.2');
 fs.writeFileSync(p,s);
}
console.log('Manager 6.3.2 external options.txt source wiring applied.');

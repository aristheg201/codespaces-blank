const fs = require('fs');

function replace(path, from, to) {
  const input = fs.readFileSync(path, 'utf8');
  if (!input.includes(from)) throw new Error(`Patch target not found in ${path}`);
  fs.writeFileSync(path, input.replace(from, to), 'utf8');
}

replace(
  'manager/src/main/services/utils.ts',
  "return { path: file.relativePath, hash, size: file.size, modifiedAt: file.modifiedAt, area: file.area, mod } satisfies ManagedFile;",
  "return { path: file.relativePath, hash, size: file.size, modifiedAt: file.modifiedAt, area: file.area, mod, profiles: ['full', 'lite'] } satisfies ManagedFile;",
);

replace(
  'manager/src/renderer/src/App.tsx',
  "const text=(k:keyof DistributionSettings,v:string)=>setForm(p=>({...p,[k]:v})); const number=(k:keyof DistributionSettings,v:string)=>setForm(p=>({...p,[k]:Number(v)||0}));",
  "type TextSettingKey = 'repository'|'discordUrl'|'announcementTitle'|'announcementBody'|'serverName'|'serverHost'|'minecraftVersion'|'fabricLoader'; type NumberSettingKey = 'serverPort'|'fullRecommendedSystemRamMb'|'fullRecommendedGameRamMb'|'liteRecommendedSystemRamMb'|'liteRecommendedGameRamMb'; const text=(k:TextSettingKey,v:string)=>setForm(p=>({...p,[k]:v})); const number=(k:NumberSettingKey,v:string)=>setForm(p=>({...p,[k]:Number(v)||0}));",
);

console.log('Bestiary Manager v7 source patches applied.');

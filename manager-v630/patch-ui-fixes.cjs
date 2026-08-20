const fs = require('node:fs');
const p = 'manager/src/renderer/src/App.tsx';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const req = (ok, msg) => { if (!ok) throw new Error(msg); };

s = s.replace('Public Application ID בלבד. Không nhập client secret.', 'Chỉ dùng public Application ID. Không nhập client secret.');

const stageProfiles = '<ProfileChips value={change.policy?.profiles||change.suggestedProfiles} onChange={()=>{}} compact/>';
req(s.includes(stageProfiles), 'staging profile display marker missing');
s = s.replace(stageProfiles, '<div className="pointer-events-none opacity-75"><ProfileChips value={change.policy?.profiles||change.suggestedProfiles} onChange={()=>{}} compact/></div>');

const oldMigration = ` useEffect(()=>{if(!snapshot.root)return;try{const legacy=JSON.parse(localStorage.getItem(\`bestiary.profile-map.v3:\${snapshot.root}\`)||'{}') as Record<string,DistributionProfileId[]>;for(const file of snapshot.files){const profiles=cleanProfiles(legacy[file.path]);if(profiles.length&&file.policy&&!file.policy.reviewed&&file.policy.profiles.length===0)void useManager.getState().setModPolicy(file.path,{profiles});}}catch{/* legacy profile map is optional */}},[snapshot.root]);`;
req(s.includes(oldMigration), 'legacy profile migration marker missing');
const newMigration = ` useEffect(()=>{if(!snapshot.root)return;const marker=\`bestiary.profile-policy-migrated.v630:\${snapshot.root}\`;if(localStorage.getItem(marker)==='1')return;void (async()=>{try{const legacy=JSON.parse(localStorage.getItem(\`bestiary.profile-map.v3:\${snapshot.root}\`)||'{}') as Record<string,DistributionProfileId[]>;for(const file of useManager.getState().snapshot.files){const profiles=cleanProfiles(legacy[file.path]);if(profiles.length)await useManager.getState().setModPolicy(file.path,{profiles});}localStorage.setItem(marker,'1');}catch{/* legacy map is optional; leave marker unset so a later start can retry */}})();},[snapshot.root]);`;
s = s.replace(oldMigration, newMigration);

req(!s.includes('בלבד'), 'non-Vietnamese UI text survived');
req(s.includes('profile-policy-migrated.v630'), 'legacy profile migration contract missing');
fs.writeFileSync(p, s);
console.log('Manager 6.3 UI polish and profile migration patched.');

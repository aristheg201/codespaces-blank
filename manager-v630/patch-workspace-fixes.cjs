const fs = require('node:fs');
const p = 'manager/src/main/services/WorkspaceService.ts';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const oldCall = `await this.pushStagedJar(sourcePath, stat.size, hash, mod, current, policy.profiles, undefined, undefined, path.basename(sourcePath), undefined, detection, policy);`;
if (!s.includes(oldCall)) throw new Error('stageJarFiles pushStagedJar marker missing');
s = s.replace(oldCall, `await this.pushStagedJar(sourcePath, stat.size, hash, mod, current, policy.profiles, undefined, undefined, undefined, detection, policy);`);
fs.writeFileSync(p, s);
console.log('Manager 6.3 staged JAR target arguments fixed.');

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const AdmZip = require(path.resolve(__dirname, '../source/node_modules/adm-zip'));

function compiled(file) {
  const root = path.resolve(__dirname, '../source');
  for (const folder of ['dist-main', 'dist', 'out', 'build']) {
    for (const prefix of ['main/core', 'core']) {
      const candidate = path.join(root, folder, prefix, file);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw Error('Compiled production module missing: ' + file);
}
const { ModpackManager } = require(compiled('ModpackManager.js'));
const { KeybindPolicyService } = require(compiled('KeybindPolicyService.js'));

function makeJar(file, metadata) {
  const archive = new AdmZip();
  archive.addFile('fabric.mod.json', Buffer.from(JSON.stringify(metadata)));
  archive.writeZip(file);
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bestiary-561-local-only-'));
  try {
    const official = path.join(root, 'official');
    fs.mkdirSync(path.join(official, 'config'), {recursive:true});
    const officialOpts = path.join(official, 'options.txt');
    const before = 'version:3955\nkey_key.inventory:key.keyboard.e\n';
    fs.writeFileSync(officialOpts, before);
    fs.writeFileSync(path.join(official, 'config', 'bestiary-keybinds.json'),
      JSON.stringify({schema:1,rules:[]}));
    const manager = new ModpackManager(root);
    const a = await manager.create('Manual Mods A');
    const b = await manager.create('Manual Mods B');
    const directory = manager.instanceDirectory(a.id);
    const modA = path.join(root, 'hello.jar');
    makeJar(modA, {schemaVersion:1,id:'localexample',name:'Local Example',version:'1.0.0'});
    const added = await manager.installFiles(a.id,[modA]);
    assert.equal(added.imported.length, 1, 'local .jar must install without a mod distribution API');
    assert.equal(added.imported[0].kind, 'mods');
    assert.equal(added.snapshot.mods[0].modId, 'localexample');
    assert(fs.existsSync(path.join(directory, 'mods','hello.jar')));
    assert.equal((await manager.snapshot(b.id)).mods.length,0,'other instance must be unchanged');
    let second = await manager.installFiles(a.id,[modA]);
    assert.equal(second.imported.length,0);
    assert.equal(second.skipped.length,1,'duplicate local file must be reported');
    const modB = path.join(root,'hello-2.jar');
    makeJar(modB,{schemaVersion:1,id:'localexample',name:'Local Example',version:'2.0.0'});
    const updated = await manager.installFiles(a.id,[modB]);
    assert.equal(updated.imported.length,1,'local updated JAR replaces personal same mod ID');
    const snap = await manager.snapshot(a.id);
    assert.equal(snap.mods.length,1);
    assert.equal(snap.mods[0].version,'2.0.0');
    assert(!fs.existsSync(path.join(directory,'mods','hello.jar')));
    assert.equal((await manager.snapshot(b.id)).mods.length,0);

    // Wrong loader must not install an unrelated JAR.
    const wrong = path.join(root,'wrong.jar');
    const arch = new AdmZip();
    arch.addFile('META-INF/mods.toml', Buffer.from('[[mods]]\nmodId="forge"\n'));
    arch.writeZip(wrong);
    const mismatch = await manager.installFiles(a.id,[wrong]);
    assert.equal(mismatch.imported.length,0);
    assert.equal(mismatch.skipped.length,1);
    assert(!fs.existsSync(path.join(directory,'mods','wrong.jar')));

    const rp = path.join(root,'resources.zip');
    const pack = new AdmZip();
    pack.addFile('pack.mcmeta',Buffer.from('{"pack":{"pack_format":34,"description":"QA"}}'));
    pack.addFile('assets/qa/test.txt',Buffer.from('ok'));
    pack.writeZip(rp);
    const content = await manager.installFiles(a.id,[rp]);
    assert.equal(content.imported[0].kind,'resourcepacks');
    assert(fs.existsSync(path.join(directory,'resourcepacks','resources.zip')));
    const options = path.join(directory,'options.txt');
    fs.writeFileSync(options,'version:3955\nkey_key.forward:key.keyboard.j\n');
    await new KeybindPolicyService(official).apply();
    assert.equal(fs.readFileSync(options,'utf8'),'version:3955\nkey_key.forward:key.keyboard.j\n');
    assert.equal(fs.readFileSync(officialOpts,'utf8'),before);
    // No spontaneous pack assets, remote project records or download cache.
    for (const extra of ['curseforge','downloads','.managed-ownership.json']) {
      assert(!fs.existsSync(path.join(directory,extra)));
    }

    const src = fs.readFileSync(path.join(__dirname,'../source/src/main/index.ts'),'utf8');
    assert(src.includes('accountService.getLaunchAuthorization(settings.username)'));
    assert(src.includes('accountService.shouldUseOfficialLauncher()'));
    const preload = fs.readFileSync(path.join(__dirname,'../source/src/preload/index.ts'),'utf8');
    for(const key of ['getAccounts:', 'setAccountMode:', 'loginMicrosoft:', 'logoutMicrosoft:', 'getPathForFile:']){
      assert(preload.includes(key),'Auth/preload regression: '+key);
    }
    const ui = fs.readFileSync(path.join(__dirname,
      '../source/src/renderer/src/components/ModpacksScreen.tsx'),'utf8');
    assert(ui.includes('onDrop={onModDrop}'));
    assert(ui.includes('getPathForFile(file)'));
    assert(ui.includes('installModpackFiles(packId, paths)'));
    assert(!ui.includes('CurseForge API; launcher'));
    console.log('QA PASS: manual local JAR/ZIP install, update, duplicate, loader validation and modpack isolation; login/offline contracts unchanged');
  } finally {
    await fs.promises.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:150});
  }
})().catch(error=>{console.error('QA FAIL: local-only mod import:', error);process.exitCode=1;});

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function compiled(file) {
  const base = path.resolve(__dirname, '../source');
  for (const dir of ['dist-main', 'dist', 'out', 'build']) {
    for (const suffix of ['main/core', 'core']) {
      const p = path.join(base, dir, suffix, file);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('Cannot locate compiled runtime service: ' + file);
}
const { PersonalInstanceRuntimeService, knownJavaMajor,
  normalizePersonalRuntimeSettings } = require(compiled('PersonalInstanceRuntimeService.js'));
const { ModpackManager } = require(compiled('ModpackManager.js'));

function createLocalVersion(gameRoot, version, javaMajor) {
  const folder = path.join(gameRoot, 'versions', version);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, version + '.json'), JSON.stringify({
    id: version, javaVersion: { majorVersion: javaMajor },
  }));
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bestiary-v560-runtime-'));
  try {
    const officialOptions = path.join(root, 'official', 'options.txt');
    fs.mkdirSync(path.dirname(officialOptions), { recursive: true });
    fs.writeFileSync(officialOptions, 'version:3955\nkey_key.forward:key.keyboard.up\n');
    const manager = new ModpackManager(root);
    const first = await manager.create('Isolated Modpack A');
    const second = await manager.create('Isolated Modpack B');
    const firstDir = manager.instanceDirectory(first.id);
    const secondDir = manager.instanceDirectory(second.id);
    createLocalVersion(firstDir, '1.21.1', 21);
    createLocalVersion(secondDir, '1.21.1', 21);
    const firstOptions = path.join(firstDir, 'options.txt');
    fs.writeFileSync(firstOptions, 'version:3955\nkey_key.forward:key.keyboard.j\n');
    const a = new PersonalInstanceRuntimeService(firstDir);
    const b = new PersonalInstanceRuntimeService(secondDir);
    const defaults = await a.snapshot();
    assert.deepEqual(defaults, { schema: 1, javaMajor: null,
      minRamMb: null, maxRamMb: null });
    const global = { minRamMb: 2048, maxRamMb: 8192,
      generatedJvmArgs: ['-Dbestiary.jvm.profile=551', '-XX:+UseG1GC'] };
    const plan4 = await a.prepare(first, global, 4096);
    assert.equal(plan4.javaMajor, 21);
    assert.equal(plan4.javaSource, 'instance');
    assert(plan4.memory.maxMb <= 2560);
    assert.deepEqual(plan4.jvmArgs, [], 'personal JVM must not inherit Official settings');
    assert.equal(plan4.gameDirectory, firstDir);
    assert.equal(plan4.constrained, true);
    assert.equal(await fs.promises.readFile(officialOptions, 'utf8'),
      'version:3955\nkey_key.forward:key.keyboard.up\n');
    assert.equal(fs.readFileSync(firstOptions, 'utf8'),
      'version:3955\nkey_key.forward:key.keyboard.j\n');
    await a.save({ schema: 1, javaMajor: 21, minRamMb: 1024, maxRamMb: 3072 });
    const customized = await a.prepare(first, global, 8192);
    assert.equal(customized.javaMajor, 21);
    assert.equal(customized.javaSource, 'override');
    assert.equal(customized.memory.maxMb, 3072);
    assert.equal(customized.memory.minMb, 1024);
    assert.equal((await b.snapshot()).maxRamMb, null,
      'another modpack must never inherit A runtime settings');
    await assert.rejects(a.save({schema:1,javaMajor:25,minRamMb:3000,maxRamMb:2000}),
      /RAM/u);
    await assert.rejects(a.save({schema:1,javaMajor:21,minRamMb:-1,maxRamMb:8192}),
      /RAM/u);
    await assert.rejects(a.save({schema:1,javaMajor:99,minRamMb:null,maxRamMb:null}),
      /Java/u);
    await a.save({schema:1,javaMajor:17,minRamMb:null,maxRamMb:null});
    await assert.rejects(a.prepare(first, global, 8192), /không tương thích/u);
    assert.equal(knownJavaMajor('1.16.5'), 8);
    assert.equal(knownJavaMajor('1.18.2'), 17);
    assert.equal(knownJavaMajor('1.20.5'), 21);
    assert.equal(knownJavaMajor('1.21.1'), 21);
    assert.throws(() => knownJavaMajor('../escape'), /không hợp lệ/u);
    assert.throws(() => normalizePersonalRuntimeSettings({schema:1}), /Java\/RAM/u);
    await a.save(defaults);
    const untouched = fs.readFileSync(firstOptions, 'utf8');
    assert.equal(untouched, 'version:3955\nkey_key.forward:key.keyboard.j\n');
    assert.equal(fs.readFileSync(officialOptions, 'utf8'),
      'version:3955\nkey_key.forward:key.keyboard.up\n');

    const main = fs.readFileSync(path.join(__dirname,'../source/src/main/index.ts'),'utf8');
    const start = main.indexOf('async function startPersonalModpack(');
    const end = main.indexOf('async function accountSnapshot() {',start);
    assert(start >= 0 && end > start);
    const personal = main.slice(start,end);
    for (const forbidden of [
      'keybindPolicyService', 'officialLowEndOptionsService',
      'settings.generatedJvmArgs','bestiary-keybinds.json'
    ]) assert(!personal.includes(forbidden), 'Personal launch leaked Official: '+forbidden);
    assert(personal.includes('personalRuntime.javaMajor'));
    assert(personal.includes('memory: personalRuntime.memory'));
    assert(personal.includes('personalRuntime.jvmArgs'));
    assert(main.includes('bestiary:modpacks-runtime-get'));
    assert(main.includes('bestiary:modpacks-runtime-save'));
    console.log('QA PASS: Prism-style per-instance runtime plan, Mojang Java metadata, RAM caps, independent settings, Official keybind isolation');
  } finally {
    await fs.promises.rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
})().catch(e=>{ console.error('QA FAIL: per-instance runtime',e);process.exitCode=1;});

'use strict';

// Functional regression suite for SVFrame Official keybind distribution,
// low-end hardware profiles and strict My Modpacks isolation.
// Uses the compiled production services; it is not a mocked implementation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function findCompiled(filename) {
  const root = path.resolve(__dirname, '../source');
  for (const folder of ['dist-main', 'dist', 'out', 'build', 'dist-electron']) {
    for (const prefix of ['main/core', 'core', 'src/main/core']) {
      const candidate = path.join(root, folder, prefix, filename);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  throw new Error('Compiled production module missing: ' + filename);
}
const { KeybindPolicyService } = require(findCompiled('KeybindPolicyService.js'));
const { KeybindSettingsService } = require(findCompiled('KeybindSettingsService.js'));
const { OfficialLowEndOptionsService, detectLowEndTier } = require(findCompiled('OfficialLowEndOptionsService.js'));
const { generateJvmProfileForHardware } = require(findCompiled('JvmProfileGenerator.js'));
const { planPersonalMemory } = require(findCompiled('PersonalMemory.js'));
const { ModpackManager } = require(findCompiled('ModpackManager.js'));

function parseOptions(filename) {
  const map = new Map();
  for (const line of fs.readFileSync(filename, 'utf8').replace(/\r\n/g, '\n').split('\n')) {
    const at = line.indexOf(':');
    if (at > 0) map.set(line.slice(0, at), line.slice(at + 1));
  }
  return map;
}
function updateOption(filename, id, newValue) {
  const text = fs.readFileSync(filename, 'utf8');
  const next = text.split(/\r?\n/).map((line) => line.startsWith(id + ':') ? id + ':' + newValue : line).join('\r\n');
  fs.writeFileSync(filename, next, 'utf8');
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'svframe-550-quality-'));
  try {
    const official = path.join(root, 'official');
    fs.mkdirSync(path.join(official, 'config'), { recursive: true });
    const options = path.join(official, 'options.txt');
    const before = [
      'version:3700', 'gamma:0.75', 'masterVolume:0.4',
      'resourcePacks:["vanilla","file/custom.zip"]',
      'renderDistance:12', 'simulationDistance:12', 'particles:0',
      'key_key.forward:key.keyboard.w',
      'key_key.jump:key.keyboard.space',
      'key_key.inventory:key.keyboard.e',
      'modSpecificOption:keep-me',
    ].join('\r\n');
    fs.writeFileSync(options, before, 'utf8');
    const policyFile = path.join(official, 'config', 'bestiary-keybinds.json');
    const rules = [
      { id: 'key_key.forward', key: 'key.keyboard.up', mode: 'default', enabled: true },
      { id: 'key_key.jump', key: 'key.keyboard.space', mode: 'default', enabled: true },
      { id: 'key_key.inventory', key: 'key.keyboard.i', mode: 'locked', enabled: true },
      { id: 'key_mod.phone', key: 'key.keyboard.p', mode: 'default', enabled: true },
    ];
    const writePolicy = () => fs.writeFileSync(policyFile, JSON.stringify({ schema: 1, rules }));
    writePolicy();
    const distribution = new KeybindPolicyService(official);

    const first = await distribution.apply();
    assert.equal(first.changed, 3, 'first Manager import must affect populated vanilla options.txt');
    let values = parseOptions(options);
    assert.equal(values.get('key_key.forward'), 'key.keyboard.up');
    assert.equal(values.get('key_key.inventory'), 'key.keyboard.i');
    assert.equal(values.get('key_mod.phone'), 'key.keyboard.p');
    assert.equal(values.get('gamma'), '0.75', 'unrelated graphics not overwritten by keybind policy');
    assert.equal(values.get('masterVolume'), '0.4');
    assert.equal(values.get('resourcePacks'), '["vanilla","file/custom.zip"]');
    assert(fs.readFileSync(options, 'utf8').includes('\r\n'), 'CRLF file format retained');
    assert(fs.existsSync(path.join(official, '.bestiary', 'options-before-managed-keybinds.bak')));
    assert.equal(fs.readFileSync(path.join(official, '.bestiary', 'options-before-managed-keybinds.bak'), 'utf8'), before);

    // Player can edit DEFAULT after first server distribution, but not LOCKED.
    const editor = new KeybindSettingsService(official);
    const snapshot = await editor.snapshot();
    assert(snapshot.entries.some((item) => item.id === 'key_key.forward' && !item.locked));
    assert(snapshot.entries.some((item) => item.id === 'key_key.inventory' && item.locked));
    await editor.save([{ id: 'key_key.forward', key: 'key.keyboard.j' }]);
    await assert.rejects(
      editor.save([{ id: 'key_key.inventory', key: 'key.keyboard.o' }]),
      /khóa/u, 'locked keybind must reject edits in launcher UI',
    );
    updateOption(options, 'key_key.inventory', 'key.keyboard.o');
    const second = await distribution.apply();
    assert.equal(second.changed, 1, 'only LOCKED binding should be restored');
    assert.equal(second.skipped, 1, 'customized DEFAULT must be respected');
    values = parseOptions(options);
    assert.equal(values.get('key_key.forward'), 'key.keyboard.j');
    assert.equal(values.get('key_key.inventory'), 'key.keyboard.i');

    // Manager publishes a new DEFAULT later: do not silently overwrite rebinding.
    rules[0].key = 'key.keyboard.k';
    writePolicy();
    await distribution.apply();
    values = parseOptions(options);
    assert.equal(values.get('key_key.forward'), 'key.keyboard.j');

    // Unchanged auto-managed DEFAULT must follow a later Manager update.
    rules[3].key = 'key.keyboard.o';
    writePolicy();
    const next = await distribution.apply();
    assert.equal(next.changed, 1);
    assert.equal(parseOptions(options).get('key_mod.phone'), 'key.keyboard.o');

    const personalManager = new ModpackManager(root);
    const personalPack = await personalManager.create('Personal QA Modpack');
    const personal = personalManager.instanceDirectory(personalPack.id);
    const personalOptions = path.join(personal, 'options.txt');
    const personalOriginal = 'key_key.forward:key.keyboard.h\nkey_key.inventory:key.keyboard.q\nrenderDistance:16\n';
    fs.writeFileSync(personalOptions, personalOriginal);
    await distribution.apply();
    assert.equal(fs.readFileSync(personalOptions, 'utf8'), personalOriginal);
    assert(!fs.existsSync(path.join(personal, '.bestiary', 'keybind-state.json')));
    console.log('QA PASS: Manager -> SVFrame Official options.txt -> player default/locked semantics; personal untouched');

    // Lite-only graphics on constrained devices. Never apply to Full or My Modpacks.
    assert.equal(detectLowEndTier('lite', { systemRamMb: 4096, cpuThreads: 4 }), 'low');
    assert.equal(detectLowEndTier('lite', { systemRamMb: 8192, cpuThreads: 6 }), 'entry');
    assert.equal(detectLowEndTier('full', { systemRamMb: 4096, cpuThreads: 2 }), 'none');
    const performance = new OfficialLowEndOptionsService(official);
    const perf = await performance.apply('lite', { systemRamMb: 4096, cpuThreads: 4 });
    assert.equal(perf.tier, 'low');
    values = parseOptions(options);
    assert.equal(values.get('renderDistance'), '6');
    assert.equal(values.get('simulationDistance'), '5');
    assert.equal(values.get('particles'), '2');
    assert.equal(values.get('resourcePacks'), '["vanilla","file/custom.zip"]');
    assert.equal(values.get('masterVolume'), '0.4');
    updateOption(options, 'renderDistance', '10');
    const perfAgain = await performance.apply('lite', { systemRamMb: 4096, cpuThreads: 4 });
    assert.equal(perfAgain.preserved, 1);
    assert.equal(parseOptions(options).get('renderDistance'), '10');
    const preFull = fs.readFileSync(options, 'utf8');
    await performance.apply('full', { systemRamMb: 4096, cpuThreads: 4 });
    assert.equal(fs.readFileSync(options, 'utf8'), preFull);
    assert.equal(fs.readFileSync(personalOptions, 'utf8'), personalOriginal);
    console.log('QA PASS: low-end Lite options are applied only to SVFrame Official and preserve user overrides');

    // Real generator budget, including old 8 GiB personal default on 4 GiB PCs.
    const fakeRelease = { profiles: [
      { id: 'full', minimumRamMb: 6144, recommendedRamMb: 8192 },
      { id: 'lite', minimumRamMb: 3072, recommendedRamMb: 4096 },
    ] };
    const settings = {
      clientProfile: 'lite', performancePreset: 'performance',
      customJvmArgs: '', minRamMb: 2048, maxRamMb: 8192,
    };
    const lite4 = generateJvmProfileForHardware(settings, fakeRelease, { systemRamMb: 4096, cpuThreads: 4 });
    assert(lite4.recommendedMaxRamMb <= 2560 && lite4.recommendedMaxRamMb >= 1536);
    assert.equal(lite4.belowProfileMinimum, true, '4 GiB cannot honestly meet published 3 GiB Lite requirement');
    assert(lite4.args.includes('-Dbestiary.jvm.profile=551'));
    assert(!lite4.args.some((arg) => /UnlockExperimentalVMOptions|AlwaysPreTouch|G1NewSizePercent/iu.test(arg)));
    const lite8 = generateJvmProfileForHardware(settings, fakeRelease, { systemRamMb: 8192, cpuThreads: 8 });
    assert(lite8.recommendedMaxRamMb <= 4096 && lite8.recommendedMaxRamMb > lite4.recommendedMaxRamMb);
    for (const physical of [3072, 4096, 6144, 8192, 16384, 32768]) {
      const mem = planPersonalMemory(settings, physical);
      assert(mem.maxMb >= mem.minMb && mem.minMb >= 512);
      assert(mem.maxMb <= physical, 'personal JVM heap must never exceed physical RAM');
      if (physical === 4096) {
        assert(mem.maxMb <= 2560);
        assert.equal(mem.constrained, true);
      }
    }

    const main = fs.readFileSync(path.join(__dirname, '../source/src/main/index.ts'), 'utf8');
    const start = main.indexOf('async function startPersonalModpack(');
    const end = main.indexOf('async function accountSnapshot() {', start);
    assert(start !== -1 && end > start, 'personal launch branch must exist');
    const personalLaunch = main.slice(start, end);
    assert(!/keybindPolicyService|officialLowEndOptionsService|bestiary-keybinds\.json/u.test(personalLaunch),
      'personal launch must not call Official keybind/graphics');
    assert(personalLaunch.includes('gameDirectory: directory'));
    assert(personalLaunch.includes('planPersonalMemory(settings)'));
    assert.equal((main.match(/await keybindPolicyService\.apply\(\);/gu) || []).length, 2,
      'direct and Microsoft Official launch paths must both enforce keybinds');
    console.log('QA PASS: hardware JVM presets and personal modpack path isolation');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  }
})().catch((error) => {
  console.error('QA FAIL: Official keybind/performance E2E:', error);
  process.exitCode = 1;
});

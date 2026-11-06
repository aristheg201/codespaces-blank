// Integration gate: install real NeoForge client into a disposable, isolated instance.
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
  throw new Error('Compiled module not found: ' + filename);
}
const { LoaderCatalog } = require(findCompiled('LoaderCatalog.js'));
const { PersonalRuntimeInstaller } = require(findCompiled('PersonalRuntimeInstaller.js'));

(async () => {
  const versions = await LoaderCatalog.loaderVersions('1.21.1', 'neoforge');
  const ver = versions.find((item) => /^21\.1\.\d+$/u.test(item));
  if (!ver) throw new Error('Official NeoForge Maven returned no stable version for Minecraft 1.21.1.');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'bestiary-neo550-install-'));
  const java = path.join(process.env.JAVA_HOME_21_X64 || process.env.JAVA_HOME || '', 'bin', 'java.exe');
  if (!fs.existsSync(java)) throw new Error('Java 21 executable is missing for installer QA.');
  const profile = {
    id: 'qa-' + Date.now(), name: 'NeoForge install QA',
    minecraftVersion: '1.21.1', loader: 'neoforge', loaderVersion: ver,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  try {
    console.log('Installing REAL NeoForge ' + ver + ' in ' + home);
    const id = await PersonalRuntimeInstaller.ensure(profile, home, java, (message) => {
      console.log('NeoForge installer: ' + String(message).slice(0, 250));
    });
    const json = path.join(home, 'versions', id, id + '.json');
    if (!fs.existsSync(json)) throw new Error('NeoForge install did not create ' + json);
    const config = JSON.parse(fs.readFileSync(json, 'utf8'));
    if (config.id !== id) throw new Error('Installed NeoForge profile ID mismatch: ' + String(config.id));
    if (!id.includes(ver) || !id.toLowerCase().includes('neoforge')) {
      throw new Error('Profile does not correspond to NeoForge ' + ver + ': ' + id);
    }
    console.log('QA PASS: Real NeoForge 1.21.1 ' + ver + ' installed in isolated profile ' + id);
  } finally {
    await fs.promises.rm(home, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 })
      .catch((error) => console.error('QA tmp cleanup warning:', error));
  }
})().catch((error) => {
  console.error('QA FAIL: Real NeoForge installer:', error);
  process.exitCode = 1;
});

// Windows Electron UI QA: choose real NeoForge loader from official metadata, create and manage it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron: electron } = require(path.resolve(__dirname, '../source/node_modules/playwright-core'));

const executable = path.resolve(__dirname, '../source/release/win-unpacked/Bestiary Launcher.exe');
if (!fs.existsSync(executable)) throw new Error('Packaged Bestiary Launcher EXE not found.');

(async () => {
  const id = crypto.randomBytes(5).toString('hex');
  const appdata = fs.mkdtempSync(path.join(os.tmpdir(), 'bestiary-550-qa-'));
  const env = { ...process.env, APPDATA: appdata, LOCALAPPDATA: path.join(appdata, 'Local') };
  fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
  let app;
  try {
    app = await electron.launch({
      executablePath: executable,
      args: ['--disable-gpu', '--disable-gpu-sandbox'],
      env,
      timeout: 120000,
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(120000);
    await page.getByRole('button', { name: /MY MODPACKS/i }).waitFor();
    await page.getByRole('button', { name: /MY MODPACKS/i }).click();
    await page.getByRole('heading', { name: 'My Modpacks', exact: true, level: 1 }).waitFor();
    await page.getByRole('button', { name: /CREATE MODPACK/i }).click();

    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'Tạo Modpack' }).waitFor();

    const packName = 'QA_NeoForge_' + id;
    await dialog.locator('#create-pack-name').fill(packName);
    const minecraft = dialog.locator('#create-minecraft-version');
    await minecraft.waitFor();
    await page.waitForFunction(() => {
      const select = document.querySelector('#create-minecraft-version');
      return select && !select.disabled && [...select.options].some((item) => item.value === '1.21.1');
    }, { timeout: 100000 });
    await minecraft.selectOption('1.21.1');
    await dialog.locator('#create-loader').selectOption('neoforge');
    const neo = dialog.locator('#create-loader-version');
    await page.waitForFunction(() => {
      const select = document.querySelector('#create-loader-version');
      return select && !select.disabled && [...select.options].some((item) => item.value.startsWith('21.1.'));
    }, { timeout: 100000 });
    const chosen = await neo.inputValue();
    if (!chosen.startsWith('21.1.')) throw new Error('NeoForge loader version mismatch: ' + chosen);
    console.log('Selected NeoForge ' + chosen + ' for Minecraft 1.21.1');
    await dialog.getByRole('button', { name: 'TẠO MODPACK' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: packName }).waitFor();
    const packInfo = await page.locator('.modpacks-heading p').innerText();
    if (!packInfo.includes('Minecraft 1.21.1') || !packInfo.includes('NEOFORGE') || !packInfo.includes(chosen)) {
      throw new Error('Modpack metadata did not reflect selected Minecraft / NeoForge: ' + packInfo);
    }
    await page.getByRole('button', { name: /PLAY/i }).waitFor();
    console.log('QA PASS: Create NeoForge Minecraft 1.21.1 / ' + chosen + ', metadata and Play action');

    // Existing manager actions must still work after the loader migration.
    await page.getByRole('button', { name: 'RENAME' }).click();
    await dialog.getByRole('heading', { name: 'Đổi tên Modpack' }).waitFor();
    const renamed = 'QA_Neo_Renamed_' + id;
    await dialog.locator('#modpack-name').fill(renamed);
    await dialog.getByRole('button', { name: 'LƯU TÊN' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: renamed }).waitFor();

    await page.getByRole('button', { name: 'DELETE' }).click();
    await dialog.getByRole('heading', { name: 'Xóa Modpack' }).waitFor();
    await dialog.getByRole('button', { name: 'XÓA VĨNH VIỄN' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByText('Chưa có modpack cá nhân').waitFor();
    console.log('QA PASS: NeoForge Create -> selected metadata -> Rename -> Delete');
  } finally {
    if (app) await app.close().catch(() => undefined);
    await fs.promises.rm(appdata, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined);
  }
})().catch((error) => {
  console.error('QA FAIL:', error);
  process.exitCode = 1;
});

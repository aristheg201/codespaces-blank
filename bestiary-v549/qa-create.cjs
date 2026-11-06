// End-to-end Electron UI regression test: actually click Create, Rename and Delete.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { _electron: electron } = require(path.resolve(__dirname, '../source/node_modules/playwright-core'));

const exe = path.resolve(__dirname, '../source/release/win-unpacked/Bestiary Launcher.exe');
if (!fs.existsSync(exe)) throw new Error('Packaged Electron EXE does not exist: ' + exe);

(async () => {
  const testId = crypto.randomBytes(5).toString('hex');
  const appdata = fs.mkdtempSync(path.join(os.tmpdir(), 'bestiary-549-qa-'));
  const env = { ...process.env, APPDATA: appdata, LOCALAPPDATA: path.join(appdata, 'Local') };
  fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });

  let app;
  try {
    app = await electron.launch({
      executablePath: exe,
      args: ['--disable-gpu', '--disable-gpu-sandbox'],
      env,
      timeout: 120000,
    });

    const page = await app.firstWindow();
    page.setDefaultTimeout(90000);
    await page.getByRole('button', { name: /MY MODPACKS/i }).waitFor({ state: 'visible' });
    await page.getByRole('button', { name: /MY MODPACKS/i }).click();

    await page.getByRole('heading', { name: 'My Modpacks', exact: true, level: 1 }).waitFor();
    const createButton = page.getByRole('button', { name: /CREATE MODPACK/i });
    await createButton.click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('heading', { name: 'Tạo Modpack' }).waitFor();

    const name = 'QA_Create_' + testId;
    await dialog.locator('#modpack-name').fill(name);
    await dialog.getByRole('button', { name: 'TẠO MODPACK' }).click();

    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('status').getByText('Đã tạo modpack: ' + name).waitFor();
    await page.getByRole('heading', { name }).waitFor();
    const entry = page.locator('.modpacks-choice').filter({ hasText: name });
    if (await entry.count() !== 1) throw new Error('Create did not produce exactly one personal modpack.');

    await page.getByRole('button', { name: 'RENAME' }).click();
    await dialog.getByRole('heading', { name: 'Đổi tên Modpack' }).waitFor();
    const renamed = 'QA_Renamed_' + testId;
    await dialog.locator('#modpack-name').fill(renamed);
    await dialog.getByRole('button', { name: 'LƯU TÊN' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: renamed }).waitFor();
    if (await page.locator('.modpacks-choice').filter({ hasText: name }).count()) {
      throw new Error('Old pack name still visible after rename.');
    }

    await page.getByRole('button', { name: 'EXPORT ZIP' }).click();
    await dialog.getByRole('heading', { name: 'Xuất Modpack' }).waitFor();
    await dialog.getByRole('checkbox', { name: /Singleplayer/i }).check();
    await dialog.getByRole('button', { name: 'HỦY' }).click();
    await dialog.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'DELETE' }).click();
    await dialog.getByRole('heading', { name: 'Xóa Modpack' }).waitFor();
    await dialog.getByRole('button', { name: 'XÓA VĨNH VIỄN' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByText('Chưa có modpack cá nhân').waitFor();

    console.log('QA PASS: Electron UI Create -> persist -> Rename -> Export dialog -> Delete');
  } finally {
    if (app) await app.close().catch(() => undefined);
    await fs.promises.rm(appdata, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }).catch(() => undefined);
  }
})().catch((error) => {
  console.error('QA FAIL:', error);
  process.exitCode = 1;
});

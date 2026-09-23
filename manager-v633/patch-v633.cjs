const fs = require('node:fs');

const p = 'manager/src/main/services/GithubDistributionService.ts';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const req = (ok, msg) => { if (!ok) throw new Error(msg); };

const oldInterface = `interface AssetsResponse { assets?: Array<{ name?: string }> }`;
req(s.includes(oldInterface), 'asset response interface marker missing');
s = s.replace(oldInterface, `interface ObjectAsset {\n  id?: number;\n  name?: string;\n  state?: string;\n  size?: number;\n  digest?: string | null;\n}`);

const oldUpload = `        const upload = await this.runGh(['release', 'upload', 'bestiary-objects', temp, '--repo', repository], { allowFailure: true, timeoutMs: 20 * 60_000 });\n        if (upload.code !== 0 && !/already exists/i.test(\`${'${upload.stdout}'}\\n${'${upload.stderr}'}\`)) throw new Error(\`Upload thất bại: ${'${file.path}'}\\n${'${upload.stderr || upload.stdout}'}\`);`;
req(s.includes(oldUpload), 'release upload block missing');
s = s.replace(oldUpload, `        await this.uploadObjectWithRecovery(repository, temp, file);`);

const oldHelpers = `  private async listObjectAssets(repository: string): Promise<Set<string>> {\n    const result = await this.runGh(['release', 'view', 'bestiary-objects', '--repo', repository, '--json', 'assets'], { timeoutMs: 60_000 });\n    const json = JSON.parse(result.stdout) as AssetsResponse;\n    return new Set((json.assets ?? []).map((asset) => asset.name).filter((name): name is string => Boolean(name)));\n  }\n\n  private assetName(hash: string): string { return \`o-${'${hash}'}.bin\`; }`;
req(s.includes(oldHelpers), 'object asset helper block missing');
s = s.replace(oldHelpers, `  private async objectReleaseId(repository: string): Promise<number> {\n    const result = await this.runGh(['api', \`repos/${'${repository}'}/releases/tags/bestiary-objects\`, '--jq', '.id'], { timeoutMs: 30_000 });\n    const id = Number(result.stdout.trim());\n    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Không đọc được release ID của Bestiary Object Store.');\n    return id;\n  }\n\n  private async listObjectAssetRecords(repository: string): Promise<ObjectAsset[]> {\n    const releaseId = await this.objectReleaseId(repository);\n    const result = await this.runGh(['api', '--paginate', '--slurp', \`repos/${'${repository}'}/releases/${'${releaseId}'}/assets?per_page=100\`], { timeoutMs: 60_000 });\n    const parsed = JSON.parse(result.stdout) as ObjectAsset[] | ObjectAsset[][];\n    const assets: ObjectAsset[] = Array.isArray(parsed[0])\n      ? (parsed as ObjectAsset[][]).flat()\n      : (parsed as ObjectAsset[]);\n    return assets.filter((asset) => Boolean(asset && asset.name));\n  }\n\n  private async deleteObjectAsset(repository: string, asset: ObjectAsset): Promise<void> {\n    if (!Number.isSafeInteger(asset.id) || Number(asset.id) <= 0) throw new Error(\`Asset lỗi ${'${asset.name || "unknown"}'} không có ID hợp lệ để dọn.\`);\n    const removed = await this.runGh(['api', '--method', 'DELETE', \`repos/${'${repository}'}/releases/assets/${'${asset.id}'}\`], { allowFailure: true, timeoutMs: 30_000 });\n    if (removed.code !== 0 && !/404|not found/i.test(\`${'${removed.stdout}'}\\n${'${removed.stderr}'}\`)) {\n      throw new Error(\`Không dọn được release asset lỗi ${'${asset.name || asset.id}'}. ${'${removed.stderr || removed.stdout}'}\`.trim());\n    }\n  }\n\n  private assetMatches(file: ManagedFile, asset?: ObjectAsset): boolean {\n    if (!asset || asset.state !== 'uploaded') return false;\n    if (typeof asset.size === 'number' && asset.size !== file.size) return false;\n    if (asset.digest) {\n      const expected = \`sha256:${'${file.hash.toLowerCase()}'}\`;\n      if (asset.digest.toLowerCase() !== expected) return false;\n    }\n    return true;\n  }\n\n  private async findObjectAsset(repository: string, name: string): Promise<ObjectAsset | undefined> {\n    const assets = await this.listObjectAssetRecords(repository);\n    return assets.find((asset) => asset.name === name);\n  }\n\n  private async waitForUploadedObject(repository: string, file: ManagedFile, attempts = 6): Promise<ObjectAsset | undefined> {\n    const name = this.assetName(file.hash);\n    for (let attempt = 0; attempt < attempts; attempt += 1) {\n      const asset = await this.findObjectAsset(repository, name);\n      if (this.assetMatches(file, asset)) return asset;\n      if (asset?.state === 'starter') return asset;\n      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));\n    }\n    return undefined;\n  }\n\n  private async uploadObjectWithRecovery(repository: string, temp: string, file: ManagedFile): Promise<void> {\n    const name = this.assetName(file.hash);\n    let lastDetail = '';\n    for (let attempt = 1; attempt <= 3; attempt += 1) {\n      const before = await this.findObjectAsset(repository, name);\n      if (this.assetMatches(file, before)) return;\n      if (before?.state === 'starter') {\n        this.onProgress?.({ phase: 'upload', current: file.path, completed: 0, total: 1, message: \`Đang dọn upload dở: ${'${file.path}'}\` });\n        await this.deleteObjectAsset(repository, before);\n      } else if (before) {\n        throw new Error(\`Object trùng tên nhưng metadata không hợp lệ: ${'${name}'} (state=${'${before.state || "unknown"}'}, size=${'${before.size ?? "unknown"}'}).\`);\n      }\n\n      if (attempt > 1) await new Promise((resolve) => setTimeout(resolve, 1250 * attempt));\n      const upload = await this.runGh(['release', 'upload', 'bestiary-objects', temp, '--repo', repository], { allowFailure: true, timeoutMs: 20 * 60_000 });\n      const after = await this.waitForUploadedObject(repository, file);\n      if (this.assetMatches(file, after)) return;\n\n      const detail = (upload.stderr || upload.stdout || '').trim();\n      lastDetail = detail || \`GitHub không finalize asset ${'${name}'} sau lần upload ${'${attempt}'}.\`;
      if (after?.state === 'starter') {\n        await this.deleteObjectAsset(repository, after);\n        continue;\n      }\n\n      if (upload.code === 0) continue;\n      if (/already exists|http\\s+(?:500|502|503|504)|error saving asset|timeout|timed out|connection reset|econnreset/i.test(detail)) continue;\n      throw new Error(\`Upload thất bại: ${'${file.path}'}\\n${'${detail}'}\`);\n    }\n    throw new Error(\`Upload thất bại sau 3 lần tự phục hồi: ${'${file.path}'}\\n${'${lastDetail}'}\`);\n  }\n\n  private async listObjectAssets(repository: string): Promise<Set<string>> {\n    let assets = await this.listObjectAssetRecords(repository);\n    const starters = assets.filter((asset) => asset.state === 'starter');\n    for (const asset of starters) await this.deleteObjectAsset(repository, asset);\n    if (starters.length > 0) assets = await this.listObjectAssetRecords(repository);\n    return new Set(assets\n      .filter((asset) => asset.state === 'uploaded')\n      .map((asset) => asset.name)\n      .filter((name): name is string => Boolean(name)));\n  }\n\n  private assetName(hash: string): string { return \`o-${'${hash}'}.bin\`; }`);

req(s.includes("asset.state === 'starter'"), 'starter cleanup contract missing');
req(s.includes("asset.state === 'uploaded'"), 'uploaded-only reuse contract missing');
req(s.includes('uploadObjectWithRecovery'), 'upload recovery helper missing');
req(s.includes("['api', '--method', 'DELETE'"), 'starter delete API contract missing');
req(s.includes('attempt <= 3'), 'upload retry contract missing');
req(s.includes('sha256:'), 'digest verification contract missing');

fs.writeFileSync(p, s);
console.log('Manager 6.3.3 stuck release-asset recovery patch applied.');


// Manager 6.3.4 updater/browser/auth recovery.
// This runs last in the reconstruction chain so later source snapshots cannot overwrite it.
{
  const updaterPath = 'manager/src/main/services/AppUpdater.ts';
  let updater = fs.readFileSync(updaterPath, 'utf8').replace(/\r\n/g, '\n');
  req(updater.includes("import { app } from 'electron';"), 'updater electron import marker missing');
  updater = updater.replace("import { app } from 'electron';", "import { app, net } from 'electron';");
  updater = updater.replace("import https from 'node:https';\n", '');

  const getStart = updater.indexOf('function getBuffer(');
  const classStart = updater.indexOf('export class AppUpdater');
  req(getStart >= 0 && classStart > getStart, 'legacy updater transport block missing');
  const netGetBuffer = [
    '// BESTIARY_MANAGER_NET_UPDATER_V634',
    "async function getBuffer(url:string,_redirects=0,progress?:(current:number,total:number)=>void):Promise<Buffer>{",
    " const parsed=new URL(url);",
    " if(parsed.protocol!=='https:')throw new Error('Updater chỉ chấp nhận HTTPS.');",
    " const response=await net.fetch(parsed.toString(),{redirect:'follow',headers:{'User-Agent':'Bestiary-Manager-Updater/1.1','Accept':'*/*','Cache-Control':'no-cache','Pragma':'no-cache'}});",
    " if(!response.ok)throw new Error('HTTP '+response.status+' khi tải updater.');",
    " const total=Number(response.headers.get('content-length')||0)||0;",
    " const data=Buffer.from(await response.arrayBuffer());",
    " progress?.(data.length,total||data.length);",
    " return data;",
    "}",
    ""
  ].join('\n');
  updater = updater.slice(0, getStart) + netGetBuffer + updater.slice(classStart);

  const channelMarker = "const channel=JSON.parse((await getBuffer(CHANNEL_URL)).toString('utf8')) as UpdateChannel;";
  req(updater.includes(channelMarker), 'updater channel fetch marker missing');
  updater = updater.replace(
    channelMarker,
    "const channelUrl=new URL(CHANNEL_URL);channelUrl.searchParams.set('ts',String(Date.now()));const channel=JSON.parse((await getBuffer(channelUrl.toString())).toString('utf8')) as UpdateChannel;"
  );
  req(updater.includes('net.fetch'), 'Chromium updater transport missing');
  req(!updater.includes('https.get'), 'legacy Node https updater transport survived');
  fs.writeFileSync(updaterPath, updater);
}

{
  const mainPath = 'manager/src/main/index.ts';
  let main = fs.readFileSync(mainPath, 'utf8').replace(/\r\n/g, '\n');
  if (!main.includes("from 'node:child_process'")) {
    main = "import { spawn } from 'node:child_process';\n" + main;
  }

  const sendOld = [
    'function sendProgress(progress: ProgressState): void {',
    "  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('manager:progress', progress);",
    '}'
  ].join('\n');
  req(main.includes(sendOld), 'sendProgress marker missing');
  const sendNew = [
    "let lastOpenedAuthCode = '';",
    '',
    '// BESTIARY_MANAGER_EXTERNAL_BROWSER_V634',
    'async function openTrustedExternal(rawUrl: string): Promise<void> {',
    '  const parsed = new URL(rawUrl);',
    "  const host = parsed.hostname.toLowerCase();",
    "  if (parsed.protocol !== 'https:' || (host !== 'github.com' && host !== 'www.github.com')) throw new Error('URL không hợp lệ.');",
    '  const target = parsed.toString();',
    "  if (process.platform !== 'win32') { await shell.openExternal(target); return; }",
    '  await new Promise<void>((resolve, reject) => {',
    "    const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', target], { detached: true, stdio: 'ignore', windowsHide: true });",
    '    let settled = false;',
    "    child.once('spawn', () => { if (settled) return; settled = true; child.unref(); resolve(); });",
    "    child.once('error', (error) => {",
    '      if (settled) return;',
    '      settled = true;',
    '      void shell.openExternal(target).then(() => resolve(), () => reject(error));',
    '    });',
    '  });',
    '}',
    '',
    'function sendProgress(progress: ProgressState): void {',
    "  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('manager:progress', progress);",
    "  if (progress.phase === 'auth' && progress.authCode && progress.authCode !== lastOpenedAuthCode) {",
    '    lastOpenedAuthCode = progress.authCode;',
    "    void openTrustedExternal(progress.authUrl || 'https://github.com/login/device').catch(() => undefined);",
    '  }',
    "  if (progress.phase === 'auth-cancelled') lastOpenedAuthCode = '';",
    '}'
  ].join('\n');
  main = main.replace(sendOld, sendNew);

  const extStart = main.indexOf("  ipcMain.handle('system:open-external'");
  const extEnd = main.indexOf("  ipcMain.handle('distribution:ensure-repo'", extStart);
  req(extStart >= 0 && extEnd > extStart, 'external URL IPC block missing');
  main = main.slice(0, extStart)
    + "  ipcMain.handle('system:open-external', async (_event, url: string) => openTrustedExternal(url));\n"
    + main.slice(extEnd);

  const readyMarker = '  await createWindow();\n}).catch';
  req(main.includes(readyMarker), 'createWindow startup marker missing');
  main = main.replace(
    readyMarker,
    "  await createWindow();\n  // BESTIARY_MANAGER_STARTUP_AUTO_UPDATE_V634\n  setTimeout(() => { void appUpdater.checkAndDownload(); }, 1200);\n}).catch"
  );

  req(main.includes("rundll32.exe"), 'Windows external browser fallback missing');
  req(main.includes('BESTIARY_MANAGER_STARTUP_AUTO_UPDATE_V634'), 'main-process auto updater missing');
  fs.writeFileSync(mainPath, main);
}

{
  const uiPath = 'manager/src/renderer/src/App.tsx';
  let ui = fs.readFileSync(uiPath, 'utf8').replace(/\r\n/g, '\n');
  if (!ui.includes('  ProgressState,')) {
    req(ui.includes('  ModSide,\n'), 'App type import marker missing');
    ui = ui.replace('  ModSide,\n', '  ModSide,\n  ProgressState,\n');
  }

  const exportMarker = 'export default function App()';
  req(ui.includes(exportMarker), 'App export marker missing');
  if (!ui.includes('function GithubAuthOverlay(')) {
    const authUi = [
      "function GithubAuthOverlay({progress}:{progress:ProgressState}){",
      " const cancelGithubAuth=useManager(s=>s.cancelGithubAuth);",
      " const [openError,setOpenError]=useState<string|null>(null);",
      " const openGithub=async()=>{try{setOpenError(null);await window.bestiary.openExternal(progress.authUrl||'https://github.com/login/device')}catch(error){setOpenError(error instanceof Error?error.message:String(error))}};",
      " return <div className=\"fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm\"><section className=\"w-full max-w-md rounded-3xl border border-zinc-700 bg-[#101014] p-6 shadow-2xl\">",
      "  <div className=\"text-[10px] font-black tracking-[.2em] text-red-400\">GITHUB DEVICE LOGIN</div><h2 className=\"mt-2 text-2xl font-black\">Đăng nhập GitHub</h2>",
      "  <p className=\"mt-2 text-sm leading-6 text-zinc-400\">{progress.message||'Đang tạo phiên đăng nhập GitHub...'}</p>",
      "  {progress.authCode&&<div className=\"mt-5 rounded-2xl border border-zinc-700 bg-black/40 p-5 text-center\"><div className=\"text-[9px] font-black tracking-[.18em] text-zinc-500\">MÃ XÁC THỰC</div><div className=\"mt-2 font-mono text-3xl font-black tracking-[.12em] text-white\">{progress.authCode}</div></div>}",
      "  {openError&&<div className=\"mt-4 rounded-xl border border-red-500/30 bg-red-950/50 p-3 text-xs text-red-200\">{openError}</div>}",
      "  <div className=\"mt-5 grid grid-cols-2 gap-3\"><button onClick={()=>void openGithub()} className=\"rounded-xl bg-white py-3 text-xs font-black text-black\">MỞ GITHUB</button><button onClick={()=>void cancelGithubAuth()} className=\"rounded-xl border border-zinc-700 bg-zinc-900 py-3 text-xs font-black text-zinc-300\">HỦY</button></div>",
      "  <div className=\"mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-800\"><div className=\"h-full w-1/3 animate-pulse rounded-full bg-red-500\"/></div>",
      " </section></div>",
      "}",
      ""
    ].join('\n');
    ui = ui.replace(exportMarker, authUi + exportMarker);
  }

  const progressStart = ui.indexOf('{progress&&<div className="fixed bottom-5 left-[298px]');
  const errorStart = ui.indexOf('{error&&<div className="fixed bottom-5 right-5', progressStart);
  req(progressStart >= 0 && errorStart > progressStart, 'generic progress render marker missing');
  const oldProgress = ui.slice(progressStart, errorStart);
  req(oldProgress.endsWith('}'), 'generic progress expression malformed');
  const genericExpression = oldProgress.slice(1, -1);
  ui = ui.slice(0, progressStart)
    + "{progress?.phase==='auth'?<GithubAuthOverlay progress={progress}/>:(" + genericExpression + ")}"
    + ui.slice(errorStart);

  ui = ui.replace('Release Console 6.3.2', 'Release Console 6.3.4');
  ui = ui.replace("currentVersion:'6.3.0'", "currentVersion:'6.3.4'");
  req(ui.includes('function GithubAuthOverlay('), 'GitHub auth modal missing');
  req(ui.includes('MỞ GITHUB'), 'GitHub open button missing');
  req(ui.includes('progress.authCode'), 'device auth code display missing');
  fs.writeFileSync(uiPath, ui);
}

console.log('Manager 6.3.4 updater, browser and GitHub auth recovery patch applied.');

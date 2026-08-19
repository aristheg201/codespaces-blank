const fs=require('node:fs');
const p='manager/src/renderer/src/App.tsx';
let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');

s=s.replace(/import type \{([^}]+)\} from '\.\.\/\.\.\/shared\/types';/, (m,inside)=>{
  if(inside.includes('AppUpdateState')) return m;
  return `import type { AppUpdateState,${inside} } from '../../shared/types';`;
});
s=s.replace('Release Console v6','Release Console 6.1.0').replace('Release Console 6.0.6','Release Console 6.1.0');

const appRe=/export default function App\(\) \{\n  const \{ load, snapshot, view, error, clearError, setProgress \} = useManager\(\);\n  useEffect\(\(\) => \{ const off = window\.bestiary\.onProgress\(setProgress\); void load\(\); return off; \}, \[load, setProgress\]\);/;
if(!appRe.test(s)) throw new Error('Manager default App function marker missing');
const replacement=[
"export default function App() {",
"  const { load, snapshot, view, error, clearError, setProgress } = useManager();",
"  const [appUpdate,setAppUpdate]=useState<AppUpdateState>({currentVersion:'6.1.0',latestVersion:null,status:'idle',progress:0,message:'Chưa kiểm tra cập nhật.'});",
"  useEffect(() => {",
"    const off = window.bestiary.onProgress(setProgress);",
"    const offUpdate = window.bestiary.onAppUpdate(setAppUpdate);",
"    let active=true;",
"    void load();",
"    void window.bestiary.getAppUpdate().then(state=>{ if(active) setAppUpdate(state); });",
"    const timer=window.setTimeout(()=>{ void window.bestiary.checkAppUpdate().then(state=>{ if(active) setAppUpdate(state); }); },1800);",
"    return()=>{active=false;off();offUpdate();window.clearTimeout(timer);};",
"  }, [load, setProgress]);"
].join('\n');
s=s.replace(appRe,replacement);

const insert=[
"",
"function ManagerUpdate({state}:{state:AppUpdateState}){",
"  if(state.status==='idle'||state.status==='up_to_date') return null;",
"  const ready=state.status==='ready';",
"  const downloading=state.status==='downloading'||state.status==='available'||state.status==='checking';",
"  const title=ready?'MANAGER '+(state.latestVersion||'')+' SẴN SÀNG':state.status==='downloading'?'ĐANG TẢI '+(state.latestVersion||''):state.status==='error'?'LỖI AUTO UPDATE':'APP UPDATE';",
"  return <aside className=\"fixed bottom-5 left-[290px] right-5 z-[90] grid grid-cols-[1fr_220px_auto] items-center gap-4 rounded-2xl border border-red-500/25 bg-[#101014]/95 p-4 shadow-2xl backdrop-blur-xl\">",
"    <div><div className=\"text-[9px] font-black tracking-[.15em] text-red-400\">{title}</div><div className=\"mt-1 text-xs text-zinc-300\">{state.message}</div></div>",
"    {downloading?<div className=\"h-2 overflow-hidden rounded-full bg-zinc-800\"><i className=\"block h-full rounded-full bg-red-500\" style={{width:String(state.progress)+'%'}}/></div>:<div/>}",
"    {(ready||state.status==='error')?<button onClick={()=>void(ready?window.bestiary.installAppUpdate():window.bestiary.checkAppUpdate())} className=\"rounded-xl bg-red-500 px-5 py-3 text-[9px] font-black text-white\">{ready?'CẬP NHẬT & KHỞI ĐỘNG LẠI':'THỬ LẠI'}</button>:<div/>}",
"  </aside>;",
"}",
""
].join('\n');
const exportPos=s.indexOf('export default function App()');
if(exportPos<0) throw new Error('Manager default export position missing');
s=s.slice(0,exportPos)+insert+s.slice(exportPos);

const progressMarker='    <ProgressOverlay />';
if(!s.includes(progressMarker)) throw new Error('ProgressOverlay render marker missing');
s=s.replace(progressMarker,'    <ProgressOverlay />\n    <ManagerUpdate state={appUpdate} />');

fs.writeFileSync(p,s);
console.log('Manager 6.1.0 updater UI patched against default App source.');

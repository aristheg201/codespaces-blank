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
s=s.replace(appRe,`export default function App() {\n  const { load, snapshot, view, error, clearError, setProgress } = useManager();\n  const [appUpdate,setAppUpdate]=useState<AppUpdateState>({currentVersion:'6.1.0',latestVersion:null,status:'idle',progress:0,message:'Chưa kiểm tra cập nhật.'});\n  useEffect(() => {\n    const off = window.bestiary.onProgress(setProgress);\n    const offUpdate = window.bestiary.onAppUpdate(setAppUpdate);\n    let active=true;\n    void load();\n    void window.bestiary.getAppUpdate().then(state=>{ if(active) setAppUpdate(state); });\n    const timer=window.setTimeout(()=>{ void window.bestiary.checkAppUpdate().then(state=>{ if(active) setAppUpdate(state); }); },1800);\n    return()=>{active=false;off();offUpdate();window.clearTimeout(timer);};\n  }, [load, setProgress]);`);

const insert=`\nfunction ManagerUpdate({state}:{state:AppUpdateState}){\n  if(state.status==='idle'||state.status==='up_to_date') return null;\n  const ready=state.status==='ready';\n  const downloading=state.status==='downloading'||state.status==='available'||state.status==='checking';\n  return <aside className=\"fixed bottom-5 left-[290px] right-5 z-[90] grid grid-cols-[1fr_220px_auto] items-center gap-4 rounded-2xl border border-red-500/25 bg-[#101014]/95 p-4 shadow-2xl backdrop-blur-xl\">\n    <div><div className=\"text-[9px] font-black tracking-[.15em] text-red-400\">{ready?`MANAGER ${state.latestVersion} SẴN SÀNG`:state.status==='downloading'?`ĐANG TẢI ${state.latestVersion||''}`:state.status==='error'?'LỖI AUTO UPDATE':'APP UPDATE'}</div><div className=\"mt-1 text-xs text-zinc-300\">{state.message}</div></div>\n    {downloading?<div className=\"h-2 overflow-hidden rounded-full bg-zinc-800\"><i className=\"block h-full rounded-full bg-red-500\" style={{width:`${state.progress}%`}}/></div>:<div/>}\n    {(ready||state.status==='error')?<button onClick={()=>void(ready?window.bestiary.installAppUpdate():window.bestiary.checkAppUpdate())} className=\"rounded-xl bg-red-500 px-5 py-3 text-[9px] font-black text-white\">{ready?'CẬP NHẬT & KHỞI ĐỘNG LẠI':'THỬ LẠI'}</button>:<div/>}\n  </aside>;\n}\n`;
const exportPos=s.indexOf('export default function App()');
if(exportPos<0) throw new Error('Manager default export position missing');
s=s.slice(0,exportPos)+insert+s.slice(exportPos);

const progressMarker='    <ProgressOverlay />';
if(!s.includes(progressMarker)) throw new Error('ProgressOverlay render marker missing');
s=s.replace(progressMarker,'    <ProgressOverlay />\n    <ManagerUpdate state={appUpdate} />');

fs.writeFileSync(p,s);
console.log('Manager 6.1.0 updater UI patched against default App source.');

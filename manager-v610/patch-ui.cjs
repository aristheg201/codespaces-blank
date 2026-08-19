const fs=require('node:fs');
const p='manager/src/renderer/src/App.tsx';
let s=fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');

s=s.replace(/import type \{([^}]+)\} from '\.\.\/\.\.\/shared\/types';/, (m,inside)=>{
  if(inside.includes('AppUpdateState')) return m;
  return `import type { AppUpdateState,${inside} } from '../../shared/types';`;
});
s=s.replace('Release Console v6','Release Console 6.1.0').replace('Release Console 6.0.6','Release Console 6.1.0');

const insert=[
"",
"function ManagerUpdate(){",
"  const [state,setState]=useState<AppUpdateState>({currentVersion:'6.1.0',latestVersion:null,status:'idle',progress:0,message:'Chưa kiểm tra cập nhật.'});",
"  useEffect(()=>{",
"    let active=true;",
"    const off=window.bestiary.onAppUpdate(next=>{if(active)setState(next);});",
"    void window.bestiary.getAppUpdate().then(next=>{if(active)setState(next);});",
"    const timer=window.setTimeout(()=>{void window.bestiary.checkAppUpdate().then(next=>{if(active)setState(next);});},1800);",
"    return()=>{active=false;off();window.clearTimeout(timer);};",
"  },[]);",
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
const appPos=s.indexOf('function App()');
if(appPos<0) throw new Error('Manager App position missing after v606 export patch');
s=s.slice(0,appPos)+insert+s.slice(appPos);

const progressRe=/(<ProgressOverlay\s*\/>)/;
if(!progressRe.test(s)) throw new Error('ProgressOverlay render marker missing');
s=s.replace(progressRe,'$1\n    <ManagerUpdate />');
if(!s.includes('export default App;')) throw new Error('Manager default export lost');

fs.writeFileSync(p,s);
console.log('Manager 6.1.0 independent updater component patched.');

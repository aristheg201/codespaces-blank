import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'fs-extra';
import https from 'node:https';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AppUpdateState } from '../../shared/types';

const CHANNEL_URL='https://raw.githubusercontent.com/aristheg201/bestiary-distribution/main/bestiary-distribution/app-updates.json';
interface ProductUpdate{version:string;installerUrl:string;sha256:string;releaseNotes?:string}
interface UpdateChannel{products?:{manager?:ProductUpdate}}
function cmp(a:string,b:string){const x=a.replace(/^v/,'').split('.').map(n=>parseInt(n)||0),y=b.replace(/^v/,'').split('.').map(n=>parseInt(n)||0);for(let i=0;i<Math.max(x.length,y.length);i++){const d=(x[i]||0)-(y[i]||0);if(d)return d;}return 0;}
function getBuffer(url:string,redirects=0,progress?:(current:number,total:number)=>void):Promise<Buffer>{if(redirects>6)return Promise.reject(new Error('Quá nhiều redirect khi tải updater.'));const parsed=new URL(url);if(parsed.protocol!=='https:')return Promise.reject(new Error('Updater chỉ chấp nhận HTTPS.'));return new Promise((resolve,reject)=>{const req=https.get(parsed,{headers:{'User-Agent':'Bestiary-Manager-Updater/1.0',Accept:'*/*'}},res=>{const status=res.statusCode||0;if([301,302,303,307,308].includes(status)&&res.headers.location){res.resume();void getBuffer(new URL(res.headers.location,parsed).toString(),redirects+1,progress).then(resolve,reject);return;}if(status<200||status>=300){res.resume();reject(new Error(`HTTP ${status} khi tải updater.`));return;}const total=Number(res.headers['content-length']||0)||0;let current=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{chunks.push(chunk);current+=chunk.length;progress?.(current,total);});res.on('end',()=>resolve(Buffer.concat(chunks)));res.on('error',reject);});req.setTimeout(30000,()=>req.destroy(new Error('Updater timeout.')));req.on('error',reject);});}
export class AppUpdater{
 private state:AppUpdateState={currentVersion:app.getVersion(),latestVersion:null,status:'idle',progress:0,message:'Chưa kiểm tra cập nhật.'};
 private installerPath:string|null=null; private running:Promise<AppUpdateState>|null=null;
 constructor(private root:string,private emit:(state:AppUpdateState)=>void){this.root=path.join(root,'app-updates');}
 snapshot(){return {...this.state};}
 checkAndDownload(){if(this.running)return this.running;this.running=this.run().finally(()=>{this.running=null;});return this.running;}
 installReady(){if(this.state.status!=='ready'||!this.installerPath||!fs.existsSync(this.installerPath))return false;const child=spawn(this.installerPath,[],{detached:true,stdio:'ignore',windowsHide:false});child.unref();setTimeout(()=>app.quit(),250);return true;}
 private set(next:Partial<AppUpdateState>){this.state={...this.state,...next};this.emit(this.snapshot());}
 private async run(){try{this.set({status:'checking',progress:0,message:'Đang kiểm tra bản Manager mới...'});const channel=JSON.parse((await getBuffer(CHANNEL_URL)).toString('utf8')) as UpdateChannel;const r=channel.products?.manager;if(!r?.version||!r.installerUrl||!/^[a-f0-9]{64}$/i.test(r.sha256||'')){this.set({status:'up_to_date',latestVersion:null,progress:100,message:'Chưa có bản Manager mới được phát hành.'});return this.snapshot();}this.set({latestVersion:r.version,releaseNotes:r.releaseNotes||''});if(cmp(r.version,app.getVersion())<=0){this.set({status:'up_to_date',progress:100,message:`Đang dùng bản mới nhất ${app.getVersion()}.`});return this.snapshot();}this.set({status:'downloading',progress:0,message:`Đang tải Manager ${r.version}...`});await fs.ensureDir(this.root);const target=path.join(this.root,path.basename(new URL(r.installerUrl).pathname)||`manager-${r.version}.exe`);const data=await getBuffer(r.installerUrl,0,(c,t)=>{const pct=t>0?Math.min(99,Math.floor(c/t*100)):this.state.progress;if(pct!==this.state.progress)this.set({progress:pct});});const actual=crypto.createHash('sha256').update(data).digest('hex').toLowerCase();if(actual!==r.sha256.toLowerCase())throw new Error('SHA-256 của bản Manager mới không khớp.');await fs.writeFile(`${target}.part`,data);await fs.move(`${target}.part`,target,{overwrite:true});this.installerPath=target;this.set({status:'ready',progress:100,message:`Manager ${r.version} đã sẵn sàng.`});return this.snapshot();}catch(e){this.set({status:'error',progress:0,message:e instanceof Error?e.message:String(e)});return this.snapshot();}}
}

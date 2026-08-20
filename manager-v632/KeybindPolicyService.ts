import path from 'node:path';
import fs from 'fs-extra';

export type KeybindMode = 'default' | 'locked';
export interface KeybindRule { id:string; label:string; key:string; mode:KeybindMode; enabled:boolean; }
export interface KeybindPolicy { schema:1; rules:KeybindRule[]; updatedAt:number; sourcePath?:string; sourceAvailable?:boolean; }

const EMPTY: KeybindPolicy = { schema:1, rules:[], updatedAt:0 };
const SOURCE_META = path.join('.bestiary','keybind-source.json');

function cleanRule(value:unknown):KeybindRule|null {
  if(!value || typeof value !== 'object') return null;
  const raw=value as Partial<KeybindRule>;
  if(typeof raw.id !== 'string' || !/^key_[^\r\n:]{1,240}$/u.test(raw.id)) return null;
  if(typeof raw.key !== 'string' || raw.key.length<1 || raw.key.length>160 || /[\r\n]/u.test(raw.key)) return null;
  const label=typeof raw.label==='string'&&raw.label.trim()?raw.label.trim().slice(0,160):raw.id;
  return {id:raw.id,label,key:raw.key,mode:raw.mode==='locked'?'locked':'default',enabled:raw.enabled!==false};
}
function defaultLabel(id:string):string { return id.replace(/^key_/u,'').replace(/[._]/gu,' ').trim()||id; }
function sameRules(a:KeybindRule[],b:KeybindRule[]):boolean { return a.length===b.length&&a.every((x,i)=>{const y=b[i];return x.id===y.id&&x.label===y.label&&x.key===y.key&&x.mode===y.mode&&x.enabled===y.enabled;}); }

export class KeybindPolicyService {
  public async load(root:string|null):Promise<KeybindPolicy>{
    if(!root) return {...EMPTY,rules:[]};
    const current=await this.read(path.join(root,'config','bestiary-keybinds.json'));
    const source=await this.resolveSource(root);
    if(!source) return {...current,sourceAvailable:false};
    return this.scanOptions(root,source,current,false);
  }

  public async save(root:string|null,policy:KeybindPolicy):Promise<KeybindPolicy>{
    if(!root) throw new Error('Chưa chọn workspace.');
    const seen=new Set<string>();const rules:KeybindRule[]=[];
    for(const item of Array.isArray(policy.rules)?policy.rules:[]){const rule=cleanRule(item);if(!rule||seen.has(rule.id))continue;seen.add(rule.id);rules.push(rule);}
    rules.sort((a,b)=>a.id.localeCompare(b.id,'en'));
    const next:KeybindPolicy={schema:1,rules,updatedAt:Date.now()};
    await this.write(root,next);
    const source=await this.resolveSource(root);
    return {...next,sourcePath:source??undefined,sourceAvailable:Boolean(source)};
  }

  public async importOptions(root:string|null,sourcePath?:string):Promise<KeybindPolicy>{
    if(!root) throw new Error('Chưa chọn workspace.');
    let source:string|null=null;
    if(sourcePath){
      const normalized=path.resolve(sourcePath);
      if(path.basename(normalized).toLowerCase()!=='options.txt') throw new Error('Hãy chọn đúng file options.txt.');
      const stat=await fs.stat(normalized).catch(()=>null);
      if(!stat?.isFile()) throw new Error('Không đọc được options.txt đã chọn.');
      source=normalized;
      await this.writeSource(root,source);
    } else source=await this.resolveSource(root);
    if(!source) throw new Error('Chưa chọn nguồn options.txt.');
    const current=await this.read(path.join(root,'config','bestiary-keybinds.json'));
    return this.scanOptions(root,source,current,true);
  }

  public async getSource(root:string|null):Promise<string|null>{ return root?this.resolveSource(root):null; }

  private async resolveSource(root:string):Promise<string|null>{
    try{
      const meta=await fs.readJson(path.join(root,SOURCE_META)) as {sourcePath?:unknown};
      if(typeof meta.sourcePath==='string'&&meta.sourcePath.trim()){
        const candidate=path.resolve(meta.sourcePath);
        if(path.basename(candidate).toLowerCase()==='options.txt'&&await fs.pathExists(candidate)) return candidate;
      }
    }catch{}
    const workspace=path.join(root,'options.txt');
    if(await fs.pathExists(workspace)) return workspace;
    return null;
  }

  private async writeSource(root:string,sourcePath:string):Promise<void>{
    const target=path.join(root,SOURCE_META);await fs.ensureDir(path.dirname(target));
    await fs.writeJson(target,{schema:1,sourcePath,updatedAt:Date.now()},{spaces:2});
  }

  private async scanOptions(root:string,source:string,current:KeybindPolicy,forceWrite:boolean):Promise<KeybindPolicy>{
    const text=await fs.readFile(source,'utf8');
    const previous=new Map(current.rules.map(r=>[r.id,r]));const discovered=new Map<string,string>();
    for(const line of text.replace(/\r\n/gu,'\n').split('\n')){
      const at=line.indexOf(':');if(at<=0)continue;const id=line.slice(0,at).trim();
      if(!id.startsWith('key_')||!/^key_[^\r\n:]{1,240}$/u.test(id))continue;
      const key=line.slice(at+1).trim();if(!key||key.length>160||/[\r\n]/u.test(key))continue;
      discovered.set(id,key);
    }
    const rules=[...discovered.entries()].map(([id,optionsKey])=>{const old=previous.get(id);return{id,label:old?.label||defaultLabel(id),key:old?.mode==='locked'?old.key:optionsKey,mode:old?.mode||'default',enabled:old?.enabled!==false} satisfies KeybindRule;});
    rules.sort((a,b)=>a.id.localeCompare(b.id,'en'));
    const next:KeybindPolicy={schema:1,rules,updatedAt:current.updatedAt,sourcePath:source,sourceAvailable:true};
    if(!forceWrite&&sameRules(current.rules,rules)) return next;
    next.updatedAt=Date.now();await this.write(root,next);return next;
  }

  private async write(root:string,policy:KeybindPolicy):Promise<void>{
    const target=path.join(root,'config','bestiary-keybinds.json');await fs.ensureDir(path.dirname(target));
    const tmp=`${target}.tmp`;await fs.writeJson(tmp,{schema:1,rules:policy.rules,updatedAt:policy.updatedAt},{spaces:2});await fs.move(tmp,target,{overwrite:true});
  }
  private async read(file:string):Promise<KeybindPolicy>{
    try{const raw=await fs.readJson(file) as Partial<KeybindPolicy>;const rules=(Array.isArray(raw.rules)?raw.rules:[]).map(cleanRule).filter((r):r is KeybindRule=>Boolean(r));rules.sort((a,b)=>a.id.localeCompare(b.id,'en'));return{schema:1,rules,updatedAt:Number(raw.updatedAt||0)};}catch{return{...EMPTY,rules:[]};}
  }
}

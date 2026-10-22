import { fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';

export class MaterialArchiveHead {
  bucket:string='';sha256:string='';bytes:number=0;entries:number=0;
}
export class MaterialArchiveChange {
  key:string='';value:string='';replace:boolean=false;
}
export class MaterialArchiveNode { sha256:string='';raw:string=''; }
export class MaterialArchivePrepared {
  heads:MaterialArchiveHead[]=[];nodes:MaterialArchiveNode[]=[];
}
class MaterialArchiveEntry { key:string='';value:string=''; }
class MaterialArchiveBucket {
  schema:number=1;partition_id:string='';entries:MaterialArchiveEntry[]=[];
}
class MaterialArchiveFile { name:string='';bytes:number=0; }
class MaterialArchiveInventory { identity:string='';parentIdentity:string='';files:MaterialArchiveFile[]=[];bytes:number=0; }

// Immutable metadata only. Outbox owns the business values and the exclusive
// partition lock. A prepared head becomes authoritative only with its ledger.
export class MaterialOutboxArchiveIndex {
  private root:string='';private partitionRoot:string='';private partitionId:string='';
  private hashText:(text:string)=>string=(_text:string):string=>'';
  initialize(partitionRoot:string,partitionId:string,hash:(text:string)=>string):void{
    this.root='';this.partitionRoot='';this.partitionId='';
    if(typeof partitionRoot!=='string'||typeof partitionId!=='string'||!/^[a-f0-9]{64}$/.test(partitionId)||typeof hash!=='function')throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    const normalized=partitionRoot.replace(/\\/g,'/');
    this.pathParts(normalized);this.partitionRoot=normalized;this.root=normalized+'/archive-index';
    this.partitionId=partitionId;this.hashText=hash;
  }
  private size(text:string):number{
    const bytes=new util.TextEncoder().encodeInto(text);try{return bytes.length;}finally{bytes.fill(0);}
  }
  private hash(text:string):string{
    const value=this.hashText(text);if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw new Error('OUTBOX_ARCHIVE_CORRUPT');return value;
  }
  private exact(value:Object,keys:string[]):boolean{
    if(value===null||typeof value!=='object'||Array.isArray(value))return false;
    const found=Object.keys(value).sort();return found.length===keys.length&&found.every((key:string,index:number):boolean=>key===keys[index]);
  }
  private pathParts(path:string):string[]{
    let prefix='',rest='';
    if(/^[A-Za-z]:\//.test(path)){prefix=path.slice(0,2);rest=path.slice(3);}
    else if(path.startsWith('/')&&!path.startsWith('//'))rest=path.slice(1);
    else throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    const parts=rest.split('/');if(parts.some((part:string):boolean=>!part||part==='.'||part==='..'))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    return [prefix,...parts];
  }
  private directory(path:string):string{
    try{
      const parts=this.pathParts(path);let cursor=parts[0],identity='';
      for(let index=1;index<parts.length;index++){
        cursor+='/'+parts[index];const stat=fs.lstatSync(cursor);
        if(stat.isSymbolicLink()||!stat.isDirectory())throw new Error('OUTBOX_ARCHIVE_CORRUPT');
        identity=String(stat.ino);if(!/^[0-9]+$/.test(identity))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
      }
      return identity;
    }catch{throw new Error('OUTBOX_ARCHIVE_CORRUPT');}
  }
  private key(key:string):string{
    if(typeof key!=='string'||!/^[\x00-\x7f]{1,256}$/.test(key))throw new Error('OUTBOX_ARCHIVE_CORRUPT');return this.hash(key).slice(0,3);
  }
  private value(value:string):void{
    if(typeof value!=='string'||this.size(value)>262144)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    try{JSON.parse(value);}catch{throw new Error('OUTBOX_ARCHIVE_CORRUPT');}
  }
  private heads(heads:MaterialArchiveHead[]):MaterialArchiveHead[]{
    if(!this.root||!Array.isArray(heads)||heads.length>4096)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    const result:MaterialArchiveHead[]=[];const seen:string[]=[],hashes:string[]=[];
    for(const head of heads){
      if(!this.exact(head,['bucket','bytes','entries','sha256'])||typeof head.bucket!=='string'||!/^[a-f0-9]{3}$/.test(head.bucket)||
        typeof head.sha256!=='string'||!/^[a-f0-9]{64}$/.test(head.sha256)||!Number.isSafeInteger(head.bytes)||head.bytes<1||head.bytes>2000000||
        !Number.isSafeInteger(head.entries)||head.entries<1||seen.includes(head.bucket)||hashes.includes(head.sha256))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
      seen.push(head.bucket);hashes.push(head.sha256);const copy=new MaterialArchiveHead();Object.assign(copy,head);result.push(copy);
    }
    return result.sort((a:MaterialArchiveHead,b:MaterialArchiveHead):number=>a.bucket<b.bucket?-1:a.bucket>b.bucket?1:0);
  }
  private parse(head:MaterialArchiveHead,raw:string):MaterialArchiveBucket{
    if(typeof raw!=='string'||this.size(raw)!==head.bytes||this.hash(raw)!==head.sha256)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    let data:MaterialArchiveBucket;
    try{data=JSON.parse(raw) as MaterialArchiveBucket;}catch{throw new Error('OUTBOX_ARCHIVE_CORRUPT');}
    if(!this.exact(data,['entries','partition_id','schema'])||data.schema!==1||data.partition_id!==this.partitionId||
      !Array.isArray(data.entries)||data.entries.length!==head.entries)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    let previous='';let first=true;
    for(const entry of data.entries){
      if(!this.exact(entry,['key','value'])||this.key(entry.key)!==head.bucket||(!first&&entry.key<=previous))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
      this.value(entry.value);previous=entry.key;first=false;
    }
    return data;
  }
  private archiveExists():boolean{
    const names=fs.listFileSync(this.partitionRoot);
    if(!Array.isArray(names)||names.some((name:string):boolean=>typeof name!=='string'))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    return names.includes('archive-index');
  }
  private sameDirectory(inventory:MaterialArchiveInventory):void{
    if(this.directory(this.partitionRoot)!==inventory.parentIdentity||
      (inventory.identity?this.directory(this.root)!==inventory.identity:this.archiveExists()))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
  }
  private inspect():MaterialArchiveInventory{
    const out=new MaterialArchiveInventory();out.parentIdentity=this.directory(this.partitionRoot);
    // access follows a link: a dangling junction must not look uncreated.
    if(!this.archiveExists())return out;
    out.identity=this.directory(this.root);const names=fs.listFileSync(this.root);
    if(!Array.isArray(names))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    if(names.length>65536)throw new Error('OUTBOX_ARCHIVE_FULL');
    if(new Set(names).size!==names.length)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    for(const name of names){
      if(typeof name!=='string'||!/^[a-f0-9]{64}\.bucket\.json(?:\.partial)?$/.test(name))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
      const stat=fs.lstatSync(this.root+'/'+name);
      if(stat.isSymbolicLink()||!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<0)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
      if(stat.size>2000000)throw new Error('OUTBOX_ARCHIVE_FULL');
      const file=new MaterialArchiveFile();file.name=name;file.bytes=stat.size;out.files.push(file);out.bytes+=stat.size;
      if(out.bytes>67108864)throw new Error('OUTBOX_ARCHIVE_FULL');
    }
    this.sameDirectory(out);return out;
  }
  private inventory():MaterialArchiveInventory{
    try{return this.inspect();}
    catch(error){if((error as Error).message==='OUTBOX_ARCHIVE_FULL')throw error as Error;throw new Error('OUTBOX_ARCHIVE_CORRUPT');}
  }
  private raw(path:string,expectedBytes:number):string{
    try{
      const stat=fs.lstatSync(path);
      if(stat.isSymbolicLink()||!stat.isFile()||!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>2000000||
        stat.size!==expectedBytes)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
      const bytes=new Uint8Array(stat.size),chunk=new Uint8Array(Math.min(65536,stat.size)),eof=new Uint8Array(1);
      try{
        const file=fs.openSync(path,fs.OpenMode.READ_ONLY);
        try{
          const before=fs.statSync(file.fd);
          if(!before.isFile()||before.size!==stat.size||String(before.ino)!==String(stat.ino))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
          let offset=0;
          while(offset<bytes.length){
            const length=Math.min(chunk.length,bytes.length-offset);
            // SDK offset is relative to its current filePointer. Omit it so
            // short reads advance sequentially; the temporary buffer starts at
            // zero and only its returned prefix enters the destination array.
            const read=fs.readSync(file.fd,chunk.buffer,{length:length});
            if(!Number.isSafeInteger(read)||read<=0||read>length)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
            bytes.set(chunk.subarray(0,read),offset);offset+=read;
          }
          if(fs.readSync(file.fd,eof.buffer,{length:1})!==0)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
          const after=fs.statSync(file.fd);
          if(!after.isFile()||after.size!==stat.size||String(after.ino)!==String(stat.ino))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
          const text=new util.TextDecoder('utf-8').decodeToString(bytes),encoded=new util.TextEncoder().encodeInto(text);
          try{
            if(encoded.length!==bytes.length||encoded.some((value:number,index:number):boolean=>value!==bytes[index]))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
            return text;
          }finally{encoded.fill(0);}
        }finally{fs.closeSync(file);}
      }finally{bytes.fill(0);chunk.fill(0);eof.fill(0);}
    }catch{throw new Error('OUTBOX_ARCHIVE_CORRUPT');}
  }
  private read(head:MaterialArchiveHead):MaterialArchiveBucket{
    try{
      const path=this.root+'/'+head.sha256+'.bucket.json';return this.parse(head,this.raw(path,head.bytes));
    }catch{throw new Error('OUTBOX_ARCHIVE_CORRUPT');}
  }
  get(heads:MaterialArchiveHead[],key:string):string|undefined{
    try{
      const bucket=this.key(key),validated=this.heads(heads),inventory=this.inventory();
      // Independently fail closed for every referenced head. This intentionally
      // reads all buckets; production discovery needs a bounded batch API before
      // using this helper in a per-revision loop, not an unchecked cache.
      let value:string|undefined=undefined;
      for(const head of validated){const data=this.read(head);
        if(head.bucket===bucket)value=data.entries.find((entry:MaterialArchiveEntry):boolean=>entry.key===key)?.value;}
      this.sameDirectory(inventory);return value;
    }catch(error){if((error as Error).message==='OUTBOX_ARCHIVE_FULL')throw error as Error;throw new Error('OUTBOX_ARCHIVE_CORRUPT');}
  }
  verify(heads:MaterialArchiveHead[]):void{
    try{const validated=this.heads(heads),inventory=this.inventory();for(const head of validated)this.read(head);this.sameDirectory(inventory);}
    catch(error){if((error as Error).message==='OUTBOX_ARCHIVE_FULL')throw error as Error;throw new Error('OUTBOX_ARCHIVE_CORRUPT');}
  }
  prepare(heads:MaterialArchiveHead[],changes:MaterialArchiveChange[]):MaterialArchivePrepared{
    const validated=this.heads(heads);
    if(!Array.isArray(changes)||changes.length>256)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    const groups:Map<string,MaterialArchiveChange[]>=new Map();const seen:string[]=[];
    for(const change of changes){
      if(!this.exact(change,['key','replace','value'])||typeof change.replace!=='boolean')throw new Error('OUTBOX_ARCHIVE_CORRUPT');
      const bucket=this.key(change.key);this.value(change.value);
      if(change.replace&&!change.key.startsWith('m:'))throw new Error('OUTBOX_ARCHIVE_CONFLICT');
      if(seen.includes(change.key))throw new Error('OUTBOX_ARCHIVE_CONFLICT');seen.push(change.key);
      const existing=groups.get(bucket)||[];existing.push(change);groups.set(bucket,existing);
    }
    // Every referenced old head must remain readable, including untouched buckets.
    this.verify(validated);const prepared=new MaterialArchivePrepared();prepared.heads=validated;
    for(const bucket of Array.from(groups.keys()).sort()){
      const old=validated.find((head:MaterialArchiveHead):boolean=>head.bucket===bucket);
      const data=old?this.read(old):new MaterialArchiveBucket();data.partition_id=this.partitionId;
      for(const change of groups.get(bucket)||[]){
        const entry=data.entries.find((item:MaterialArchiveEntry):boolean=>item.key===change.key);
        if(entry){if(entry.value!==change.value&&!change.replace)throw new Error('OUTBOX_ARCHIVE_CONFLICT');entry.value=change.value;}
        else{const next=new MaterialArchiveEntry();next.key=change.key;next.value=change.value;data.entries.push(next);}
      }
      data.entries.sort((a:MaterialArchiveEntry,b:MaterialArchiveEntry):number=>a.key<b.key?-1:a.key>b.key?1:0);
      const raw=JSON.stringify(data),bytes=this.size(raw);if(bytes>2000000)throw new Error('OUTBOX_ARCHIVE_FULL');
      const head=new MaterialArchiveHead();head.bucket=bucket;head.sha256=this.hash(raw);head.bytes=bytes;head.entries=data.entries.length;
      this.parse(head,raw);prepared.heads=prepared.heads.filter((item:MaterialArchiveHead):boolean=>item.bucket!==bucket);prepared.heads.push(head);
      const node=new MaterialArchiveNode();node.sha256=head.sha256;node.raw=raw;prepared.nodes.push(node);
    }
    prepared.heads.sort((a:MaterialArchiveHead,b:MaterialArchiveHead):number=>a.bucket<b.bucket?-1:a.bucket>b.bucket?1:0);return prepared;
  }
  persist(prepared:MaterialArchivePrepared):void{
    if(!this.exact(prepared,['heads','nodes'])||!Array.isArray(prepared.nodes)||prepared.nodes.length>256)throw new Error('OUTBOX_ARCHIVE_CORRUPT');
    const heads=this.heads(prepared.heads),nodes:MaterialArchiveNode[]=[],seen:string[]=[];
    for(const node of prepared.nodes){
      if(!this.exact(node,['raw','sha256'])||typeof node.raw!=='string'||typeof node.sha256!=='string'||!/^[a-f0-9]{64}$/.test(node.sha256)||seen.includes(node.sha256))throw new Error('OUTBOX_ARCHIVE_CORRUPT');
      const head=heads.find((item:MaterialArchiveHead):boolean=>item.sha256===node.sha256);
      if(!head)throw new Error('OUTBOX_ARCHIVE_CORRUPT');this.parse(head,node.raw);seen.push(node.sha256);
      const copy=new MaterialArchiveNode();copy.sha256=node.sha256;copy.raw=node.raw;nodes.push(copy);
    }
    const inventory=this.inventory();
    for(const head of heads)if(!seen.includes(head.sha256))this.read(head);
    let peakBytes=inventory.bytes,peakFiles=inventory.files.length;
    for(const node of nodes){
      const name=node.sha256+'.bucket.json',target=inventory.files.find((file:MaterialArchiveFile):boolean=>file.name===name);
      if(target){if(target.bytes!==this.size(node.raw)||this.raw(this.root+'/'+name,target.bytes)!==node.raw)throw new Error('OUTBOX_ARCHIVE_CONFLICT');continue;}
      const partial=inventory.files.find((file:MaterialArchiveFile):boolean=>file.name===name+'.partial');
      peakBytes+=Math.max(0,this.size(node.raw)-(partial?.bytes||0));if(!partial)peakFiles++;
    }
    if(peakBytes>67108864||peakFiles>65536)throw new Error('OUTBOX_ARCHIVE_FULL');
    this.sameDirectory(inventory);
    if(!nodes.length)return;
    if(!inventory.identity){fs.mkdirSync(this.root);inventory.identity=this.directory(this.root);this.sameDirectory(inventory);}
    for(const node of nodes){
      this.sameDirectory(inventory);
      const path=this.root+'/'+node.sha256+'.bucket.json';
      if(fs.accessSync(path)){if(this.raw(path,this.size(node.raw))!==node.raw)throw new Error('OUTBOX_ARCHIVE_CONFLICT');continue;}
      const partial=path+'.partial';if(fs.accessSync(partial)){const stat=fs.lstatSync(partial);if(stat.isSymbolicLink()||!stat.isFile())throw new Error('OUTBOX_ARCHIVE_CORRUPT');}
      const bytes=new util.TextEncoder().encodeInto(node.raw),file=fs.openSync(partial,fs.OpenMode.CREATE|fs.OpenMode.WRITE_ONLY|fs.OpenMode.TRUNC);
      try{
        this.sameDirectory(inventory);
        let offset=0;while(offset<bytes.length){const written=fs.writeSync(file.fd,bytes.slice(offset).buffer);
          if(!Number.isSafeInteger(written)||written<=0||written>bytes.length-offset)throw new Error('OUTBOX_ARCHIVE_WRITE_FAILED');offset+=written;}
        fs.fsyncSync(file.fd);
      }finally{fs.closeSync(file);bytes.fill(0);}
      this.sameDirectory(inventory);
      if(this.raw(partial,this.size(node.raw))!==node.raw)throw new Error('OUTBOX_ARCHIVE_WRITE_FAILED');
      if(fs.accessSync(path)){if(this.raw(path,this.size(node.raw))!==node.raw)throw new Error('OUTBOX_ARCHIVE_CONFLICT');}
      else fs.renameSync(partial,path);
      this.sameDirectory(inventory);
    }
    this.sameDirectory(inventory);this.verify(heads);this.sameDirectory(inventory);
  }
}

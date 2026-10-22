export class LocalFollowRequest {cmd:string='';generation:number=0;sequence:number=0;directory:string='';pcm:Uint8Array=new Uint8Array(0);}
export class LocalFollowReply {type:string='';generation:number=0;sequence:number=0;text:string='';final:boolean=false;id:number=0;decodeMs:number=0;}

import path from 'node:path';
import {MaterialQueryClient,QueryError,readPrivateJson} from './client.mjs';

try{
  const [action,...args]=process.argv.slice(2),options={};
  const allowed={search:['config','from','to','keyword','speaker','limit','cursor'],get:['config','material-id','revision'],changes:['config','limit','cursor']};
  if(!allowed[action]||args.length%2)throw new QueryError('INVALID_ARGUMENTS');
  for(let i=0;i<args.length;i+=2){const key=args[i].slice(2);
    if(!args[i].startsWith('--')||!allowed[action].includes(key)||Object.hasOwn(options,key)||!args[i+1])throw new QueryError('INVALID_ARGUMENTS');
    options[key]=args[i+1];
  }
  if(!options.config)throw new QueryError('EXPLICIT_CONFIG_REQUIRED');
  const filename=path.resolve(options.config),config=readPrivateJson(filename);delete options.config;
  if(typeof config?.credential_file==='string')config.credential_file=path.resolve(path.dirname(filename),config.credential_file);
  for(const key of ['limit','revision'])if(options[key]!==undefined){
    if(!/^[1-9]\d*$/.test(options[key]))throw new QueryError('INVALID_ARGUMENTS');options[key]=Number(options[key]);
  }
  if(action==='get'){options.material_id=options['material-id'];delete options['material-id'];}
  const client=new MaterialQueryClient(config),result=await client[action](options);
  process.stdout.write(JSON.stringify({ok:true,...result})+'\n');
}catch(error){
  // Credentials, URLs, source text and network exception messages never enter errors.
  const safe=error instanceof QueryError?error:new QueryError('QUERY_FAILED');
  process.stderr.write(JSON.stringify({ok:false,error:safe.toJSON()})+'\n');process.exitCode=1;
}

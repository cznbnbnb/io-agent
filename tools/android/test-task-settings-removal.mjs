import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const root=path.resolve('rebuild/android-app'),out=fs.mkdtempSync(path.join(os.tmpdir(),'io-task-removal-'));
const stubs={
 'android/content/Context.java':'package android.content;public abstract class Context {public static final int MODE_PRIVATE=0;public java.io.File getFilesDir(){throw new UnsupportedOperationException();}public abstract SharedPreferences getSharedPreferences(String name,int mode);}',
 'android/content/SharedPreferences.java':'package android.content;public interface SharedPreferences {String getString(String k,String fallback);boolean contains(String k);Editor edit();interface Editor {Editor putString(String k,String v);default Editor remove(String k){return putString(k,null);}boolean commit();}}',
 'android/util/Base64.java':'package android.util;public final class Base64 {public static final int NO_WRAP=2;public static byte[] decode(String s,int f){return java.util.Base64.getDecoder().decode(s);}public static String encodeToString(byte[] b,int f){return java.util.Base64.getEncoder().encodeToString(b);}}',
 'android/security/keystore/KeyProperties.java':'package android.security.keystore;public final class KeyProperties {public static final String KEY_ALGORITHM_AES="AES",BLOCK_MODE_GCM="GCM",ENCRYPTION_PADDING_NONE="NoPadding";public static final int PURPOSE_ENCRYPT=1,PURPOSE_DECRYPT=2;}',
 'android/security/keystore/KeyGenParameterSpec.java':'package android.security.keystore;public final class KeyGenParameterSpec implements java.security.spec.AlgorithmParameterSpec {public String alias;public static final class Builder {final KeyGenParameterSpec value=new KeyGenParameterSpec();public Builder(String alias,int purpose){value.alias=alias;}public Builder setBlockModes(String...v){return this;}public Builder setEncryptionPaddings(String...v){return this;}public Builder setRandomizedEncryptionRequired(boolean v){return this;}public KeyGenParameterSpec build(){return value;}}}'
};
function run(cmd,args){const r=spawnSync(cmd,args,{encoding:'utf8',timeout:30000,maxBuffer:1048576});if(r.status!==0)throw Error(r.stderr||r.stdout||'Removal test failed');process.stdout.write(r.stdout);}
try{
 const files=[];for(const [name,text] of Object.entries(stubs)){const file=path.join(out,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);files.push(file);}
 files.push(path.join(root,'src/com/turboio/addon/TaskSettings.java'),'tools/android/MaterialSettingsTest.java','tools/android/TaskSettingsRemovalTest.java');
 run('javac',['-encoding','UTF-8','-d',out,'-sourcepath',[path.join(root,'src'),path.join(root,'upstream/android-addon/src'),out].join(path.delimiter),...files]);run('java',['-cp',out,'com.turboio.addon.TaskSettingsRemovalTest']);
}finally{fs.rmSync(out,{recursive:true,force:true});}

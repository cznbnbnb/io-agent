// DevEco 的 build-profile.json5 是 JSON5（无引号键、单引号、注释），PowerShell 的
// ConvertFrom-Json 无法解析。用 DevEco 自带的 json5 解析后输出严格 JSON。
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const deveco=process.env.DEVECO_HOME||'D:/APP/DevEcoStudio';
const JSON5=require(`${deveco}/sdk/default/openharmony/ets/build-tools/ets-loader/node_modules/json5`);
const source=process.argv[2];
if(!source)throw new Error('JSON5_SOURCE_REQUIRED');
process.stdout.write(JSON.stringify(JSON5.parse(fs.readFileSync(source,'utf8'))));

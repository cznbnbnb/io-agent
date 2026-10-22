import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../rebuild/android-app');
export const PRODUCT=Object.freeze(JSON.parse(fs.readFileSync(path.join(root,'product.json'),'utf8')));
if(PRODUCT.schema!==1||!/^\d+\.\d+\.\d+(?:-[a-z0-9]+)?$/.test(PRODUCT.version)||!Number.isSafeInteger(PRODUCT.version_code)||PRODUCT.version_code<=230||!/^iO-Agent-Android-[A-Za-z0-9.-]+$/.test(PRODUCT.apk_stem)||!/^[a-z0-9-]+$/.test(PRODUCT.revision)||PRODUCT.ota_writes_enabled!==false)throw new Error('Invalid product profile');
if(PRODUCT.official_ota_preparation!==undefined&&typeof PRODUCT.official_ota_preparation!=='boolean')throw new Error('Invalid official preparation profile');
if(PRODUCT.official_ota_guarded!==undefined&&typeof PRODUCT.official_ota_guarded!=='boolean'||PRODUCT.official_ota_guarded===true&&PRODUCT.official_ota_preparation===true)throw new Error('Invalid guarded OTA profile');
export const OFFICIAL_SOURCE_ROUTING=PRODUCT.official_ota_preparation===true||PRODUCT.official_ota_guarded===true;
export function productInfoSource(){return `package com.turboio.addon; final class ProductInfo { static final String VERSION="${PRODUCT.version}"; static final String REVISION="${PRODUCT.revision}"; static final boolean OTA_WRITES_ENABLED=${PRODUCT.ota_writes_enabled}; static final boolean OFFICIAL_OTA_PREPARATION=${PRODUCT.official_ota_preparation===true}; static final boolean OFFICIAL_OTA_GUARDED=${PRODUCT.official_ota_guarded===true}; }\n`;}
export function writeTestProductInfo(folder){const file=path.join(folder,'ProductInfo.java');fs.writeFileSync(file,productInfoSource());return file;}

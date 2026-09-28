import nextEnv from '@next/env';
import {spawnSync} from 'node:child_process';
nextEnv.loadEnvConfig(process.cwd(), true);
const required=['BUCKET','ENDPOINT','REGION','ACCESS_KEY_ID','SECRET_ACCESS_KEY','DOCUMENT_STORAGE_URL_STYLE'];
const missing=required.filter(k=>!process.env[k]?.trim());
if(missing.length){console.error('Missing storage setting names:',missing.join(', '));process.exitCode=1;}
else console.log('Required storage settings are present. Values were not printed.');
const scan=spawnSync(process.env.DOCUMENT_CLAMSCAN_PATH||'clamscan',['--version'],{encoding:'utf8'});
if(scan.status!==0){console.error('ClamAV is unavailable. Install it and update its virus database before uploading.');process.exitCode=1;}
else console.log(scan.stdout.trim());
console.log('This checks configuration presence only. A real upload is needed to verify bucket access and scanning.');

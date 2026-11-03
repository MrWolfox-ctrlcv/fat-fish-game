import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {report} from '../backend/survivor-metrics.mjs';
const path=process.argv[2];
if(!path||!existsSync(path))throw Error('Usage: node scripts/survivor-metrics-report.mjs EXISTING_DATABASE');
const db=new DatabaseSync(path,{readOnly:true});
try{console.log(JSON.stringify(report(db),null,2));}finally{db.close();}

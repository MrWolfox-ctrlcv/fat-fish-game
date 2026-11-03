import { reviewSurvivorOrder } from '../backend/survivor-order-review.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return [x.slice(2,i),x.slice(i+1)];}));
if(!args.db||!args.request) { console.error('Usage: node scripts/survivor-order-review.mjs --db=PATH --request=UUID [--decision=paid|unpaid --user=ID --quota=5000 --reference=LEDGER_REFERENCE --note="evidence"] [--apply=true]');process.exit(2); }
try { const out=reviewSurvivorOrder({dbPath:args.db,requestId:args.request,decision:args.decision,note:args.note,reference:args.reference,userId:Number(args.user),quota:Number(args.quota),dryRun:args.apply!=='true'}); console.log(JSON.stringify(out,null,2)); }
catch(e){console.error(e.message);process.exit(1);}

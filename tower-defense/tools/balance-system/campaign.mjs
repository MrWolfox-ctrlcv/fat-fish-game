import {writeFile} from 'node:fs/promises';
import {CAMPAIGN,planSpawns} from '../../src/freebuild/campaign.js';
import {ENEMIES} from '../../src/freebuild/data.js';
const rows=[];
for(let stage=1;stage<=8;stage++)for(const [difficulty,mult]of [['easy',.75],['normal',1],['hard',1.25]]){let income=CAMPAIGN[stage-1].gold;for(let i=0;i<CAMPAIGN[stage-1].budgets.length;i++){const w=planSpawns(stage,i,mult);const bounty=w.spawns.reduce((n,s)=>n+ENEMIES[s.type].coins,0),reward=Math.round(30+stage*8+i*(stage<5?5:18));income+=bounty+reward;const peak=Math.max(...w.spawns.map(s=>w.spawns.filter(q=>q.at>=s.at&&q.at<s.at+10).reduce((n,q)=>n+ENEMIES[q.type].price,0)));rows.push({stage,wave:i+1,difficulty,budget:w.budget,actualBudget:w.actualBudget,count:w.spawns.length,routeBudgets:w.routeBudgets,peak10:peak,bounty,clearReward:reward,cumulativeAvailable:income,counts:Object.fromEntries(w.types.map(t=>[t,w.spawns.filter(s=>s.type===t).length]))});}}
await writeFile(new URL('../../qa/release-v7/campaign-audit.json',import.meta.url),JSON.stringify({version:7,kind:'budget_audit_not_battle_test',earlyRewardsExcluded:true,rows},null,2));
console.log(JSON.stringify(rows.filter(r=>r.difficulty==='normal'&&r.wave===CAMPAIGN[r.stage-1].budgets.length).map(({stage,budget,cumulativeAvailable,count})=>({stage,finalWaveBudget:budget,cumulativeAvailable,count}))));

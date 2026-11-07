import {ENEMIES} from './data.js';
// Total threat per wave, not raw monster count. The same enemy stats apply on all difficulties.
export const CAMPAIGN=[
 {gold:260,budgets:[90,140,200,260,330,420],mixes:[{silly:1}]},
 {gold:350,budgets:[180,260,350,450,560,680,850],mixes:[{silly:1},{silly:.7,grok:.3},{silly:.55,grok:.45},{silly:.4,grok:.6},{silly:.45,grok:.55},{silly:.4,grok:.6},{silly:.4,grok:.42,grok_elite:.18}]},
 {gold:480,budgets:[280,360,460,580,720,880,1040,1250],mixes:[{silly:.7,gemma:.3},{gemma:.85,silly:.15},{gemma:.9,silly:.1},{gemma:.55,grok:.45},{gemma:.8,silly:.2},{gemma:.5,grok:.5},{gemma:.85,silly:.15},{gemma:.6,grok:.4}]},
 {gold:650,budgets:[420,540,680,850,1050,1250,1500,1800],mixes:[{gemma:.75,silly:.25},{gemma:.75,cat:.25},{gemma:.8,cat:.2},{gemma:.5,grok:.35,cat:.15},{gemma:.7,cat:.3},{gemma:.45,grok:.3,cat:.15,grok_elite:.1},{gemma:.7,cat:.3},{gemma:.5,cat:.2,grok:.15,grok_elite:.15}]},
 {gold:1000,budgets:[650,850,1100,1350,1650,2000,2400,2850],mixes:[{silly:.6,normal:.4},{normal:.5,gemma:.5},{normal:.4,grok:.4,cat:.2},{claude:.3,normal:.4,gemma:.3},{normal:.6,grok:.4},{claude:.32,normal:.5,grok:.18},{gemma:.55,cat:.15,normal:.3},{claude:.33,normal:.4,grok:.17,gpt_elite:.1}]},
 {gold:1400,budgets:[900,1200,1550,1900,2300,2800,3350,4000],mixes:[{normal:.5,gemma:.5},{claude:.3,normal:.35,grok:.35},{gemma:.7,cat:.3},{claude:.33,normal:.52,gpt_elite:.15},{normal:.6,gemma:.4},{claude:.35,grok:.3,normal:.35},{gemma:.5,claude:.3,cat:.2},{claude:.4,normal:.45,gpt_elite:.15}]},
 {gold:4200,budgets:[1600,2100,2700,3300,4000,4800,5700,6800],mixes:[{grok:.4,normal:.4,gemma:.2},{normal:.65,cat:.2,gpt_elite:.15},{claude:.3,normal:.35,grok:.35},{claude:.3,gemma:.7},{normal:.6,gemma:.25,cat:.15},{claude:.3,normal:.3,grok:.25,gpt_elite:.15},{gemma:.55,normal:.3,cat:.15},{claude:.35,normal:.4,gpt_elite:.15,grok_elite:.1}]},
 {gold:4800,budgets:[1900,2500,3200,3900,4700,5600,6600,7800],mixes:[{normal:.6,gemma:.4},{gemma:.8,cat:.2},{claude:.3,normal:.55,gpt_elite:.15},{claude:.35,grok:.3,normal:.35},{gemma:.5,normal:.35,cat:.15},{claude:.4,normal:.45,gpt_elite:.15},{claude:.3,grok:.35,normal:.25,grok_elite:.1},{claude:.35,normal:.3,gemma:.15,gpt_elite:.1,grok_elite:.1}]}
];
export function planSpawns(stage,index,multiplier=1,routes=stage<3?1:2){
 const c=CAMPAIGN[stage-1],budget=Math.round(c.budgets[index]*multiplier),shares=c.mixes[Math.min(index,c.mixes.length-1)],counts={};let spent=0,eliteSpent=0;
 for(const [type,share]of Object.entries(shares)){let count=Math.floor(budget*share/ENEMIES[type].price);if(type==='claude')count=Math.min(stage<7?4:7,count);if(ENEMIES[type].tier==='elite')count=Math.min(count,Math.max(0,Math.floor((budget*.2-eliteSpent)/ENEMIES[type].price)));counts[type]=count;spent+=count*ENEMIES[type].price;if(ENEMIES[type].tier==='elite')eliteSpent+=count*ENEMIES[type].price;}
 // Keep the accepted budget while capping very weak swarms to avoid object-count difficulty.
 if(counts.gemma>240){const excess=counts.gemma-240;counts.gemma=240;spent-=excess*ENEMIES.gemma.price;}
 const filler=stage===1?'silly':stage<5?'silly':'normal';counts[filler]=(counts[filler]||0)+Math.floor((budget-spent)/ENEMIES[filler].price);
 const duration=stage===1?22+index*3:stage===2?32+index*3:40+index*4,spawns=[],routeBudgets=Array(routes).fill(0),eliteLast=Array(routes).fill(-6);
 for(const [type,count]of Object.entries(counts)){const e=ENEMIES[type],columns=e.columns||2;let used=0,batch=0,packetRoute=0,totalBatches=Math.ceil(count/columns);
  while(used<count){const n=Math.min(columns,count-used),route=type==='gemma'&&batch%3?packetRoute:routeBudgets.indexOf(Math.min(...routeBudgets));packetRoute=route;let at=totalBatches===1?duration*.25:batch*duration/Math.max(1,totalBatches-1);
   // Mini squads arrive in three-row packets so AOE has real clusters to hit.
   if(type==='gemma'){const packets=Math.ceil(totalBatches/3);at=Math.floor(batch/3)*Math.max(1.8,(duration-.84)/Math.max(1,packets-1))+(batch%3)*.42;}
   if(e.tier==='elite'){at=Math.max(at,eliteLast[route]+6);eliteLast[route]=at;}
   for(let slot=0;slot<n;slot++){spawns.push({type,route,slot,at});routeBudgets[route]+=e.price;}used+=n;batch++;
  }
 }
 spawns.sort((a,b)=>a.at-b.at||a.route-b.route);return {budget,actualBudget:spawns.reduce((n,s)=>n+ENEMIES[s.type].price,0),routeBudgets,spawns,types:[...new Set(spawns.map(s=>s.type))]};
}

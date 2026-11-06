import {LEVELS} from './levels.js';import {DIFFICULTIES} from './difficulty.js';
export function normalizeProgress(saved,oldScores={}){const clears={};for(const l of LEVELS){const old=saved?.clears?.[l.id],row={};for(const id of Object.keys(DIFFICULTIES))if(old?.[id]===true)row[id]=true;if(!saved?.clears&&Number(oldScores?.[l.id])>0)row.normal=true;if(Object.keys(row).length)clears[l.id]=row;}return {schema:1,clears};}
export const stageCleared=(p,id)=>Object.values(p.clears[id]||{}).some(Boolean);
export function unlockedStage(p){let order=1;while(order<LEVELS.length&&stageCleared(p,LEVELS[order-1].id))order++;return order;}
export const canEnter=(p,id)=>{const l=LEVELS.find(l=>l.id===id);return !!l&&l.order<=unlockedStage(p);};
export function recordVictory(p,id,difficulty){if(!canEnter(p,id)||!DIFFICULTIES[difficulty])return p;return {...p,clears:{...p.clears,[id]:{...p.clears[id],[difficulty]:true}}};}
export const totalStars=p=>Object.values(p.clears).reduce((sum,row)=>sum+Object.values(row).filter(Boolean).length,0);
export const runKey=(id,difficulty='normal')=>id+':'+difficulty;

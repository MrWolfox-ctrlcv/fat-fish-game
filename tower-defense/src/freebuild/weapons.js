import {TOWERS} from './data.js';
// One layout drives both the equipment sprite and its projectile/beam origin.
export function weaponLayout(t){
 const size=TOWERS[t.type].size*25,whale=t.type==='whale';if(!whale&&t.type!=='kimi')return null;
 const width=whale?(t.branch==='giant'?96:t.branch==='sticky'?74:[54,64,72][Math.min(2,t.level-1)]):[48,54,60][Math.min(2,t.level-1)],flip=Math.cos(t.aim||0)<0;
 const x=t.x+size*.18,y=t.y+size*.18,recoil=Math.max(0,1-((t.renderTime??Infinity)-(t.attackAt??-Infinity))/.22)*3;
 return {key:whale?'whale':'kimi',tile:whale&&t.branch==='sticky'?3:Math.min(2,t.level-1),width,x,y,flip,characterX:t.x-size*.23,muzzle:{x:x+(flip?-1:1)*width*.32,y:y-width*.63},recoil};
}

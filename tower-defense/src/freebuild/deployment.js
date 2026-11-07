import {buildTower} from './engine.js';
export function normalizeControls(value={}){return {layout:value?.layout==='bottom'?'bottom':'left',speed:[1,2,3].includes(value?.speed)?value.speed:1};}
export const nextSpeed=speed=>speed===1?2:speed===2?3:1;
export function clearBuild(ui){ui.buildType=null;ui.placement=null;ui.anchor=null;}
export function selectBuild(ui,type){clearBuild(ui);ui.selected=null;ui.buildType=type;}
export function placeSelected(g,ui,x,y){if(!ui.buildType)return null;const tower=buildTower(g,ui.buildType,x,y);clearBuild(ui);return tower;}

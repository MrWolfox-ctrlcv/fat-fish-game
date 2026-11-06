import {WORLD} from './data.js';
export function createView(width,height,top=0,bottom=0,left=0){const available=Math.max(1,height-top-bottom),horizontal=Math.max(1,width-left);return {width,height,x:left,y:top,viewportWidth:horizontal,viewportHeight:available,scale:Math.min(horizontal/WORLD.width,available/WORLD.height),centerX:left+horizontal/2,centerY:top+available/2};}
export function toWorld(p,v,c){return {x:(p.x-v.centerX)/(v.scale*c.zoom)+c.x,y:(p.y-v.centerY)/(v.scale*c.zoom)+c.y};}
export function constrainCamera(v,c){const hx=Math.min(800,v.viewportWidth/(2*v.scale*c.zoom)),hy=Math.min(500,v.viewportHeight/(2*v.scale*c.zoom));c.x=Math.max(hx,Math.min(1600-hx,c.x));c.y=Math.max(hy,Math.min(1000-hy,c.y));}
export function toScreen(p,v,c){return {x:v.centerX+(p.x-c.x)*v.scale*c.zoom,y:v.centerY+(p.y-c.y)*v.scale*c.zoom};}
export function zoomCameraAt(v,c,p,zoom,anchor=toWorld(p,v,c)){c.zoom=Math.max(1,Math.min(4,zoom));c.x=anchor.x-(p.x-v.centerX)/(v.scale*c.zoom);c.y=anchor.y-(p.y-v.centerY)/(v.scale*c.zoom);constrainCamera(v,c);}

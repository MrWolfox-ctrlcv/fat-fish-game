import {toWorld,constrainCamera,zoomCameraAt} from './view.js';

// Pointer capture keeps a pinch from becoming an accidental build when either finger lifts.
export function installMapGestures(canvas,{getView,camera,onChange,onTap,onHover,onDoubleTap,shouldBox,onBox}){
 const pointers=new Map();let drag=null,pinch=null,suppressTap=false,lastTap=null,box=null;
 const point=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
 function rebase(){const points=[...pointers.values()];drag=null;pinch=null;
  if(points.length>=2){const [a,b]=points,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};pinch={distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),zoom:camera.zoom,anchor:toWorld(mid,getView(),camera)};suppressTap=true;}
  else if(points.length===1)drag={point:points[0],camera:{x:camera.x,y:camera.y}};
 }
 canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button!==0)return;if(!pointers.size){suppressTap=false;if(shouldBox?.())box={start:{clientX:e.clientX,clientY:e.clientY},id:e.pointerId};}pointers.set(e.pointerId,point(e));canvas.setPointerCapture(e.pointerId);rebase();});
 canvas.addEventListener('pointermove',e=>{
  if(!pointers.has(e.pointerId)){onHover?.(e);return;}if(box?.id===e.pointerId){onBox?.(box.start,e,false);suppressTap=true;return;}pointers.set(e.pointerId,point(e));const v=getView();
  if(pinch){const [a,b]=[...pointers.values()];if(!b)return;const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};zoomCameraAt(v,camera,mid,pinch.zoom*Math.hypot(a.x-b.x,a.y-b.y)/pinch.distance,pinch.anchor);onChange();}
  else if(drag){const p=pointers.get(e.pointerId);if(Math.hypot(p.x-drag.point.x,p.y-drag.point.y)>8)suppressTap=true;if(suppressTap){camera.x=drag.camera.x-(p.x-drag.point.x)/(v.scale*camera.zoom);camera.y=drag.camera.y-(p.y-drag.point.y)/(v.scale*camera.zoom);constrainCamera(v,camera);onChange();}}
 });
 function finish(e,cancel=false){if(!pointers.has(e.pointerId))return;if(box?.id===e.pointerId){if(!cancel)onBox?.(box.start,e,true);box=null;pointers.delete(e.pointerId);suppressTap=true;rebase();return;}const p=point(e);if(drag&&Math.hypot(p.x-drag.point.x,p.y-drag.point.y)>8)suppressTap=true;const tap=!cancel&&!suppressTap&&pointers.size===1;pointers.delete(e.pointerId);if(cancel)suppressTap=true;rebase();if(tap){const now=performance.now();if(lastTap&&now-lastTap.at<350&&Math.hypot(p.x-lastTap.x,p.y-lastTap.y)<22){lastTap=null;onDoubleTap?.(e);}else{lastTap={...p,at:now};onTap(e);}}}
 canvas.addEventListener('pointerup',e=>finish(e));canvas.addEventListener('pointercancel',e=>finish(e,true));canvas.addEventListener('lostpointercapture',e=>finish(e,true));
 canvas.addEventListener('pointerleave',()=>onHover?.(null));
 canvas.addEventListener('wheel',e=>{e.preventDefault();const v=getView(),unit=e.deltaMode===1?16:e.deltaMode===2?v.viewportHeight:1;zoomCameraAt(v,camera,point(e),camera.zoom*Math.exp(-Math.max(-600,Math.min(600,e.deltaY*unit))*.0015));if(pointers.size){suppressTap=true;rebase();}onChange();},{passive:false});
 const cancel=()=>{pointers.clear();drag=null;pinch=null;suppressTap=true;};
 canvas.ownerDocument?.addEventListener('visibilitychange',()=>{if(canvas.ownerDocument.hidden)cancel();});
 return {cancel};
}

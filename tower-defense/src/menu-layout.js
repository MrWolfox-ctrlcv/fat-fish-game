const clamp=(n,a,b)=>Math.max(a,Math.min(Math.max(a,b),n));

export function placeBuildMenu(point,bounds){
 const width=Math.min(352,bounds.width-16),available=bounds.bottom-bounds.top;
 const compact=available<228,cardWidth=width<326?70:80,cardHeight=compact?70:88;
 const height=compact?112:252,above=point.y-bounds.top>=174||point.y-bounds.top>=bounds.bottom-point.y;
 const anchorY=compact?(above?86:26):above?176:76;
 const left=clamp(point.x-width/2,8,bounds.width-width-8);
 const top=clamp(point.y-anchorY,bounds.top,bounds.bottom-height);
 const outer=width/2-cardWidth/2-4,inner=cardWidth/2+6,direction=above?-1:1;
 const offsets=compact?[-1.5,-.5,.5,1.5].map(n=>({x:n*(cardWidth+6),y:above?-45:43})):
  [{x:-outer,y:24*direction},{x:-inner,y:114*direction},{x:inner,y:114*direction},{x:outer,y:24*direction}];
 const slots=offsets.map(p=>({x:width/2+p.x-cardWidth/2,y:anchorY+p.y-cardHeight/2}));
 return {left,top,width,height,cardWidth,cardHeight,slots,compact,side:above?'above':'below',footerY:compact?(above?88:8):anchorY+(above?48:-48),anchorX:clamp(point.x-left,0,width)};
}

export function placeTowerMenu(point,bounds,width,height){
 const gap=34,roomAbove=point.y-bounds.top,roomBelow=bounds.bottom-point.y;
 let left=point.x-width/2,top=point.y-height-gap,side='above';
 if(roomAbove<height+gap){
  if(roomBelow>=height+gap){top=point.y+gap;side='below';}
  else if(point.x+width+50<bounds.width){left=point.x+50;top=point.y-height/2;side='right';}
  else{left=point.x-width-50;top=point.y-height/2;side='left';}
 }
 left=clamp(left,8,bounds.width-width-8);top=clamp(top,bounds.top,bounds.bottom-height);
 return {left,top,side,anchorX:clamp(point.x-left,22,width-22)};
}

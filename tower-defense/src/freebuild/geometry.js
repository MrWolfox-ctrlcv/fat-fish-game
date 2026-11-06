export function makeRoute(control,corner=60){
 const nodes=control.map(([x,y])=>({x,y})),points=[nodes[0]],distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
 const line=p=>{const a=points.at(-1),n=Math.max(1,Math.ceil(distance(a,p)/8));for(let j=1;j<=n;j++)points.push({x:a.x+(p.x-a.x)*j/n,y:a.y+(p.y-a.y)*j/n});};
 for(let i=1;i<nodes.length-1;i++){const a=nodes[i-1],b=nodes[i],c=nodes[i+1],ab=distance(a,b),bc=distance(b,c),dot=((b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y))/(ab*bc);if(dot>.9999){line(b);continue;}const r=Math.min(corner,ab*.45,bc*.45),p={x:b.x+(a.x-b.x)*r/ab,y:b.y+(a.y-b.y)*r/ab},q={x:b.x+(c.x-b.x)*r/bc,y:b.y+(c.y-b.y)*r/bc};line(p);for(let j=1;j<=20;j++){const t=j/20;points.push({x:(1-t)**2*p.x+2*(1-t)*t*b.x+t*t*q.x,y:(1-t)**2*p.y+2*(1-t)*t*b.y+t*t*q.y});}}
 line(nodes.at(-1));let length=0;points.forEach((p,i)=>{if(i)length+=distance(points[i-1],p);p.distance=length;});
 function atDistance(d){d=Math.max(0,Math.min(length,d));let lo=0,hi=points.length-1;while(lo<hi){const m=(lo+hi)>>1;if(points[m].distance<d)lo=m+1;else hi=m;}const b=points[lo],a=points[Math.max(0,lo-1)],t=(d-a.distance)/(b.distance-a.distance||1);return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,angle:Math.atan2(b.y-a.y,b.x-a.x)};}
 function nearest(x,y){let best=null,min=Infinity;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1))),px=a.x+dx*t,py=a.y+dy*t,d=Math.hypot(x-px,y-py);if(d<min){min=d;best={x:px,y:py,distance:a.distance+(b.distance-a.distance)*t,gap:d};}}return best;}
 return {points,length,atDistance,nearest};
}

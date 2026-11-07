export const foxOrigin=t=>({x:t.x+24,y:t.y+10});
export function hitFox(t,x,y){if(t.branch!=='egg')return false;const f=foxOrigin(t);return Math.abs(x-f.x)<=16&&y>=f.y-32&&y<=f.y+6;}
export function aimFox(t,target){if(!target)return;const f=foxOrigin(t);t.foxAim=Math.atan2(target.y-f.y,target.x-f.x);}

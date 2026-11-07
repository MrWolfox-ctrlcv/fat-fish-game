// Pure geometry shared by combat, aiming and the numeric planning tools.
export function blastWeight(distance,radius,profile){
 if(distance>radius)return 0;if(!profile||radius<=0)return 1;
 const q=Math.max(0,distance/radius),core=profile.coreFraction,edge=profile.edgeMultiplier;
 return q<=core?1:1-(1-edge)*(q-core)/(1-core);
}
export function blastHitWeight(distance,radius,bodyRadius,profile){
 return distance>radius+bodyRadius?0:blastWeight(Math.min(distance,radius),radius,profile);
}
export function blastAreaMean(profile){
 if(!profile)return 1;const a=profile.coreFraction;
 return 1-(1-profile.edgeMultiplier)/(1-a)*(2/3-a+a*a*a/3);
}

// Fixed layouts never consume the combat RNG. Only three breakable nodes and
// one hazard clock are saved; decorative scenery stays in this shared catalog.
const layouts = [
  { id:'coral', name:'浅湾珊瑚', subtitle:'绕开海草，借喷流甩掉追兵。', floor:'#163f50', tint:'#3f9c9a', accent:'#8fe4cf', rock:'#f1a394', foliage:'#64bca3', terrainName:'海草滩', slow:.76, decor:'coral' },
  { id:'moon', name:'月光菌林', subtitle:'菌丛拖慢脚步，紫色喷流会伤及双方。', floor:'#242b4c', tint:'#7552a0', accent:'#d1bdff', rock:'#beadf1', foliage:'#6e84c6', terrainName:'孢子丛', slow:.72, decor:'mushroom' },
  { id:'harbor', name:'沉船港口', subtitle:'打碎货舱里的经验晶簇，留意泄压管。', floor:'#263c43', tint:'#9d7953', accent:'#edc68e', rock:'#b78968', foliage:'#637d79', terrainName:'淤泥滩', slow:.78, decor:'cargo' },
  { id:'abyss', name:'深渊熔炉', subtitle:'最后五轮，利用热泉对付密集敌群。', floor:'#352b43', tint:'#a64e53', accent:'#ffc487', rock:'#8e657c', foliage:'#cf7668', terrainName:'冷凝池', slow:.74, decor:'chimney' },
];
export const MAPS = Object.freeze(layouts.map((map,i) => Object.freeze({ ...map,
  terrain: Object.freeze([{x:620+i*75,y:600,radius:155},{x:1810-i*60,y:1100,radius:180},{x:1940,y:400+i*45,radius:115}]),
  vents: Object.freeze([{x:1030-i*35,y:410+i*35,radius:78,offset:0},{x:1720+i*30,y:920-i*30,radius:88,offset:4}]),
  nodes: Object.freeze([{id:'west',x:640,y:1080,radius:25},{id:'east',x:1900,y:660,radius:25},{id:'north',x:1260,y:290,radius:25}]),
  decorations: Object.freeze(Array.from({length:28},(_,j)=>({x:140+(j*347+i*83)%2280,y:140+(j*193+i*71)%1320,size:22+(j*17)%33,variant:j%3}))),
})));
export function mapForRound(round=1) { return MAPS[Math.min(3,Math.max(0,Math.floor(((Number(round)||1)-1)/5)))]; }
export function createScene(round=1) {
  const map=mapForRound(round);
  return { mapId:map.id, nextPulseAt:0, nodes:map.nodes.map(node=>({...node,hp:32,maxHp:32})) };
}
export function ensureScene(game) {
  const map=mapForRound(game.round);
  if(!game.scene||game.scene.mapId!==map.id||!Array.isArray(game.scene.nodes))game.scene=createScene(game.round);
  return game.scene;
}
export function terrainFactor(game,actor) {
  const map=mapForRound(game.round);
  return map.terrain.some(t=>(actor.x-t.x)**2+(actor.y-t.y)**2<t.radius**2)?map.slow:1;
}
export function ventPhase(time,vent) {
  const clock=((time+vent.offset)%12+12)%12;
  return clock>=9.5? 'idle':clock>=7.5?'active':clock>=6?'warning':'idle';
}

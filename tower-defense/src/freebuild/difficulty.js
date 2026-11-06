export const DIFFICULTIES={easy:{id:'easy',name:'简单',hp:.75,damage:.8,spawnInterval:1.15,gold:1.2},normal:{id:'normal',name:'普通',hp:1,damage:1,spawnInterval:1,gold:1},hard:{id:'hard',name:'困难',hp:1.25,damage:1.2,spawnInterval:.85,gold:.9}};
export const difficultyFor=id=>DIFFICULTIES[id]||DIFFICULTIES.normal;

// Difficulty changes the enemy budget, never several hidden stat multipliers at once.
export const DIFFICULTIES={easy:{id:'easy',name:'简单',budget:.75,hp:1,damage:1,spawnInterval:1,gold:1},normal:{id:'normal',name:'普通',budget:1,hp:1,damage:1,spawnInterval:1,gold:1},hard:{id:'hard',name:'困难',budget:1.25,hp:1,damage:1,spawnInterval:1,gold:1}};
export const difficultyFor=id=>DIFFICULTIES[id]||DIFFICULTIES.normal;

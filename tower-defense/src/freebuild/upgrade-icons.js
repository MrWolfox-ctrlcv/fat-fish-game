import {ART} from '../art-assets.js';

// A single shared atlas for all upgrades, research and paid troop production.
export function upgradeIcon(key, fallback='') {
  const atlas=ART.upgrades, index=atlas?.keys.indexOf(key);
  if(index===undefined||index<0)return fallback;
  const x=index%atlas.columns/(atlas.columns-1)*100;
  const y=Math.floor(index/atlas.columns)/(atlas.rows-1)*100;
  return '<span class="ability-art" data-ability-icon="'+key+'" aria-hidden="true" style="background-image:url(\''+atlas.file+'\');background-size:'+atlas.columns*100+'% '+atlas.rows*100+'%;background-position:'+x+'% '+y+'%"></span>';
}

import { CHARACTER_SPRITES, STAGE_SPRITES, ASTRA_SPRITES, NEW_FISH_SPRITES, DOUBAO_SPRITES, NEW_EASTER_SPRITES } from '../dist/character-art.js';

export function getArtRects() {
  const rects = new Map();
  CHARACTER_SPRITES.forEach((rect, i) => rects.set(`maid:${i + 1}`, ['maids', rect]));
  STAGE_SPRITES.forEach(([id, level, rect]) => rects.set(`${id}:${level}`, ['stages', rect]));
  ASTRA_SPRITES.forEach(([level, rect]) => rects.set(`gpt-astra:${level}`, ['astra', rect]));
  NEW_FISH_SPRITES.forEach(([id, level, rect]) => rects.set(`${id}:${level}`, ['newFish', rect]));
  DOUBAO_SPRITES.forEach(([level, rect]) => rects.set(`doubao:${level}`, ['doubao', rect]));
  NEW_EASTER_SPRITES.forEach(([id, level, rect]) => rects.set(`${id}:${level}`, ['newEaster', rect]));
  return rects;
}

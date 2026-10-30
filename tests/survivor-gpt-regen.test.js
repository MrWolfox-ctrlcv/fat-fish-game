import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame, stepGame, performAction } from '../survival/engine.js';

test('GPT energy passively recovers and transformed net drain matches previous rate',()=>{
  const g=createGame({hero:'gpt'});g.player.energy=50;g.spawnTimer=100;g.chestTimer=100;
  stepGame(g,{},.05);assert.ok(Math.abs(g.player.energy-50.04)<1e-9);
  performAction(g,{type:'primary'});assert.equal(g.player.transformed,true);
  const before=g.player.energy;stepGame(g,{},.05);
  assert.ok(Math.abs(g.player.energy-(before-.4))<1e-9);
});

test('GPT energy clamps at cap and does not recover while phase is paused for choices',()=>{
  const g=createGame({hero:'gpt'});g.player.energy=99.99;g.spawnTimer=100;g.chestTimer=100;
  stepGame(g,{},.05);assert.equal(g.player.energy,100);
  g.phase='trait';g.player.energy=30;stepGame(g,{},.05);assert.equal(g.player.energy,30);
});

test('manual transform off restores base form without changing health or energy',()=>{
  const g=createGame({hero:'gpt'});g.player.energy=60;g.spawnTimer=100;g.chestTimer=100;
  performAction(g,{type:'primary'});g.player.health=37;g.player.energy=42;g.player.toolNodeTimer=2;
  const result=performAction(g,{type:'transform-off'});
  assert.equal(g.player.transformed,false);assert.equal(g.player.health,37);assert.equal(g.player.energy,42);
  assert.equal(g.player.toolNodeTimer,0);assert.equal(result[0]?.type,'gpt-transform-off');
});

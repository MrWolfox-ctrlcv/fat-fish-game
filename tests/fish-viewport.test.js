import test from 'node:test';
import assert from 'node:assert/strict';
import { createFishViewport } from '../dist/fish-viewport.js';

test('canvas context and backing-store resets restore the same fish size without resizing the tank',()=>{
 let reads=0,matrix=[],dpr=2,rect={width:480,height:620};
 const canvas={width:480,height:620,getBoundingClientRect:()=>{reads++;return rect;}},ctx={setTransform:(...m)=>{matrix=m;}};
 const viewport=createFishViewport(canvas,ctx,{pixelRatio:()=>dpr});viewport.sync();const original=[...matrix],count=reads;
 matrix=[1,0,0,1,0,0];viewport.apply();assert.deepEqual(matrix,original);assert.equal(reads,count);
 canvas.width=300;canvas.height=150;viewport.apply();assert.deepEqual([canvas.width,canvas.height],[960,1240]);assert.deepEqual(matrix,original);
 assert.deepEqual(rect,{width:480,height:620});
 dpr=1;viewport.sync();assert.equal(matrix[0],1);assert.equal(matrix[3],1);
 rect={width:360,height:465};viewport.sync();assert.equal(viewport.state.scale,.75);assert.deepEqual([canvas.width,canvas.height],[360,465]);
});

test('letterbox input scale uses the actual canvas content box and ignores zero-size transients',()=>{
 let rect={width:600,height:620};const canvas={width:480,height:620,getBoundingClientRect:()=>rect};
 const viewport=createFishViewport(canvas,{setTransform(){}},{pixelRatio:()=>1.5});
 const view=viewport.sync();assert.deepEqual([view.scale,view.offsetX,view.offsetY],[1,60,0]);
 assert.equal((300-view.offsetX)/view.scale,240);
 rect={width:0,height:0};assert.deepEqual(viewport.sync(),view);
});

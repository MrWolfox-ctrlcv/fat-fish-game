import sharp from 'sharp';import {fileURLToPath} from 'node:url';import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),dir=new URL('art/effects-v1/',root),out=new URL('assets/effects-v1/',root),qa=new URL('qa/release-v12/',root);
for(const p of [dir,out,qa])await mkdir(p,{recursive:true});
const source=new URL('poison-source.png',dir),input=process.argv[2];if(!input)throw Error('Pass the ImageGen sprite-sheet file path');await copyFile(input,source);
const bytes=await readFile(source),meta=await sharp(bytes).metadata();if(!meta.hasAlpha||meta.width/4!==meta.height/2)throw Error('Expected transparent 4x2 sheet');
const cell=448,sheet=await sharp(bytes).resize(1792,896).png().toBuffer(),frames=[],raw=[];
for(let i=0;i<8;i++){const frame=await sharp(sheet).extract({left:(i%4)*cell+Math.round(cell*.05),top:Math.floor(i/4)*cell+Math.round(cell*.05),width:Math.round(cell*.9),height:Math.round(cell*.9)}).resize(128,128).ensureAlpha().png().toBuffer();frames.push(frame);raw.push(await sharp(frame).raw().toBuffer());}
await sharp({create:{width:512,height:256,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(frames.map((input,i)=>({input,left:i%4*128,top:Math.floor(i/4)*128}))).webp({quality:90,alphaQuality:100,effort:6}).toFile(fileURLToPath(new URL('poison-puddle.webp',out)));
await sharp(Buffer.concat(raw),{raw:{width:128,height:1024,channels:4,pageHeight:128}}).gif({loop:0,delay:Array(8).fill(125),colours:96}).toFile(fileURLToPath(new URL('poison-loop.gif',qa)));
const packed=await readFile(new URL('poison-puddle.webp',out)),animation=await sharp(fileURLToPath(new URL('poison-loop.gif',qa))).metadata();if(animation.pages!==8)throw Error('Missing animation frames');
const report={generator:'image_gen.imagegen',source:'art/effects-v1/poison-source.png',sourceSha256:createHash('sha256').update(bytes).digest('hex'),file:'assets/effects-v1/poison-puddle.webp',sha256:createHash('sha256').update(packed).digest('hex'),bytes:packed.length,frame:128,columns:4,rows:2,frames:8,fps:8,contentFraction:.9,transparent:true,processing:'Fixed equal-cell extraction and format conversion only; no painted content added.',preview:'qa/release-v12/poison-loop.gif'};
await writeFile(new URL('poison-manifest.json',dir),JSON.stringify(report,null,2));console.log(JSON.stringify(report));

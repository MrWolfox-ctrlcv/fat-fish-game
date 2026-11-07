import sharp from 'sharp';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=new URL('../',import.meta.url),art=new URL('art/upgrades-v1/',root),out=new URL('assets/upgrades-v1/',root);
for(const dir of [art,out])await mkdir(dir,{recursive:true});
const input=process.argv[2];if(!input)throw Error('Pass the ImageGen 5x5 icon sheet path');
const source=new URL('source.png',art);await copyFile(input,source);
const bytes=await readFile(source),meta=await sharp(bytes).metadata();
if(!meta.hasAlpha||meta.width!==meta.height)throw Error('Expected square transparent atlas');
const columns=5,rows=5,frame=128;
// Keep the generator's uniform cells: only resample and encode, never redraw.
await sharp(bytes).resize(columns*frame,rows*frame).webp({quality:93,alphaQuality:100,effort:6}).toFile(fileURLToPath(new URL('icons.webp',out)));
const packed=await readFile(new URL('icons.webp',out));
const keys=['glm','kimi','whale','qwen','egg','x','sticky','giant','small','large','egg_count','egg_venom','egg_coupon','sticky_side','sticky_burn','sticky_loader','x_speed','x_shield','x_pierce','giant_cluster','giant_crush','giant_bombard','produce_small','produce_normal','produce_large'];
const manifest={generator:'image_gen.imagegen',source:'art/upgrades-v1/source.png',sourceSha256:createHash('sha256').update(bytes).digest('hex'),file:'assets/upgrades-v1/icons.webp',sha256:createHash('sha256').update(packed).digest('hex'),bytes:packed.length,columns,rows,frame,transparent:true,keys,processing:'Uniform whole-sheet resizing and WebP encoding only; no painted content added.'};
await writeFile(new URL('manifest.json',art),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));

// Export the approved cutout at a bounded display resolution; no artwork changes.
import { readFile, writeFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
if (!process.argv[2]) throw new Error('Pass the approved transparent portrait PNG');
const source = PNG.sync.read(await readFile(process.argv[2]));
const scale = Math.min(1, 384 / Math.max(source.width, source.height));
const width = Math.round(source.width * scale), height = Math.round(source.height * scale);
const output = new PNG({ width, height });
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const sx = Math.max(0, Math.min(source.width - 1, (x + .5) / scale - .5));
  const sy = Math.max(0, Math.min(source.height - 1, (y + .5) / scale - .5));
  const x0 = Math.floor(sx), y0 = Math.floor(sy), dx = sx - x0, dy = sy - y0;
  const samples = [[x0,y0,(1-dx)*(1-dy)], [Math.min(x0+1,source.width-1),y0,dx*(1-dy)], [x0,Math.min(y0+1,source.height-1),(1-dx)*dy], [Math.min(x0+1,source.width-1),Math.min(y0+1,source.height-1),dx*dy]];
  let alpha = 0; const color = [0,0,0];
  for (const [xx,yy,weight] of samples) {
    const i = (yy * source.width + xx) * 4, a = source.data[i+3] / 255 * weight;
    alpha += a; for (let c=0;c<3;c++) color[c] += source.data[i+c] * a;
  }
  const i = (y * width + x) * 4;
  for (let c=0;c<3;c++) output.data[i+c] = alpha ? Math.round(color[c] / alpha) : 0;
  output.data[i+3] = Math.round(alpha * 255);
}
const encoded = PNG.sync.write(output);
await writeFile(new URL('../dist/companion-portrait.png', import.meta.url), encoded);
console.log(`Approved transparent portrait: ${width}×${height}, ${encoded.length} bytes`);

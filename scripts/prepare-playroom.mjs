import { readdir, mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.argv[2]) throw new Error('Usage: node scripts/prepare-playroom.mjs <playroom-source-directory>');
const source = resolve(process.argv[2]);
const target = fileURLToPath(new URL('../playroom/', import.meta.url));
const names = (await readdir(source, { recursive: true })).map((name) => name.replaceAll('\\', '/'))
  .filter((name) => /^(index\.html|style\.css|wardrobe\.css|companion-account\.css|companion-corner\.css|src\/(?:modes\/)?[a-z-]+\.js)$/.test(name));
if (!names.includes('index.html') || !names.includes('src/wardrobe.js')) throw new Error('Incomplete playroom sources');
for (const name of names) {
  const output = resolve(target, name);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(source, name), output);
}
for (const [from, to] of [
  ['public/scripts/prepare-arena-art.mjs', '../scripts/prepare-arena-art.mjs'],
  ['dist/games-index.html', '../dist/games-index.html'],
  ['dist/games-hub.css', '../dist/games-hub.css'],
]) {
  const output = resolve(target, to);
  await mkdir(dirname(output), { recursive: true });
  await copyFile(resolve(source, from), output);
}
const portraitRoot = resolve(target, 'portraits');
await mkdir(portraitRoot, { recursive: true });
for (const name of ['deepseek', 'gptNormal', 'claude', 'gemini', 'doubao', 'qwen', 'kimi', 'grok']) {
  await copyFile(resolve(source, `public/portraits/${name}.png`), resolve(portraitRoot, `${name}.png`));
}
const testRoot = fileURLToPath(new URL('../tests/playroom/', import.meta.url));
await mkdir(testRoot, { recursive: true });
for (const name of await readdir(resolve(source, 'tests'))) {
  if (!/^[a-z-]+\.test\.js$/.test(name)) continue;
  const code = (await readFile(resolve(source, 'tests', name), 'utf8'))
    .replaceAll('../src/', '../../playroom/src/')
    .replaceAll('../../fat-fish-game/backend/', '../../backend/')
    .replaceAll('"../backend/', '"../../backend/')
    .replaceAll("'../backend/", "'../../backend/");
  await writeFile(resolve(testRoot, name), code);
}
console.log(`Prepared ${names.length} public playroom files and their regression tests; artwork stays in one shared store.`);

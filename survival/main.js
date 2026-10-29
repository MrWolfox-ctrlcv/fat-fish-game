import { createGame, stepGame, performAction, choose, continueRound, useItem, itemInfo, getStats, DIFFICULTIES, CATALOG } from './engine.js';
import { HEROES } from './heroes.js';
import { createRenderer } from './render.js';
import { createCloudSaves } from './cloud-saves.js';
import { createMusic } from './music.js';

const $ = (id) => document.getElementById(id);
const canvas = $('field');
const renderer = createRenderer(canvas);
const asset = path => new URL(path,import.meta.url).href;
let astraUnlocked = false;
try { astraUnlocked = localStorage.getItem('survivor.astra-unlocked.v1') === '1'; } catch {}
let selectedHero = 'deepseek';
let selectedDifficulty='standard',cloudLocked=false;
const music=createMusic();
const heroCopy = {
  deepseek: {portrait:'survival-avatar.png',title:'从小肥鱼，慢慢吃大。',description:'吃饭填满肥胖条才会长大。越肥越耐打、冲撞越狠，滑行也越难控制。偷吃只有一半回血。'},
  gemini: {portrait:'enemy/gemini.png',title:'故障机器猫，闪一下。',description:'跑得快，射得快，生命较少。闪现穿过危险；宝箱开出 Chrome 球，使用后获得三次护盾，持续八秒。'},
  gpt: {portrait:'enemy/gptSilly.png',title:'先攒能量，再恢复正常。',description:'基础形态很弱。经验同时充能与升级，20 能量起可变身正常 GPT，保留当前血量；正常形态可调用防御工具。重置卷回满能量。'},
  astra: {portrait:'enemy/astra.png',title:'满血 Astra，登场。',description:'以 GPT 通关后的奖励角色。高伤害、厚血量，移速稍慢；星爆打击身边敌人，核心道具可以重置冷却。'},
};
let game = createGame({ seed: Date.now() >>> 0, hero:selectedHero,difficulty:selectedDifficulty });
let started = false, paused = false, last = 0, accumulator = 0, lastHud = 0, lastDraw = 0, overlayKey = '';
let aim = null, touch = null, noticeUntil = 0;
const keys = new Set();
let focusMode = false;
let musicActive=false;
function setFocus(value) {
  focusMode = value; document.body.classList.toggle('focus-mode',value); clearInput();
  requestAnimationFrame(()=>renderer.resize());
}
const input = () => ({ moveX: touch?.x ?? ((keys.has('d') || keys.has('arrowright') ? 1 : 0) - (keys.has('a') || keys.has('arrowleft') ? 1 : 0)), moveY: touch?.y ?? ((keys.has('s') || keys.has('arrowdown') ? 1 : 0) - (keys.has('w') || keys.has('arrowup') ? 1 : 0)), ...(aim ? { aimX: aim.x, aimY: aim.y } : {}) });
const active = () => started && !paused && !cloudLocked && !document.hidden && game.phase === 'playing';
const clearInput = () => { keys.clear(); touch = null; aim = null; $('stick').hidden = true; };
function eventFeedback(events = []) {
  if (!Array.isArray(events)) return;
  for (const event of events) {
    const message = event.text || (event.type === 'item-collected' ? `${HEROES[game.heroId].itemName}已收好，按 1 使用` : event.type === 'auto-rice' ? `偷吃白饭！恢复 ${Math.ceil(event.healed)} 点生命` : event.type === 'item-used' ? event.healed != null ? `恢复 ${Math.ceil(event.healed)} 点生命` : `${HEROES[game.heroId].itemName}已使用` : event.type==='gpt-transform'?'正常 GPT，恢复上线！':'');
    if (message && !['hit','kill','serve'].includes(event.type)) { $('notice').textContent = message; noticeUntil = performance.now() + 2200; }
  }
}
function skill() { if (active()) { eventFeedback(performAction(game, { type: 'primary', ...input() })); updateHud(); } }
function eatRice() { if (active()) { eventFeedback(useItem(game,1)); updateHud(); } }
function reset() {
  if (started && !['won','lost'].includes(game.phase) && !confirm('结束当前局，重新开始？')) return;
  game = createGame({ seed: Date.now() >>> 0, hero:selectedHero,difficulty:selectedDifficulty }); started = false; paused = false; clearInput(); overlayKey = ''; refreshOverlay(); updateHud();
}
function renderHeroPicker() {
  const picker=$('hero-picker');picker.replaceChildren();
  for(const [id,hero] of Object.entries(HEROES)){
    const b=document.createElement('button');b.type='button';b.dataset.hero=id;b.className='hero-option';b.setAttribute('aria-pressed',String(id===selectedHero));
    b.disabled=id==='astra'&&!astraUnlocked;
    const name=document.createElement('strong');name.textContent=hero.name;
    const desc=document.createElement('small');desc.textContent=b.disabled?'使用 GPT 通关解锁':heroCopy[id].title;
    b.append(name,desc);b.onclick=()=>{selectedHero=id;game=createGame({seed:Date.now()>>>0,hero:id,difficulty:selectedDifficulty});overlayKey='';refreshOverlay();updateHud();};picker.append(b);
  }
}
function button(label, action, choice) {
  const b = document.createElement('button');
  if (choice) {
    b.className = 'choice';
    if(choice.rarity){b.dataset.rarity=choice.rarity.id;b.style.borderColor=choice.rarity.color;const badge=document.createElement('span');badge.className='rarity-badge';badge.style.color=choice.rarity.color;badge.textContent=choice.rarity.label;b.append(badge);}
    const icon = document.createElement('span'); icon.className = game.phase === 'reward' ? 'symbol loot-reward' : 'symbol'; icon.textContent = game.phase === 'reward' ? '' : choice.icon || '✦';
    const title = document.createElement('strong'); title.textContent = choice.name;
    const details = document.createElement('small'); details.textContent = choice.description;
    b.append(icon, title, details);
  } else b.textContent = label;
  b.onclick = () => { action(); clearInput(); accumulator = 0; overlayKey = ''; refreshOverlay(); updateHud(); if ($('overlay').hidden) canvas.focus({preventScroll:true}); };
  return b;
}
function renderStats() {
  const stats=getStats(game),panel=$('pause-stats');panel.replaceChildren();
  const heading=document.createElement('h2');heading.textContent='当前角色属性';panel.append(heading);
  const grid=document.createElement('dl');grid.className='stats-grid';
  for(const item of stats.entries){const pair=document.createElement('div'),label=document.createElement('dt'),value=document.createElement('dd');label.textContent=item.label;value.textContent=`${typeof item.value==='number'?Math.round(item.value*100)/100:item.value}${item.unit||''}`;pair.append(label,value);grid.append(pair);}panel.append(grid);
  const odds=document.createElement('p');odds.className='rarity-odds';odds.textContent=`当前幸运 ${Math.round(game.player.luck)} · 抽选概率：${stats.weights.map(w=>`${w.label} ${w.percent}%`).join(' / ')}`;panel.append(odds);
  const weapons=document.createElement('p');weapons.textContent=stats.weapons.length?`已装备武器：${stats.weapons.map(w=>`${w.name} Lv.${w.level}`).join('、')}`:'尚未装备额外武器。';panel.append(weapons);
}
function refreshOverlay() {
  if(game.phase==='won'&&game.heroId==='gpt'&&!astraUnlocked){astraUnlocked=true;try{localStorage.setItem('survivor.astra-unlocked.v1','1');}catch{}}
  const phase = !started ? 'welcome' : paused ? 'paused' : game.phase;
  const nextKey = `${phase}:${game.heroId}:${astraUnlocked}:${game.round}:${(game.choices || []).map(c => c.id).join(',')}`;
  if (overlayKey === nextKey) return;
  overlayKey = nextKey;
  $('overlay').hidden = phase === 'playing';
  $('pause').textContent = paused ? '继续' : '暂停';
  $('focus-pause').textContent = paused ? '继续' : '暂停';
  $('pause-stats').hidden=phase!=='paused';if(phase==='paused')renderStats();
  if (phase === 'playing') return;
  clearInput();
  $('hero-picker').hidden=phase!=='welcome';if(phase==='welcome')renderHeroPicker();
  $('difficulty-picker').hidden=phase!=='welcome';
  const texts = {
    welcome: [`${HEROES[game.heroId].name} · ${game.playerFaction==='cn'?'国模':'美国模型'}阵营`, heroCopy[game.heroId].title, heroCopy[game.heroId].description],
    paused: ['歇一会儿', '饭可以慢慢吃。', '战斗已暂停。准备好了就继续。'],
    trait: ['经验升级 · 三选一', '这次，往哪儿长？', '选一项特性，塑造本局的战斗方式。选择期间战斗暂停。'],
    reward: [`第 ${game.round} 轮完成 · 装备三选一`, '给下一轮，添点底气。', '本轮剩余经验已收好。免费选一件装备，效果持续到本局结束。'],
    rest: ['轮间休整', game.round === 10 ? '收工，开饭。' : `下一轮，${20 + game.round * 5} 秒。`, '调整好状态再出发。道具商店将在后续接入，当前不产生费用。'],
    won: ['十轮通关', `${HEROES[game.heroId].name}，挑战完成！`, game.heroId==='gpt'?'已在当前浏览器解锁 Astra！选择主角即可使用。':'使用 GPT 通关，可在当前浏览器解锁 Astra。'],
    lost: ['本局结束', '先回去吃碗饭。', `坚持到第 ${game.round} 轮 · 成长 Lv.${game.level} · 击破 ${game.kills}。换个构筑再来。`],
  };
  const [kicker, title, description] = texts[phase] || ['休整', '稍作调整。', ''];
  $('overlay-kicker').textContent = kicker; $('overlay-title').textContent = title; $('overlay-description').textContent = description;
  const choices = $('choices'); choices.replaceChildren(); choices.classList.toggle('single', !['trait','reward'].includes(phase));
  if (phase === 'trait' || phase === 'reward') for (const c of game.choices || []) choices.append(button('', () => eventFeedback(choose(game, c.id)), c));
  else if (phase === 'rest') choices.append(button(game.round === 10 ? '完成本局' : '下一轮 →', () => eventFeedback(continueRound(game))));
  else if (phase === 'welcome') choices.append(button('开始挑战 →', () => { started = true; }));
  else if (phase === 'paused') choices.append(button('继续战斗 →', () => { paused = false; }));
  else choices.append(button('再来一局 →', reset));
  requestAnimationFrame(() => choices.querySelector('button')?.focus({preventScroll:true}));
}
function updateHud() {
  const p = game.player;
  const hero=HEROES[game.heroId],copy=heroCopy[game.heroId],info=itemInfo(game);
  $('round').textContent = `${String(game.round).padStart(2,'0')} / 10`;
  $('timer').textContent = `${Math.max(0, Math.ceil(game.roundDuration - game.roundTime))} 秒`;
  $('level').textContent = `Lv.${game.level}`; $('kills').textContent = game.kills;
  $('health-label').textContent = `生命 ${Math.ceil(p.health)} / ${p.maxHealth}`;
  $('xp-label').textContent = `经验 ${game.xp} / ${game.xpNeed}`;
  $('health-fill').style.width = `${Math.max(0,p.health/p.maxHealth*100)}%`;
  $('xp-fill').style.width = `${Math.min(100,game.xp/game.xpNeed*100)}%`;
  const cd=game.heroId==='deepseek'?p.dashCooldown:p.skillCooldown;
  const energyReady=game.heroId!=='gpt'||p.transformed||p.energy>=20;
  $('skill').firstElementChild.textContent=game.heroId==='gpt'?(p.transformed?'工具调用':'恢复正常 GPT'):hero.skillName;
  $('skill-status').textContent = !energyReady?'需要 20 能量':cd > 0 ? `${cd.toFixed(1)} 秒` : '空格 / E · 就绪';
  $('skill').disabled = !active() || cd > 0 || !energyReady || p.slideTimer>0;
  $('rice-count').textContent = `${info.count} / 9`;
  $('rice-item').querySelector('span').firstChild.textContent=`${hero.itemIcon} ${info.name} `;
  $('rice-item').setAttribute('aria-label',`按数字1使用${info.name}`);
  $('rice-effect').textContent = game.heroId==='deepseek'?`恢复 ${30 + (game.equipmentPower?.ricebox || 0)*10} 生命`:game.heroId==='gemini'?'3 次护盾 · 8 秒':game.heroId==='gpt'?'回满能量':'重置技能冷却';
  $('rice-item').disabled = !active() || !info.canUse;
  const isFish=game.heroId==='deepseek',isGpt=game.heroId==='gpt';
  $('fatness').textContent=isFish?`${p.superFat?'超级大肥鱼 · ':''}成长 ${p.fatLevel}/30 · 外观 ${p.fishStage}/11`:isGpt?`${p.transformed?'正常':'降智'} GPT`:hero.name;
  $('momentum').textContent=isFish?(p.slideTimer>0?`惯性滑行 ${p.slideTimer.toFixed(1)} 秒 · 减伤 40%`:`滑行 ${(0.3+p.fatness*.045).toFixed(1)} 秒`):isGpt?'经验同时充能与升级':`速度 ${Math.round(p.speed)} · 伤害 ${Math.round(p.damage)}`;
  $('food-hint').textContent=isFish?`冲撞 ${Math.round(p.chargeDamage)} 伤害 · 偷吃回血 50%`:info.description;
  $('resource-label').textContent=isFish?(p.fatLevel>=30?'肥胖成长已满级':`肥胖等级 ${p.fatLevel} · ${p.fatXp} / ${p.fatXpNeed} 碗`):isGpt?`能量 ${Math.floor(p.energy)} / ${p.energyMax}${p.transformed?' · 变身消耗中':''}`:game.heroId==='gemini'?`护盾 ${p.chromeShieldCharges} 次 · ${p.chromeShieldTimer.toFixed(1)} 秒`:'星爆技能';
  $('resource-fill').style.width=`${Math.min(100,isFish?(p.fatLevel>=30?100:p.fatXp/p.fatXpNeed*100):isGpt?p.energy/p.energyMax*100:game.heroId==='gemini'?p.chromeShieldTimer/8*100:(1-cd/7)*100)}%`;
  $('opponent-faction').textContent=`对手阵营 · ${game.playerFaction==='cn'?'美国模型':'国模'}`;
  $('opponent-roster').textContent=game.playerFaction==='cn'?'GPT、Gemini Flash Lite、Claude；精英 sol、Opus、Flash；首领 Astra。':'豆包、Qwen、Kimi；精英 Qwen Max、Kimi Thinking、DeepSeek Reasoner；首领满血 DeepSeek。';
  if($('hero-portrait').dataset.hero!==game.heroId){$('hero-portrait').dataset.hero=game.heroId;$('hero-portrait').src=asset(copy.portrait);$('hero-title').textContent=copy.title;$('hero-description').textContent=copy.description;$('hero-eyebrow').textContent=`本局角色 · ${hero.name}`;$('hero-tags').textContent=hero.skillName;}
  $('notice').classList.toggle('visible', performance.now() < noticeUntil && $('overlay').hidden);
  $('route-title').textContent = game.round < 3 ? '第三轮，模型精英来袭。' : game.round < 10 ? '组合升级，备战首领。' : '最后一轮，全力以赴。';
  $('route-detail').textContent = `本轮 ${game.roundDuration} 秒。${info.name}最多携带9份，可留到后续轮次使用。`;
  const signature = JSON.stringify([game.traits,game.equipment,game.buildLog?.length]);
  if ($('build').dataset.signature !== signature) {
    $('build').dataset.signature = signature; $('build').replaceChildren();
    if(game.buildLog?.length){for(const item of game.buildLog.slice(-20).reverse()){const row=document.createElement('div');row.className='build-line';const name=document.createElement('span');name.textContent=`${item.name} · ${item.rarity}`;name.title=item.description;row.append(name);$('build').append(row);}return;}
    for (const [title, entries] of [['特性', game.traits], ['装备', game.equipment]]) for (const [key,value] of Object.entries(entries || {})) if (value) {
      const row = document.createElement('div'); row.className='build-line';
      const name = document.createElement('span'); name.textContent = `${title} · ${CATALOG[key]?.name || key}`;
      const count = document.createElement('strong'); count.textContent = `×${value}`; row.append(name,count); $('build').append(row);
    }
    if (!$('build').children.length) $('build').textContent = '捡经验选特性；每轮结束选一件装备。';
  }
  if ($('round-dots').dataset.round !== String(game.round)) {
    $('round-dots').dataset.round = String(game.round);
    $('round-dots').replaceChildren(...Array.from({length:10},(_,i)=>{const dot=document.createElement('i');dot.className=i+1<game.round?'done':i+1===game.round?'current':'';return dot;}));
  }
}
$('skill').addEventListener('pointerdown', event => { event.preventDefault(); skill(); });
$('rice-item').addEventListener('click', eatRice);
$('focus-enter').onclick = () => setFocus(true);
$('focus-exit').onclick = () => setFocus(false);
$('focus-pause').onclick = () => $('pause').click();
$('pause').onclick = () => { if (!started || game.phase !== 'playing') return; paused = !paused; clearInput(); accumulator=0; refreshOverlay(); updateHud(); };
$('show-stats').onclick = () => {if(started&&game.phase==='playing'){paused=true;clearInput();overlayKey='';refreshOverlay();}};
$('focus-stats').onclick=()=>$('show-stats').click();
const cloud=createCloudSaves({getState:()=>game,applyState:state=>{if(!state||!HEROES[state.heroId]||!state.player||!Array.isArray(state.enemies))throw Error('存档结构不兼容。');game=structuredClone(state);selectedHero=game.heroId;selectedDifficulty=game.difficulty||'standard';$('difficulty-select').value=selectedDifficulty;started=true;paused=true;clearInput();overlayKey='';refreshOverlay();updateHud();},onBusy:value=>{cloudLocked=value;clearInput();}});
$('cloud-open').onclick=()=>cloud.open();$('focus-save').onclick=()=>cloud.open();
async function toggleMusic(){try{const enabled=await music.toggle();$('music-toggle').textContent=$('focus-music').textContent=enabled?'音乐：开':'音乐：关';}catch{$('music-toggle').textContent='音乐暂不可用';}}
$('music-toggle').onclick=toggleMusic;$('focus-music').onclick=toggleMusic;
$('difficulty-select').onchange=e=>{selectedDifficulty=e.target.value;game=createGame({seed:Date.now()>>>0,hero:selectedHero,difficulty:selectedDifficulty});overlayKey='';refreshOverlay();updateHud();};
$('restart').onclick = reset;
$('choose-hero').onclick = reset;
const moves = new Set(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright']);
window.addEventListener('keydown', event => {
  const key = event.key.toLowerCase();
  if(document.querySelector('.cloud-save-dialog[open]'))return;
  if (key === 'escape') { if(focusMode)setFocus(false);else $('pause').click();return; }
  if (!active()) return;
  if ((event.code === 'Digit1' || event.code === 'Numpad1' || key === '1') && !event.repeat) { event.preventDefault(); eatRice(); return; }
  if (moves.has(key)) { event.preventDefault(); keys.add(key); }
  if ((key === ' ' || key === 'e') && !event.repeat) { event.preventDefault(); skill(); }
});
window.addEventListener('keyup', event => keys.delete(event.key.toLowerCase()));
canvas.addEventListener('pointerdown', event => {
  if (!active()) return;
  canvas.focus({preventScroll:true});
  if (event.pointerType === 'mouse') { aim = renderer.screenToWorld(event.clientX,event.clientY); return; }
  if (touch) return;
  canvas.setPointerCapture(event.pointerId);
  touch = {id:event.pointerId,startX:event.clientX,startY:event.clientY,x:0,y:0};
  const r = canvas.getBoundingClientRect();
  $('stick').style.left=`${event.clientX-r.left-44}px`; $('stick').style.top=`${event.clientY-r.top-44}px`; $('stick').hidden=false;
});
canvas.addEventListener('pointermove', event => {
  if(event.pointerType==='mouse'){ aim=renderer.screenToWorld(event.clientX,event.clientY);return; }
  if(!touch || event.pointerId!==touch.id)return;
  const dx=event.clientX-touch.startX,dy=event.clientY-touch.startY, length=Math.hypot(dx,dy),scale=Math.max(42,length);
  touch.x=dx/scale;touch.y=dy/scale;
  $('stick').firstElementChild.style.transform=`translate(${touch.x*25}px,${touch.y*25}px)`;
});
for (const name of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(name,event=>{if(touch?.id===event.pointerId){touch=null;$('stick').hidden=true;}});
function suspend() { clearInput(); accumulator=0;void music.pause(); if(started&&game.phase==='playing'){paused=true;refreshOverlay();} }
window.addEventListener('blur',suspend);document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();last=0;});
window.addEventListener('resize',()=>renderer.resize());
function frame(now) {
  const dt=last?Math.min(.1,(now-last)/1000):0;last=now;
  if(active()!==musicActive){musicActive=active();void(musicActive?music.resume():music.pause());}
  if(active()){
    accumulator+=dt;let steps=0;
    while(accumulator>=1/60&&steps++<5&&active()){eventFeedback(stepGame(game,input(),1/60));accumulator-=1/60;}
    if(steps>=5)accumulator=0;
  }else accumulator=0;
  if(!document.hidden){if(active() || now-lastDraw>250){renderer.draw(game);lastDraw=now;}refreshOverlay();if(now-lastHud>100){updateHud();lastHud=now;}}
  requestAnimationFrame(frame);
}
if(matchMedia('(max-width:740px)').matches)setFocus(true);
refreshOverlay(); updateHud(); requestAnimationFrame(frame);

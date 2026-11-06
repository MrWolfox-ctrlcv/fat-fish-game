// Procedural effects share one context and one noise buffer; music is loaded on demand.
const STORE='oua.tower.audio.v1';
const clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,n));
const TRACKS={coast:new URL('../assets/audio/shallow-bay-v2.mp3',import.meta.url),boss:new URL('../assets/audio/star-crown-v2.mp3',import.meta.url)};
export function createSoundtrack(){
 let settings={enabled:true,music:.22,effects:.55};
 try{const s=JSON.parse(localStorage.getItem(STORE));if(s){settings.enabled=s.enabled!==false;for(const k of ['music','effects'])if(Number.isFinite(s[k]))settings[k]=clamp(s[k]);}}catch{}
 let ctx,master,musicBus,fxBus,noise,active=true,scene='coast',unlocked=false,previewUntil=0,previewTimer,current=null,serial=0,loading=0,musicFailed=false;
 const cache=new Map(),voices=new Set(),last=new Map();
 function ensure(){if(ctx)return;const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Audio)return;
  ctx=new Audio();master=ctx.createGain();musicBus=ctx.createGain();fxBus=ctx.createGain();const limiter=ctx.createDynamicsCompressor();limiter.threshold.value=-12;limiter.knee.value=12;limiter.ratio.value=6;limiter.attack.value=.003;limiter.release.value=.18;musicBus.connect(master);fxBus.connect(master);master.connect(limiter).connect(ctx.destination);
  noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);const a=noise.getChannelData(0);let v=0;for(let i=0;i<a.length;i++){v=.7*v+.3*(Math.random()*2-1);a[i]=v;}
  ctx.onstatechange=sync;volumes();
 }
 function volumes(){if(!ctx)return;const t=ctx.currentTime;master.gain.setTargetAtTime(settings.enabled?1:0,t,.025);musicBus.gain.setTargetAtTime(settings.music,t,.06);fxBus.gain.setTargetAtTime(settings.effects,t,.025);}
 function stopMusic(){serial++;if(!current)return;const old=current;current=null;const t=ctx.currentTime;old.gain.gain.cancelScheduledValues(t);old.gain.gain.setTargetAtTime(0,t,.12);try{old.source.stop(t+.65);}catch{}}
 async function music(){if(!ctx||!unlocked||!active||!settings.enabled||settings.music===0||scene==='end'){stopMusic();return;}if(current?.key===scene)return;const key=scene,ticket=++serial;loading++;
  try{if(!cache.has(key))cache.set(key,fetch(TRACKS[key]).then(r=>{if(!r.ok)throw Error('music unavailable');return r.arrayBuffer();}).then(b=>ctx.decodeAudioData(b)));
   const buffer=await cache.get(key);if(ticket!==serial||!active||!settings.enabled||settings.music===0||scene!==key)return;
   const old=current,source=ctx.createBufferSource(),gain=ctx.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=0;source.connect(gain).connect(musicBus);source.onended=()=>{source.disconnect();gain.disconnect();};source.start();gain.gain.setTargetAtTime(1,ctx.currentTime,.4);current={source,gain,key};
   if(old){old.gain.gain.setTargetAtTime(0,ctx.currentTime,.25);try{old.source.stop(ctx.currentTime+1.3);}catch{}}musicFailed=false;
  }catch{musicFailed=true;cache.delete(key);}finally{loading--;}
 }
 function sync(){if(!ctx)return;volumes();const shouldRun=unlocked&&settings.enabled&&(active||performance.now()<previewUntil);
  if(shouldRun&&ctx.state==='suspended')void ctx.resume().catch(()=>{});
  else if(!shouldRun&&ctx.state==='running')void ctx.suspend().catch(()=>{});
 }
 function unlock(){unlocked=true;try{ensure();sync();if(!current&&loading===0)void music();}catch{}}
 function setScene(next,isActive){const changed=next!==scene||isActive!==active;scene=next;active=isActive;if(changed){if(!active){previewUntil=0;clearTimeout(previewTimer);for(const v of voices)try{v.source.stop();}catch{}voices.clear();}sync();void music();}}
 function configure(patch){Object.assign(settings,patch);for(const k of ['music','effects'])settings[k]=clamp(settings[k]);try{localStorage.setItem(STORE,JSON.stringify(settings));}catch{}sync();void music();}
 function tone(type,freq,end,duration,volume,delay=0,pan=0){if(!ctx||voices.size>=18)return;const t=ctx.currentTime+delay,gain=ctx.createGain(),source=type==='noise'?ctx.createBufferSource():ctx.createOscillator();let filter;
  if(type==='noise'){source.buffer=noise;filter=ctx.createBiquadFilter();filter.type='lowpass';filter.frequency.setValueAtTime(freq,t);filter.frequency.exponentialRampToValueAtTime(Math.max(80,end),t+duration);source.connect(filter).connect(gain);}else{source.type=type;source.frequency.setValueAtTime(freq,t);source.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+duration);source.connect(gain);}
  const stereo=ctx.createStereoPanner?.();gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),t+.008);gain.gain.exponentialRampToValueAtTime(.0001,t+duration);if(stereo){stereo.pan.value=pan;gain.connect(stereo).connect(fxBus);}else gain.connect(fxBus);
  const voice={source};voices.add(voice);source.onended=()=>{voices.delete(voice);source.disconnect();filter?.disconnect();gain.disconnect();stereo?.disconnect();};source.start(t);source.stop(t+duration+.015);
 }
 function play(cue,x=640,{preview=false}={}){if(!ctx||!unlocked||!settings.enabled||settings.effects===0||(!active&&!preview))return;if(voices.size>=12&&!['warning','boss','enrage','star-impact','star-block','victory','defeat'].includes(cue))return;const now=performance.now(),cooldown={hit:160,arrow:110,cannon:180,laser:220,summon:320,splash:160,shield:500,blink:300}[cue]??180;if(now-(last.get(cue)??-Infinity)<cooldown)return;last.set(cue,now);const p=clamp((x/1280-.5)*.9,-.55,.55),n=(...a)=>tone(...a,0,p);
  switch(cue){
   case 'build':case 'upgrade':case 'skill':{const notes=cue==='upgrade'?[392,494,587,784]:cue==='skill'?[330,440,660]:[330,440,554];notes.forEach((f,i)=>tone('sine',f,f*1.01,.24,.15,i*.065,p));break;}
   case 'arrow':n('noise',3400,900,.08,.24);n('triangle',1050,470,.08,.07);break;
   case 'cannon':n('sine',130,40,.28,.38);n('noise',1100,120,.21,.35);break;
   case 'laser':n('sine',1200,400,.26,.13);n('triangle',610,920,.19,.065);break;
   case 'splash':n('noise',1900,220,.22,.24);n('sine',280,90,.15,.12);break;
   case 'hit':n('noise',900,180,.06,.12);break;
   case 'summon':case 'blink':[440,660,880].forEach((f,i)=>tone('sine',f,f*1.18,.2,.09,i*.035,p));break;
   case 'shield':n('sine',580,620,.3,.13);n('triangle',1160,1240,.25,.045);break;
   case 'warning':case 'boss':case 'enrage':[0,.23,.46].forEach(d=>tone('triangle',cue==='enrage'?196:294,220,.18,.15,d));break;
   case 'stomp':case 'star-impact':n('sine',105,28,.5,.4);n('noise',1800,120,.45,.35);break;
   case 'star-block':[660,880,1320].forEach((f,i)=>tone('sine',f,f,.3,.12,i*.035));break;
   case 'wave':[330,440,660].forEach((f,i)=>tone('triangle',f,f,.21,.11,i*.11));break;
   case 'clear':case 'coin':case 'sell':[660,880].forEach((f,i)=>tone('sine',f,f,.25,.13,i*.1));break;
   case 'victory':[392,494,587,784].forEach((f,i)=>tone('triangle',f,f,.45,.13,i*.15));break;
   case 'defeat':case 'leak':[294,247,196].forEach((f,i)=>tone('sine',f,f*.88,.3,.15,i*.16));break;
   case 'error':n('sine',175,150,.14,.14);break;
   default:n('sine',620,500,.08,.09);
  }
 }
 function preview(){unlock();previewUntil=performance.now()+1100;sync();play('build',640,{preview:true});clearTimeout(previewTimer);previewTimer=setTimeout(sync,1150);}
 return {unlock,setScene,configure,play,preview,get settings(){return {...settings};},get status(){return !settings.enabled?'已静音':!unlocked?'点按画面后播放':!ctx?'此浏览器不支持音频':!active?'战斗暂停 · 声音暂停':ctx.state!=='running'?'点按画面恢复声音':musicFailed?'音效可用 · 配乐暂不可用':loading?'配乐准备中':current?current.key==='boss'?'星冕来临 · 播放中':'浅湾海风 · 播放中':'音效已就绪';}};
}

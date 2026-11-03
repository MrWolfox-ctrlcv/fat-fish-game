export function mountSupporter({parent,client,onBusy=()=>{},onUpdate=()=>{}}){
  const box=document.createElement('section');box.className='supporter-box';
  const title=document.createElement('h3');title.textContent='支持者礼包 · $1 / 30 天';
  const policy=document.createElement('p');policy.textContent='两款游戏共用一次购买。合成大肥鱼与肥鱼幸存者各提供共 3 个档位，每次保存保留 30 天；已有更长有效期不缩短。每天两款游戏各有 2 次免费小道具，北京时间零点重置，不累积；不自动续费。';
  const status=document.createElement('p');status.setAttribute('role','status');
  const buy=document.createElement('button');buy.type='button';buy.textContent='核验权益';buy.disabled=true;
  const consentLabel=document.createElement('label'),consent=document.createElement('input');consent.type='checkbox';try{consent.checked=localStorage.getItem('oua.game.analytics-consent')==='1';}catch{}consentLabel.append(consent,document.createTextNode('允许记录属性、升级选择与结局，用于改进游戏；不记录聊天或令牌，可随时关闭。'));consent.onchange=()=>{try{localStorage.setItem('oua.game.analytics-consent',consent.checked?'1':'0');localStorage.setItem('survivor.analytics-consent.v1',consent.checked?'1':'0');window.dispatchEvent(new Event('oua-analytics-consent'));}catch{}};box.append(title,policy,status,buy,consentLabel);parent.append(box);let rights=null,busy=false,owner=null;
  const key=id=>`oua.supporter.pending.${id}`;
  async function request(path,payload){const response=await client.requestCompanion(new URL(`/games/fat-fish/api/supporter${path}`,location.origin),{method:payload?'POST':'GET',headers:{'Content-Type':'application/json',Accept:'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});const data=await response.json();if(!response.ok||!data.success)throw Object.assign(Error(data.message||'支持者服务暂不可用'),{code:data.code,status:response.status});return data;}
  async function refresh(){
    buy.disabled=true;try{const me=await client.getMe();owner=me?.user?.id||null;if(!owner){status.textContent='登录后可购买，原有免费存档保留。';return;}const data=await request('');if(data.user_id!==owner)throw Error('账户已变化，请重新打开。');rights=data.supporter;
      status.textContent=rights.active?`今日免费：合成 ${rights.daily?.games?.['fat-fish']?.remaining??0}/2，幸存者 ${rights.daily?.games?.survivor?.remaining??0}/2。支持者有效至 ${new Date(rights.expires_at).toLocaleString()}。覆盖前 3 个档位，保存保留 30 天。`:'未开通支持者。基础游玩和原有免费档继续可用。';
      if(rights.pending){status.textContent=`付款待核对：${rights.pending.request_id}。不会再次扣款；请联系站长核对。`;buy.textContent='刷新订单状态';buy.disabled=false;return;}
      buy.textContent=rights.active?'明确续期 30 天 · $1':'购买 30 天 · $1';buy.disabled=!rights.billing_enabled;
    }catch(e){rights=null;status.textContent=e.message;}
  }
  buy.onclick=async()=>{
    if(busy)return;if(rights?.pending){await refresh();return;}if(!owner||!rights)return;
    if(!confirm(`确认从当前中转站账户扣除 $1，${rights.active?'续期':'购买'}支持者权益 30 天？两款游戏各有共 3 个档位，每次保存保留 30 天，不自动续费。`))return;
    busy=true;buy.disabled=true;onBusy(true);const id=owner;
    try{const me=await client.getMe();if(me?.user?.id!==id)throw Error('账户已变化，未购买。');let payload;
      try{payload=JSON.parse(localStorage.getItem(key(id))||'null');}catch{}
      payload ||= {request_id:crypto.randomUUID(),action:rights.active?'renew':'buy',confirm_quota:500000,expected_user_id:id};
      try{localStorage.setItem(key(id),JSON.stringify(payload));}catch{throw Error('无法保存订单编号，未发起扣费。');}
      const result=await request('/buy',payload);
      if(result.pending){status.textContent=`请求 ${payload.request_id} 待核对，不会另下新单。`;await refresh();return;}
      localStorage.removeItem(key(id));await refresh();onUpdate();
    }catch(e){if(['ORDER_CLOSED','BILLING_DISABLED','WALLET_REJECTED','INSUFFICIENT_QUOTA','INVALID_SUPPORTER','ALREADY_OWNED','NOT_ACTIVE'].includes(e.code)){try{localStorage.removeItem(key(id));}catch{}}status.textContent=`${e.message}。结果不明确时请保留原请求编号，勿另下新单。`;}
    finally{busy=false;onBusy(false);if(rights&&!rights.pending)buy.disabled=!rights.billing_enabled;}
  };
  return {refresh,get rights(){return rights;},isBusy:()=>busy};
}

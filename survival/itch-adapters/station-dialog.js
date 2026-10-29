export function stationDialog(title,onBusy=()=>{}){
 const dialog=document.createElement('dialog');dialog.className='cloud-save-dialog';
 const h=document.createElement('h2');h.textContent=title;
 const p=document.createElement('p');p.textContent='独立版的战斗在你的设备上运行，不连接账户、扣费或云存档。请前往站内版使用账户功能；当前对局不会自动迁移，关闭页面会结束本局。';
 const link=document.createElement('a');link.href='https://oua-cdn.wolfoxlabs.xyz/games/survivor/';link.target='_blank';link.rel='noopener';link.textContent='打开站内版 ↗';
 const close=document.createElement('button');close.textContent='继续本局';close.onclick=()=>dialog.close();
 dialog.append(h,p,link,close);document.body.append(dialog);dialog.addEventListener('close',()=>onBusy(false));
 return{open(){dialog.showModal();onBusy(true);},isLocked:()=>dialog.open};
}

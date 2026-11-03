import { createOnlineClient } from './online-client.js';

// Resolve identity through the same verified account API as cloud saves. Unknown is not guest.
export function createRecoveryOwner({onChange=()=>{}}={}) {
  const client=createOnlineClient({moduleUrl:new URL('./online-client.js',import.meta.url)});
  let generation=0;
  async function verify(){
    const revision=++generation;onChange(null);
    try{
      const result=await client.getMe();
      if(revision!==generation)return null;
      const owner=result?.user?.id?`account:${result.user.id}`:'guest';onChange(owner);return owner;
    }catch{
      if(revision!==generation)return null;
      // Static previews have no account API. Production failures remain unresolved.
      if(['localhost','127.0.0.1','[::1]'].includes(location.hostname)){onChange('guest');return 'guest';}
      onChange(null);return null;
    }
  }
  client.onSessionChange(()=>{client.clearLocalSession();void verify();});
  return {verify};
}

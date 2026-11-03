export function createRecoveryOwner({onChange=()=>{}}={}){
  return {async verify(){onChange('guest');return 'guest';}};
}

// One ordered stream for taps, outcomes and undo. Taps never lock the controls.
export function actionQueue(run, changed=()=>{}){
 let tail=Promise.resolve(),pending=0,blocking=0;
 return {
  get pending(){return pending;},
  push(message){
   const locks=message.type!=='touch'&&message.type!=='smash';
   pending++;if(locks)blocking++;changed({pending,busy:blocking>0});
   const result=tail.then(()=>run(message));
   tail=result.catch(()=>{}).finally(()=>{pending--;if(locks)blocking--;changed({pending,busy:blocking>0});});
   return result;
  }
 };
}

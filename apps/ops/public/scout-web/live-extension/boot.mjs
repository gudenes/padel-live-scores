// Keep the initial HTML hidden until match restoration and the first render finish.
const status=document.getElementById('scout-loading-status');
const title=document.getElementById('scout-loading-title');
const retry=document.getElementById('scout-loading-retry');
retry.onclick=()=>location.reload();
try{
 await import('./panel.mjs?v=scout-loading1');
 document.body.classList.remove('scout-booting');
 document.getElementById('scout-loading').remove();
}catch(error){
 title.textContent='Could not open scouting';
 status.textContent=error?.message||'Please try again.';
 document.getElementById('scout-loading').dataset.failed='true';
 retry.hidden=false;
}

export function validateStartingScore(raw){
 if(!raw||typeof raw!=='object')throw Error('Enter a starting score.');
 const games=s=>{if(!s||![s.a,s.b].every(n=>Number.isInteger(n)&&n>=0&&n<=7))throw Error('Set games must be between 0 and 7.');return {a:s.a,b:s.b};};
 const complete=s=>Math.max(s.a,s.b)===6&&Math.min(s.a,s.b)<=4||Math.max(s.a,s.b)===7&&[5,6].includes(Math.min(s.a,s.b));
 if(!Array.isArray(raw.completed)||raw.completed.length>2)throw Error('Enter up to two completed sets.');
 const completed=raw.completed.map(games);if(completed.some(s=>!complete(s)))throw Error('Completed sets must be 6–0 through 6–4, 7–5 or 7–6.');
 if(completed.length===2&&completed.every(s=>s.a>s.b) || completed.length===2&&completed.every(s=>s.b>s.a))throw Error('The match is already finished.');
 const current=games(raw.games);if(current.a>6||current.b>6||complete(current))throw Error('Enter the unfinished current set; put finished sets above.');
 const tiebreak=current.a===6&&current.b===6,points={a:raw.points?.a,b:raw.points?.b};
 if(tiebreak){if(!Object.values(points).every(n=>Number.isInteger(n)&&n>=0&&n<=100)||Math.max(points.a,points.b)>=7&&Math.abs(points.a-points.b)>=2)throw Error('Enter an unfinished tie-break score.');}
 else if(!Object.values(points).every(n=>[0,15,30,40,'Adv'].includes(n))||points.a==='Adv'&&points.b!==40||points.b==='Adv'&&points.a!==40)throw Error('Use 0, 15, 30, 40 or advantage against 40.');
 if(!Number.isInteger(raw.server)||raw.server<0||raw.server>3)throw Error('Choose the player serving at your starting point.');
 if(!['a','b'].includes(raw.near))throw Error('Choose the pair at the near end.');
 const advantageReturns=raw.advantageReturns??0;if(!Number.isInteger(advantageReturns)||advantageReturns<0||advantageReturns>2)throw Error('Choose 0, 1 or 2 deuce returns.');
 return {completed,games:current,points,server:raw.server,near:raw.near,advantageReturns:tiebreak?0:advantageReturns};
}

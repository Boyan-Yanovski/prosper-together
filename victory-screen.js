/* Shared by the real completion flow and the directly-openable design preview. */
window.CommonWorksVictory = (() => {
  let dialog;
  /* The language being played (game-language.js). A page that shows this
     screen without it, such as the design preview, gets the English. */
  const T = window.T || ((strings, ...values) => strings.reduce((whole, part, index) => whole + part + (index < values.length ? values[index] : ''), ''));
  const written = window.CWT_LANGUAGE?.number || String;
  const fmt = n => written(Math.round(n * 10) / 10);
  function close() { if (dialog?.open) dialog.close(); }
  function show(players, restart, preview = false) {
    if (!dialog) { dialog=document.createElement('dialog');dialog.className='mission-win';dialog.setAttribute('aria-labelledby','missionWinTitle');document.body.append(dialog); }
    // score: average wellbeing per turn, reserve included (consumed + reserve) / turns.
    const ranked=players.map(p=>({...p,finalScore:p.score})).sort((a,b)=>b.finalScore-a.finalScore);
    dialog.innerHTML=`<header><div class="mission-seal" aria-hidden="true">✦</div><div class="mission-kicker">${T`Level ${window.CWT_LEVEL || 1} · Enduring prosperity`}</div><h1 id="missionWinTitle">${T`Mission accomplished`}</h1><p class="mission-subtitle">${T`The hard way`}</p></header><div class="mission-body"><p class="mission-summary">${players.length === 7 ? T`Seven specializations. One thriving society.` : T`Five specializations. One thriving society.`}<br>${T`Everyone is willing to contribute all their energy freely.`}</p><div class="mission-table-head"><span>${T`Final standings`}</span><span>${T`Final score`}</span></div><ol></ol><div class="mission-actions"><button class="secondary" data-table>${T`Return to table`}</button><button data-replay>${T`Play again`}</button></div></div>`;
    ranked.forEach((p,index)=>{
      const row=document.createElement('li');if(p.id==='artist')row.dataset.you='';
      // The slip takes its player's colour (the game's --mystic, --farmer, …; gold where the page has none).
      row.dataset.id=p.id;row.style.setProperty('--person',`var(--${p.id}, #b58b3e)`);
      const rank=index && p.finalScore===ranked[index-1].finalScore ? ranked[index-1].rank : index+1;p.rank=rank;
      row.innerHTML=`<span class="mission-rank">${rank}</span><img alt="" src="assets/portraits/${p.id}-high.webp"><div><span class="mission-name"></span><span class="mission-role"></span></div><div class="mission-score">${fmt(p.finalScore)}<small>${T`(${fmt(p.consumed)} + ${fmt(p.reserve)} reserve) ÷ ${p.turns} turn${p.turns===1?'':'s'}`}</small></div>`;
      row.querySelector('.mission-name').textContent=p.name;
      row.querySelector('.mission-role').textContent=p.role;
      dialog.querySelector('ol').append(row);
    });
    dialog.querySelector('[data-table]').onclick=close;
    dialog.querySelector('[data-replay]').onclick=()=>{close();restart();};
    if(!dialog.open)dialog.showModal();
    return ranked;
  }
  return {show,close};
})();

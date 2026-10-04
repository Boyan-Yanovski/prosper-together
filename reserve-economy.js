/* V9 durable goods accounting, separate from the retained production engine. */
(function(root){
  'use strict';
  const EPS=1e-9;
  function required(history,rule){
    const L=rule.windowTurns;
    return rule.minimumWellbeing>0 && history.length+1>=L
      ? Math.max(0,rule.minimumWellbeing-history.slice(L>1?-(L-1):history.length).reduce((a,b)=>a+b,0)):0;
  }
  function consume(available,history,rule,target){
    return Math.min(available,Math.max(required(history,rule),available-target));
  }
  function check(reserves,pledges,dead={}){
    let paid=0;
    for(const [id,p] of Object.entries(pledges)){
      if(!p || id==='artist' || dead[id] || !Number.isFinite(reserves[id])
        || !Number.isInteger(p.extraUnits) || p.extraUnits<1 || p.extraUnits>3
        || !Number.isFinite(p.amount) || p.amount<0)
        return {ok:false,reason:'This contribution is not available.'};
      paid+=p.amount;
    }
    return paid<=reserves.artist+EPS ? {ok:true,paid}
      : {ok:false,reason:"You don't have enough goods in reserve to pay for this pledge"};
  }
  function transfer(reserves,pledges,dead={}){
    const checkResult=check(reserves,pledges,dead);
    if(!checkResult.ok)throw Error(checkResult.reason);
    const next={...reserves};next.artist=Math.max(0,next.artist-checkResult.paid);
    for(const [id,p] of Object.entries(pledges))next[id]+=p.amount;
    return next;
  }
  const api={required,consume,check,transfer};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CommonWorksReserves=api;
})(typeof globalThis!=='undefined'?globalThis:this);

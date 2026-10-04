/* V11: adaptive constant-rate contribution forecasts and linear valuation.
 * Public contributions reveal no private pledge terms or payment motives. */
(function (root) {
  'use strict';
  const IDS = root.CWT_PLAYER_IDS || ['mystic','farmer','scientist','artist','craftsperson'];
  const clamp = (x,a,b) => Math.max(a,Math.min(b,x));
  const sum = xs => xs.reduce((a,b)=>a+b,0);
  const utility = (w,risk) => risk<1e-9 ? Math.max(0,w) : -Math.expm1(-risk*Math.max(0,w))/risk;
  function payoffs(profile,dead={}) {
    const actions=IDS.map(id=>dead[id]?0:profile[id]);
    const energy=sum(actions), squares=sum(actions.map(x=>x*x));
    const rate=actions.filter(x=>x>0).length<2?0:3.5*(energy*energy/squares/IDS.length)**1.5;
    return Object.fromEntries(IDS.map((id,i)=>[id,dead[id]?0:3-actions[i]+actions[i]*rate]));
  }
  function lost(gains,rule) {
    return rule.minimumWellbeing>0 && gains.length>=rule.windowTurns
      && sum(gains.slice(-rule.windowTurns))<rule.minimumWellbeing-1e-9;
  }
  function observedProfile(history=[],dead={}) {
    const last=history[history.length-1]?.commitments || {};
    return Object.fromEntries(IDS.map(id=>[id,dead[id]?0:clamp(Number(last[id])||0,0,3)]));
  }
  function participationEvidence(id,previous={},actual={},dead={}) {
    let expectedEnergy=0,repeatedEnergy=0,observedEnergy=0;
    let allRepeated=true;
    for(const peer of IDS) {
      if(peer===id||dead[peer])continue;
      const expected=clamp(Number(previous[peer])||0,0,3);
      const observed=clamp(Number(actual[peer])||0,0,3);
      expectedEnergy+=expected;
      observedEnergy+=observed;
      if(observed<expected)allRepeated=false;
      repeatedEnergy+=Math.min(expected,observed);
    }
    // First participation is positive evidence, without claiming a repetition.
    const firstParticipation=expectedEnergy===0 && observedEnergy>0;
    return {expectedEnergy,repeatedEnergy,observedEnergy,firstParticipation,
      signal:expectedEnergy>0?Number(allRepeated):firstParticipation?1:null};
  }
  function createPlanner({id,riskAversion,trust,history=[],deceased={},priorAlphas=[1.8,.12,.06,.02],learningRate=.2,
    survival={minimumWellbeing:9,windowTurns:3}, minimumCommitment=0, reserve=0}) {
    const risk=0;
    const forecast=posterior(id,priorAlphas,history,deceased,learningRate);
    // Enumerate all independent peer combinations once, then reuse their payoffs.
    let scenarios=[{profile:{},probability:1}];
    for(const peer of IDS.filter(peer=>peer!==id)){
      scenarios=scenarios.flatMap(s=>forecast.peers[peer].probabilities.flatMap((p,k)=>
        p>0?[{profile:{...s.profile,[peer]:k},probability:s.probability*p}]:[]));
    }
    const outcomes=Object.fromEntries([0,1,2,3].map(action=>[action,scenarios.map(s=>({
      probability:s.probability,gross:payoffs({...s.profile,[id]:action},deceased)[id]
    }))]));
    const gains=history.slice(-survival.windowTurns).map(e=>Number(e.result?.results?.[id]?.total)||0);
    const needed=gains.length+1>=survival.windowTurns && survival.minimumWellbeing>0
      ?Math.max(0,survival.minimumWellbeing-sum(survival.windowTurns>1?gains.slice(-(survival.windowTurns-1)):[])):0;
    const cache=new Map();
    function evaluate(action,promise=0,delivery=0) {
      const key=[action,promise,delivery].join(':');
      if(cache.has(key))return cache.get(key);
      if(deceased[id])return {value:0,immediate:0,deathProbability:1};
      let value=0,deathProbability=0;
      for(const {gross,probability} of outcomes[action]) {
        for(const [delivered,weight] of [[true,clamp(delivery,0,1)],[false,1-clamp(delivery,0,1)]]) {
          if(!weight)continue;
          // Same-turn cash already funded by the buyer: no delivery uncertainty
          // or cap from the buyer's unknown future production.
          const net=reserve+gross+(delivered?Math.max(0,promise):0);
          const fatal=lost([...gains,net],survival),chance=probability*weight;
          deathProbability+=chance*Number(fatal);
          value+=chance*(fatal?0:utility(net,risk));
        }
      }
      const result={value,immediate:value,deathProbability};cache.set(key,result);return result;
    }
    // Prepaid energy is binding; expected payoffs choose only the remaining energy.
    const actions=[0,1,2,3].filter(action=>action>=minimumCommitment).map(action=>({action,...evaluate(action)}));
    const best=actions.reduce((a,b)=>b.value>a.value+1e-9?b:a);
    const reason=deceased[id]?'Out of play.':needed>3&&best.action>0
      ?`I need ${needed.toFixed(1)} this turn; staying home cannot save me.`
      :best.action===0?'At my current market confidence, autarky has the best expected payoff this turn.'
      :'At my current market confidence, this contribution has the best expected payoff this turn.';
    function quote(base,delivery,increment=.05,extraUnits=1) {
      if(deceased[id]||!Number.isInteger(extraUnits)||extraUnits<1||base+extraUnits>3)return null;
      const target=evaluate(base).value;
      // Once fallback survival is funded every outcome is linear in payment.
      // This finite upper bound covers both survival and the baseline valuation.
      const fallback=reserve+3-base-extraUnits;
      const upper=Math.max(0,needed-fallback,target-fallback);
      for(let units=0;units<=Math.ceil((upper+1e-9)/increment);units++) {
        const amount=Number((units*increment).toFixed(2));
        if(reserve+3-base-extraUnits+amount+1e-9>=needed
          && evaluate(base+extraUnits,amount,1).value+1e-9>=target)
          return {amount,targetUtility:target,extraUnits};
      }
      return null;
    }
    return {evaluate,quote,commitment:best.action,diagnostics:{modelVersion:6,
      model:'constant-rate-independent-contributions',forecast,scenarioCount:scenarios.length,actions,commitment:best.action,neededNextTurn:needed,reason}};
  }
  // One independent adaptive forecast per observed peer. Zero is evidence, not missing data.
  function posterior(id,priorAlphas,history=[],deceased={},learningRate=.2) {
    if(!Array.isArray(priorAlphas)||priorAlphas.length!==4||priorAlphas.some(a=>!Number.isFinite(a)||a<0)||sum(priorAlphas)<=0)
      throw Error('Four nonnegative initial contribution weights with a positive total are required.');
    if(!Number.isFinite(learningRate)||learningRate<0||learningRate>1)throw Error('Learning rate must be between zero and one.');
    const total=sum(priorAlphas);
    const peers=Object.fromEntries(IDS.filter(peer=>peer!==id).map(peer=>[peer,{probabilities:priorAlphas.map(a=>a/total),observations:0}]));
    const dead={};
    for(const entry of history){
      if(!dead[id])for(const [peer,p] of Object.entries(peers)){
        const k=entry.commitments?.[peer];
        if(!dead[peer]&&Number.isInteger(k)&&k>=0&&k<=3){
          p.probabilities=p.probabilities.map((q,j)=>(1-learningRate)*q+learningRate*Number(j===k));p.observations++;
        }
      }
      for(const death of entry.automataDeaths||[])dead[death.playerId]=true;
    }
    Object.assign(dead,deceased);
    for(const [peer,p] of Object.entries(peers)){
      p.deceased=Boolean(dead[peer]);
      if(p.deceased)p.probabilities=[1,0,0,0];
      p.expectedEnergy=sum(p.probabilities.map((q,k)=>q*k));
      p.nextWeight=p.deceased||dead[id]?0:learningRate;
    }
    const living=Object.values(peers).filter(p=>!p.deceased);
    return {peers,mean:living.length?sum(living.map(p=>1-p.probabilities[0]))/living.length:0,
      nextWeight:living.length?sum(living.map(p=>p.nextWeight))/living.length:0};
  }
  const api={createPlanner,payoffs,lost,utility,observedProfile,participationEvidence,posterior};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  else root.CommonWorksBehavior=api;
})(typeof globalThis!=='undefined'?globalThis:this);

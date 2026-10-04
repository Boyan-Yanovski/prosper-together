/* Only side cards scroll. Existing card controls, animations and editor remain shared. */
(() => {
  if (ACTIVE_LEVEL !== 2) return;
  const setup = () => {
    const host=document.querySelector('#seats');
    if(host.querySelector('.peer-column')) return;
    const columns=[];
    for(const [side,ids] of [['left',['mystic','craftsperson','healer']],['right',['farmer','scientist','organizer']]]) {
      const column=document.createElement('section');column.className='peer-column';column.dataset.side=side;
      column.tabIndex=0;column.setAttribute('aria-label',`${side} players — scroll to see more`);
      host.append(column);columns.push(column);
      ids.forEach(id=>column.append(host.querySelector(`.seat[data-id="${id}"]`)));
      column.addEventListener('scroll',()=>{
        const max=column.scrollHeight-column.clientHeight;
        for(const other of columns)if(other!==column){const y=max>0?column.scrollTop/max*(other.scrollHeight-other.clientHeight):0;if(Math.abs(other.scrollTop-y)>1)other.scrollTop=y;}
        positionSeatBubbles();
      });
    }
  };
  window.setupLevelTwoCards=setup;setup();
  // Install once, outside setup: resets rebuild the columns, not these handlers.
  const app=document.querySelector('#gameApp');
  const controls='input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="slider"],[draggable="true"],.allocation-token';
  const canScroll = (event, dragging=false) => {
    if(event.defaultPrevented || document.body.dataset.view!=='game' || document.body.dataset.uiAuthorMode==='edit' || app.inert || document.querySelector('dialog[open]')) return false;
    const target=event.target;
    if(!(target instanceof Element) || target.closest(`dialog,.seat-bubble-panel,${controls}${dragging?',button,a,[role="button"]':''}`)) return false;
    // Independently scrollable panels retain their own wheel/swipe behavior.
    for(let node=target;node&&node!==document.body;node=node.parentElement) {
      if(node.classList.contains('peer-column')) break;
      if(/auto|scroll/.test(getComputedStyle(node).overflowY)&&node.scrollHeight>node.clientHeight+1) return false;
    }
    return true;
  };
  const columns=()=>[...document.querySelectorAll('.peer-column')];
  const scrollTo = top => {
    const peers=columns(), first=peers[0];
    if(!first) return;
    const max=first.scrollHeight-first.clientHeight;
    const progress=max>0?Math.max(0,Math.min(max,top))/max:0;
    for(const column of peers) column.scrollTop=progress*(column.scrollHeight-column.clientHeight);
  };
  document.addEventListener('wheel',event=>{
    if(event.ctrlKey||event.metaKey||!canScroll(event)||Math.abs(event.deltaX)>Math.abs(event.deltaY)) return;
    const first=columns()[0];
    if(!first) return;
    const scale=event.deltaMode===1?16:event.deltaMode===2?first.clientHeight:1;
    scrollTo(first.scrollTop+event.deltaY*scale);
    event.preventDefault();
  },{passive:false});
  let drag=null;
  const endDrag=()=>{
    const previous=drag;drag=null;
    app.classList.remove('peer-dragging');
    if(previous&&app.hasPointerCapture(previous.id)) app.releasePointerCapture(previous.id);
  };
  document.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0||!canScroll(event,true)) return;
    const first=columns()[0];
    if(first) drag={id:event.pointerId,y:event.clientY,top:first.scrollTop,active:false};
  });
  document.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId) return;
    if(!drag.active) {
      if(Math.abs(event.clientY-drag.y)<5) return;
      drag.active=true;app.setPointerCapture(event.pointerId);
      app.classList.add('peer-dragging');
    }
    scrollTo(drag.top+drag.y-event.clientY);
    event.preventDefault();
  },{passive:false});
  for(const type of ['pointerup','pointercancel','lostpointercapture']) document.addEventListener(type,event=>{if(drag?.id===event.pointerId) endDrag();});
  window.addEventListener('blur',endDrag);
  document.querySelector('#settingsButton').setAttribute('aria-label','Open Level 2 settings');
})();

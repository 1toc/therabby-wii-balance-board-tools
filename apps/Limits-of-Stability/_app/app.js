(() => {
'use strict';

const $ = id => document.getElementById(id);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const fmtSigned=(v,d=3)=>Number.isFinite(v)?`${v>=0?'+':''}${v.toFixed(d)}`:'—';
const fmt=(v,d=3)=>Number.isFinite(v)?v.toFixed(d):'—';

class Metrics {
  static calc(c, threshold=5){
    const lf=Math.max(0,c.lf||0),rf=Math.max(0,c.rf||0),lb=Math.max(0,c.lb||0),rb=Math.max(0,c.rb||0);
    const total=lf+rf+lb+rb,present=total>=threshold;
    if(!present||total<=0)return{lf,rf,lb,rb,total,present,copX:null,copY:null};
    const left=lf+lb,right=rf+rb,front=lf+rf,back=lb+rb;
    return{lf,rf,lb,rb,total,present,copX:(right-left)/total,copY:(front-back)/total};
  }
}

class MockDevice {
  constructor(){this.listeners=new Set();this.total=70;this.x=0;this.y=0;this.auto=false;this.goal={x:0,y:0};this.phase=0;this.timer=setInterval(()=>this.tick(),32);this.emit()}
  get connected(){return true} get name(){return'Mock Device'}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  setPose(x,y){this.auto=false;this.x=clamp(x,-.88,.88);this.y=clamp(y,-.88,.88);this.emit()}
  setWeight(v){this.total=Math.max(0,v);this.emit()}
  setAuto(v){this.auto=!!v}
  setGoal(g){this.goal={x:g.x,y:g.y}}
  tick(){if(this.auto&&this.total>=5){this.phase+=.032;const e=.045;this.x+=(this.goal.x-this.x)*e;this.y+=(this.goal.y-this.y)*e;this.x+=Math.sin(this.phase*5.2)*.0015;this.y+=Math.cos(this.phase*4.8)*.0015}this.emit()}
  corners(){const t=this.total,x=this.x,y=this.y;return{lf:t*(1-x)*(1+y)/4,rf:t*(1+x)*(1+y)/4,lb:t*(1-x)*(1-y)/4,rb:t*(1+x)*(1-y)/4}}
  emit(){const f={timestamp:performance.now(),corners:this.corners(),raw:null};this.listeners.forEach(fn=>fn(f))}
  async disconnect(){if(this.timer){clearInterval(this.timer);this.timer=null}}
}

class WebHidWbbDevice {
  constructor(){this.device=null;this.listeners=new Set();this.cal=null;this.pending=[];this.keepAlive=null;this.bound=e=>this.onInput(e)}
  get connected(){return!!this.device?.opened} get name(){return this.device?.productName||'Wii Balance Board'}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  async connect(){
    if(!('hid'in navigator))throw new Error('WebHID非対応です。Chrome / Edge の localhost または HTTPS で開いてください。');
    const ds=await navigator.hid.requestDevice({filters:[{vendorId:0x057e,productId:0x0306},{vendorId:0x057e}]});
    if(!ds.length)throw new Error('Wii Balance Boardが選択されませんでした。');
    this.device=ds.find(d=>d.productId===0x0306)||ds[0];if(!this.device.opened)await this.device.open();this.device.addEventListener('inputreport',this.bound);await this.initialize();
  }
  async disconnect(){if(this.keepAlive)clearInterval(this.keepAlive);if(this.device){this.device.removeEventListener('inputreport',this.bound);if(this.device.opened){await this.send(0x11,[0x00]).catch(()=>{});await this.device.close()}}this.device=null}
  async send(id,b){if(!this.device?.opened)throw new Error('WBB未接続');await this.device.sendReport(id,new Uint8Array(b))}
  async writeMemory(a,data){const b=new Uint8Array(21);b[0]=0x04;b[1]=(a>>>16)&255;b[2]=(a>>>8)&255;b[3]=a&255;b[4]=data.length;b.set(data.slice(0,16),5);await this.send(0x16,b)}
  async readMemory(a,len,timeout=1800){const low=a&0xffff;return new Promise(async(resolve,reject)=>{const r={base:low,length:len,buffer:new Uint8Array(len),received:new Set(),resolve,reject};r.timer=setTimeout(()=>{this.pending=this.pending.filter(x=>x!==r);reject(new Error('Calibration read timeout'))},timeout);this.pending.push(r);try{await this.send(0x17,[0x04,(a>>>16)&255,(a>>>8)&255,a&255,(len>>>8)&255,len&255])}catch(e){clearTimeout(r.timer);this.pending=this.pending.filter(x=>x!==r);reject(e)}})}
  async initialize(){await this.send(0x15,[0]);await new Promise(r=>setTimeout(r,80));await this.writeMemory(0xA400F0,new Uint8Array([0x55]));await new Promise(r=>setTimeout(r,50));await this.writeMemory(0xA400FB,new Uint8Array([0]));await new Promise(r=>setTimeout(r,80));this.cal=this.parseCal(await this.readMemory(0xA40024,24));await this.send(0x12,[0x04,0x32]);await this.send(0x11,[0x10]);this.keepAlive=setInterval(()=>this.send(0x15,[0]).catch(()=>{}),5000)}
  parseCal(b){const u16=i=>(b[i]<<8)|b[i+1],names=['rf','rb','lf','lb'],o={};names.forEach((n,i)=>o[n]={zero:u16(i*2),kg17:u16(8+i*2),kg34:u16(16+i*2)});return o}
  rawToKg(raw,c){let kg=raw<c.kg17?17*(raw-c.zero)/(c.kg17-c.zero||1):17+17*(raw-c.kg17)/(c.kg34-c.kg17||1);return Math.max(0,kg)}
  handleRead(d){if(d.byteLength<6)return;const se=d.getUint8(2),err=se&15,size=((se>>4)&15)+1,offset=(d.getUint8(3)<<8)|d.getUint8(4);if(err)return;const chunk=new Uint8Array(d.buffer,d.byteOffset+5,Math.min(size,d.byteLength-5));for(const r of [...this.pending]){const rel=offset-r.base;if(rel<0||rel>=r.length)continue;const n=Math.min(chunk.length,r.length-rel);r.buffer.set(chunk.slice(0,n),rel);for(let i=0;i<n;i++)r.received.add(rel+i);if(r.received.size>=r.length){clearTimeout(r.timer);this.pending=this.pending.filter(x=>x!==r);r.resolve(r.buffer)}}}
  onInput(e){const id=e.reportId,d=e.data;if(id===0x21){this.handleRead(d);return}if(id!==0x32||!this.cal||d.byteLength<10)return;const u16=i=>(d.getUint8(i)<<8)|d.getUint8(i+1),raw={rf:u16(2),rb:u16(4),lf:u16(6),lb:u16(8)},c={lf:this.rawToKg(raw.lf,this.cal.lf),rf:this.rawToKg(raw.rf,this.cal.rf),lb:this.rawToKg(raw.lb,this.cal.lb),rb:this.rawToKg(raw.rb,this.cal.rb)};this.listeners.forEach(fn=>fn({timestamp:performance.now(),corners:c,raw}))}
}

class App {
  constructor(){
    this.mode='mock';this.device=null;this.unsubscribe=null;this.zero={lf:0,rf:0,lb:0,rb:0};this.zeroApplied=false;this.center=null;this.threshold=5;this.recent=[];this.recentCop=[];this.last=null;
    this.state='ready';this.stage='ready';this.setupPhase=null;this.setupStableSince=null;this.dirIndex=0;this.results=[];this.samples=[];this.totalPath=0;this.lastPoint=null;this.centerHoldStart=null;this.returnHoldStart=null;this.centerReachedLogged=false;this.events=[];this.sessionId=null;this.sessionStartedAt=null;this.sessionEndedAt=null;this.measurementSec=0;
    this.reachStarted=0;this.peakProjection=-Infinity;this.peakAt=0;this.peakPoint=null;this.offAxisSum=0;this.offAxisN=0;this.countdownTimer=null;this.anim=null;this.auto=false;
    this.ctx=null;this.resultCtx=null;this.dpr=1;this.drag=false;
    this.bind();this.setupCanvas();this.useMock();this.applySettings();this.drawResult();
  }

  bind(){
    $('modeMock').onclick=()=>this.setMode('mock');$('modeReal').onclick=()=>this.setMode('real');$('connectButton').onclick=()=>this.connectReal();
    $('zeroButton').onclick=()=>this.zeroBoard();$('centerButton').onclick=()=>this.setCenter();$('startButton').onclick=()=>this.start();$('stopButton').onclick=()=>this.stop(true);$('saveButton').onclick=()=>this.save();
    ['directionCount'].forEach(id=>$(id).onchange=()=>{if(this.state==='ready'||this.state==='done'){this.applySettings();this.resetResults()}});
    $('mockWeight').oninput=e=>{if(this.device instanceof MockDevice){this.device.setWeight(+e.target.value);$('mockWeightValue').textContent=`${(+e.target.value).toFixed(1)} kg`}};
    $('mockCenterButton').onclick=()=>{if(this.device instanceof MockDevice){this.device.setPose(this.center?.x||0,this.center?.y||0);this.auto=false;$('mockAutoButton').textContent='自動テスト ON'}};
    $('mockAutoButton').onclick=()=>{if(this.device instanceof MockDevice){this.auto=!this.auto;this.device.setAuto(this.auto);$('mockAutoButton').textContent=this.auto?'自動テスト OFF':'自動テスト ON';this.syncMockGoal()}};
    const board=$('losBoard');const move=e=>{if(!(this.device instanceof MockDevice)||!this.drag)return;const r=board.getBoundingClientRect(),x=clamp((e.clientX-r.left)/r.width*2-1,-.88,.88),y=clamp(1-(e.clientY-r.top)/r.height*2,-.88,.88);this.device.setPose(x,y);this.auto=false;$('mockAutoButton').textContent='自動テスト ON'};
    board.onpointerdown=e=>{if(!(this.device instanceof MockDevice))return;this.drag=true;board.setPointerCapture?.(e.pointerId);move(e)};board.onpointermove=move;board.onpointerup=()=>this.drag=false;board.onpointercancel=()=>this.drag=false;
    window.onresize=()=>{this.setupCanvas();this.drawResult()};
    navigator.hid?.addEventListener?.('disconnect',e=>{if(this.device?.device===e.device){this.stop(true);this.connection('Disconnected','error')}});
  }

  setupCanvas(){
    const c=$('trailCanvas'),r=$('losBoard').getBoundingClientRect();if(r.width){this.dpr=Math.min(devicePixelRatio||1,2);c.width=Math.round(r.width*this.dpr);c.height=Math.round(r.height*this.dpr);this.ctx=c.getContext('2d');this.drawTrail()}
    this.resultCtx=$('resultCanvas').getContext('2d');
  }

  async detach(){if(this.unsubscribe){this.unsubscribe();this.unsubscribe=null}if(this.device?.disconnect)await this.device.disconnect().catch(()=>{});this.device=null}
  useMock(){this.device=new MockDevice();this.unsubscribe=this.device.subscribe(f=>this.onFrame(f));this.connection('Mock Device','on');$('mockControls').hidden=false;$('connectButton').hidden=true}
  async setMode(mode){if(mode===this.mode)return;this.stop(false);await this.detach();this.mode=mode;this.zero={lf:0,rf:0,lb:0,rb:0};this.zeroApplied=false;this.center=null;this.recentCop=[];this.updateCenterUI();$('modeMock').classList.toggle('active',mode==='mock');$('modeReal').classList.toggle('active',mode==='real');$('mockControls').hidden=mode!=='mock';$('connectButton').hidden=mode!=='real';if(mode==='mock')this.useMock();else this.connection('Not connected','idle')}
  async connectReal(){try{$('connectButton').disabled=true;this.connection('Connecting…','idle');const d=new WebHidWbbDevice();await d.connect();await this.detach();this.device=d;this.unsubscribe=d.subscribe(f=>this.onFrame(f));this.connection(d.name,'on');$('connectButton').textContent='接続済み';this.show('実機接続しました。ボードから降りてZEROを実行してください。','ok')}catch(e){console.error(e);this.connection('Connection failed','error');$('connectButton').textContent='再接続';this.show(e.message||String(e))}finally{$('connectButton').disabled=false}}
  connection(text,state){$('connectionText').textContent=text;$('statusDot').className='status-dot'+(state==='on'?' on':state==='error'?' error':'')}

  directions(){
    const all=[
      {key:'front',label:'前',arrow:'↑',dx:0,dy:1},
      {key:'front-right',label:'右前',arrow:'↗',dx:Math.SQRT1_2,dy:Math.SQRT1_2},
      {key:'right',label:'右',arrow:'→',dx:1,dy:0},
      {key:'back-right',label:'右後',arrow:'↘',dx:Math.SQRT1_2,dy:-Math.SQRT1_2},
      {key:'back',label:'後',arrow:'↓',dx:0,dy:-1},
      {key:'back-left',label:'左後',arrow:'↙',dx:-Math.SQRT1_2,dy:-Math.SQRT1_2},
      {key:'left',label:'左',arrow:'←',dx:-1,dy:0},
      {key:'front-left',label:'左前',arrow:'↖',dx:-Math.SQRT1_2,dy:Math.SQRT1_2},
    ];
    return this.directionN===8?all:[all[0],all[2],all[4],all[6]];
  }

  applySettings(){this.directionN=+$('directionCount').value;this.reachSeconds=5;this.centerRadius=.10;this.centerHoldSeconds=1;this.dirIndex=0;this.renderDirection();$('timerValue').textContent=this.reachSeconds.toFixed(1)}
  currentDir(){return this.directions()[this.dirIndex]||this.directions()[0]}

  showCenterCue(subtext='開始位置'){
    const box=$('directionDisplay');
    box.classList.remove('reach-mode');
    box.classList.add('center-mode');
    $('directionArrow').textContent='◎';
    $('directionName').textContent='CENTER';
    $('directionIndex').textContent=subtext;
  }

  showReachCue(){
    const d=this.currentDir(),box=$('directionDisplay');
    box.classList.remove('center-mode');
    box.classList.add('reach-mode');
    $('directionArrow').textContent=d.arrow;
    $('directionName').textContent=d.label;
    $('directionIndex').textContent=`${Math.min(this.dirIndex+1,this.directions().length)} / ${this.directions().length}`;
  }
  renderDirection(){
    if(this.state==='running' && this.stage==='reach') this.showReachCue();
    else this.showCenterCue(this.stage==='return' ? '中央へ戻る' : '開始位置');
    this.syncMockGoal();
  }
  place(el,x,y){el.style.left=`${clamp((x+1)/2*100,3,97)}%`;el.style.top=`${clamp((1-y)/2*100,3,97)}%`}

  onFrame(frame){
    const now=performance.now();this.recent.push({t:now,...frame.corners});while(this.recent.length&&now-this.recent[0].t>2500)this.recent.shift();
    const a={lf:Math.max(0,frame.corners.lf-this.zero.lf),rf:Math.max(0,frame.corners.rf-this.zero.rf),lb:Math.max(0,frame.corners.lb-this.zero.lb),rb:Math.max(0,frame.corners.rb-this.zero.rb)},m=Metrics.calc(a,this.threshold);this.last=m;if(m.present&&Number.isFinite(m.copX)){this.recentCop.push({t:now,x:m.copX,y:m.copY});while(this.recentCop.length&&now-this.recentCop[0].t>1800)this.recentCop.shift()}this.renderLive(m);
    if(this.state==='running'&&m.present&&this.center&&Number.isFinite(m.copX))this.process(now,m,frame.raw)
  }

  renderLive(m){
    $('absX').textContent=fmtSigned(m.copX);$('absY').textContent=fmtSigned(m.copY);$('totalKg').textContent=`${m.total.toFixed(1)} kg`;
    $('weightBadge').textContent=m.present?'WEIGHT DETECTED':'NO WEIGHT';$('weightBadge').classList.toggle('green',m.present);$('noWeight').hidden=m.present;
    if(m.present){this.place($('copDot'),m.copX,m.copY)}
    if(this.center&&m.present){$('relX').textContent=fmtSigned(m.copX-this.center.x);$('relY').textContent=fmtSigned(m.copY-this.center.y)}else{$('relX').textContent='—';$('relY').textContent='—'}
  }

  async zeroBoard(){
    if(this.state==='running'||this.state==='countdown')return this.show('テスト中はZEROできません。');
    if(!this.recent.length)return this.show('センサーデータがありません。');
    const l=this.recent[this.recent.length-1],t=l.lf+l.rf+l.lb+l.rb;if(t>=this.threshold)return this.show(`ZEROはボードから降りた状態で実行してください。現在 ${t.toFixed(1)} kg`);
    const start=performance.now();this.show('ZERO取得中…ボードには触れないでください。','ok');await new Promise(r=>setTimeout(r,1000));const s=this.recent.filter(x=>x.t>=start);if(s.length<3)return this.show('ZERO用サンプルが不足しました。');
    for(const k of['lf','rf','lb','rb'])this.zero[k]=s.reduce((a,x)=>a+x[k],0)/s.length;this.zeroApplied=true;this.center=null;this.updateCenterUI();this.show('ZEROを設定しました。次に自然立位でSET CENTERを実行してください。','ok')
  }

  async setCenter(){
    if(this.state==='running'||this.state==='countdown')return this.show('テスト中はCENTERを設定できません。');
    if(this.mode==='real'&&!this.zeroApplied)return this.show('実機では先にボードから降りてZEROを実行してください。');
    if(!this.last?.present)return this.show('ボード上に自然立位で立ってからSET CENTERを押してください。');
    const values=[];const start=performance.now();this.show('CENTER取得中…自然立位を保ってください。','ok');
    while(performance.now()-start<1000){if(this.last?.present)values.push({x:this.last.copX,y:this.last.copY});await new Promise(r=>setTimeout(r,50))}
    if(values.length<5)return this.show('CENTER用サンプルが不足しました。');
    this.center={x:values.reduce((a,v)=>a+v.x,0)/values.length,y:values.reduce((a,v)=>a+v.y,0)/values.length};this.updateCenterUI();this.renderDirection();this.show('CENTERを設定しました。','ok')
  }

  updateCenterUI(){
    const b=$('centerBadge'),m=$('centerMarker');
    if(this.center){b.textContent='CENTER SET';b.classList.add('green');m.hidden=false;this.place(m,this.center.x,this.center.y)}
    else{b.textContent='CENTER NOT SET';b.classList.remove('green');m.hidden=true}
  }

  start(){
    if(this.state==='running'||this.state==='countdown'||this.state==='setup')return;
    if(this.mode==='real'&&!this.device?.connected)return this.show('Wii Balance Boardを接続してください。');

    this.resetSession();
    $('startButton').disabled=true;
    $('stopButton').disabled=false;

    if(this.mode==='mock'){
      if(!this.center){
        if(!this.last?.present){this.state='ready';$('startButton').disabled=false;$('stopButton').disabled=true;return this.show('MOCKの体重を5kg以上にしてください。');}
        this.center={x:this.last.copX,y:this.last.copY};
        this.updateCenterUI();
      }
      this.beginCountdown();
      return;
    }

    this.beginAutoSetup();
  }

  beginAutoSetup(){
    this.state='setup';this.setupPhase='wait-off';this.setupStableSince=null;
    $('stageTitle').textContent='ボードから降りる';this.showCenterCue('AUTO ZERO');
    $('timerLabel').textContent='AUTO SETUP';
    $('timerValue').textContent='—';
    this.feedback('① ボードから降りてください','無荷重を約1秒確認すると、自動でZEROを設定します。','warn');
    this.autoSetupLoop();
  }

  autoSetupLoop(){
    if(this.state!=='setup')return;
    const now=performance.now();

    if(this.setupPhase==='wait-off'){
      const raw=this.recent[this.recent.length-1];
      const total=raw ? raw.lf+raw.rf+raw.lb+raw.rb : Infinity;
      if(total<this.threshold){
        if(this.setupStableSince===null)this.setupStableSince=now;
        const held=(now-this.setupStableSince)/1000;
        $('timerValue').textContent=Math.max(0,1-held).toFixed(1);
        if(held>=1){this.autoZeroFromRecent();return;}
      }else{this.setupStableSince=null;$('timerValue').textContent='—'}
    }else if(this.setupPhase==='wait-on'){
      if(this.last?.present){
        if(this.setupStableSince===null)this.setupStableSince=now;
        const held=(now-this.setupStableSince)/1000;
        $('timerValue').textContent=Math.max(0,1-held).toFixed(1);
        if(held>=1){this.autoCenterFromRecent();return;}
      }else{this.setupStableSince=null;$('timerValue').textContent='—'}
    }

    this.anim=requestAnimationFrame(()=>this.autoSetupLoop());
  }

  autoZeroFromRecent(){
    const now=performance.now(),s=this.recent.filter(x=>now-x.t<=900);
    if(s.length<3){this.setupStableSince=null;return this.autoSetupLoop();}
    for(const k of['lf','rf','lb','rb'])this.zero[k]=s.reduce((a,x)=>a+x[k],0)/s.length;
    this.zeroApplied=true;this.center=null;this.updateCenterUI();
    this.setupPhase='wait-on';this.setupStableSince=null;
    $('stageTitle').textContent='ボードに乗る';this.showCenterCue('AUTO CENTER');
    $('timerLabel').textContent='AUTO CENTER';
    $('timerValue').textContent='—';
    this.feedback('② 自然な姿勢で乗ってください','荷重を検出して約1秒静止すると、CENTERを自動設定します。','neutral');
    this.autoSetupLoop();
  }

  autoCenterFromRecent(){
    const now=performance.now();
    const values=this.recentCop.filter(v=>now-v.t<=900);
    if(values.length<5){this.setupStableSince=null;return this.autoSetupLoop();}
    this.center={x:values.reduce((a,v)=>a+v.x,0)/values.length,y:values.reduce((a,v)=>a+v.y,0)/values.length};
    this.updateCenterUI();
    this.state='ready';this.setupPhase=null;this.setupStableSince=null;
    this.feedback('③ CENTER設定完了','3秒後に測定を開始します。','success');
    this.beginCountdown();
  }

  beginCountdown(){
    this.state='countdown';$('countdown').hidden=false;
    let n=3;$('countdownNumber').textContent=n;
    $('stageTitle').textContent='開始準備';this.showCenterCue('3秒後に開始');
    $('timerLabel').textContent='STARTING';
    this.countdownTimer=setInterval(()=>{n--;if(n<=0){clearInterval(this.countdownTimer);this.countdownTimer=null;$('countdown').hidden=true;this.beginDirection()}else $('countdownNumber').textContent=n},1000)
  }

  beginDirection(){
    if(this.testStartedAt===null){this.testStartedAt=performance.now();this.sessionStartedAt=new Date();this.sessionEndedAt=null;this.measurementSec=0;this.sessionId=SessionDataV02.makeSessionId('limits-of-stability',this.sessionStartedAt);this.events=[SessionDataV02.event(0,'SESSION_START',{phase:'measure'})]}
    this.state='running';this.stage='center';this.events.push(SessionDataV02.event(performance.now()-this.testStartedAt,'CENTER_PHASE_START',{phase:'center',trial:this.dirIndex+1,direction:this.currentDir().key}));this.centerHoldStart=null;this.returnHoldStart=null;this.peakProjection=-Infinity;this.peakAt=0;this.peakPoint=null;this.offAxisSum=0;this.offAxisN=0;
    $('stageTitle').textContent='開始位置を確認';
    $('timerLabel').textContent='CENTER';
    $('timerValue').textContent='1.0';
    this.showCenterCue('開始位置');
    this.feedback('CENTERで準備','中央付近で1秒静止すると、次の方向が表示されます。','neutral');
    this.syncMockGoal();
    this.loop()
  }

  beginReach(now){
    this.stage='reach';this.events.push(SessionDataV02.event(now-this.testStartedAt,'DIRECTION_START',{phase:'reach',trial:this.dirIndex+1,direction:this.currentDir().key}));this.reachStarted=now;this.peakProjection=-Infinity;this.peakAt=0;this.peakPoint=null;this.offAxisSum=0;this.offAxisN=0;
    $('stageTitle').textContent='できるだけ遠くへ';
    $('timerLabel').textContent='REACH';
    $('timerValue').textContent=this.reachSeconds.toFixed(1);
    this.showReachCue();
    this.feedback(this.currentDir().label+'方向へ','足を動かさず、安全に戻れる範囲で重心を移動してください。','warn');
    this.syncMockGoal()
  }

  beginReturn(){
    this.stage='return';this.events.push(SessionDataV02.event(performance.now()-this.testStartedAt,'RETURN_START',{phase:'return',trial:this.dirIndex+1,direction:this.currentDir().key}));this.returnHoldStart=null;this.centerReachedLogged=false;
    $('stageTitle').textContent='中央へ戻る';
    $('timerLabel').textContent='RETURN';
    $('timerValue').textContent='—';
    this.showCenterCue('中央へ戻る');
    this.feedback('中央へ戻る','方向指示は終了です。CENTERまで戻ってください。','neutral');
    this.syncMockGoal()
  }

  process(now,m,raw){
    const rel={x:m.copX-this.center.x,y:m.copY-this.center.y},dist=Math.hypot(rel.x,rel.y);
    if(this.lastPoint)this.totalPath+=Math.hypot(rel.x-this.lastPoint.x,rel.y-this.lastPoint.y);this.lastPoint={x:rel.x,y:rel.y};
    const dir=this.currentDir();const projection=rel.x*dir.dx+rel.y*dir.dy,offAxis=Math.abs(rel.x*dir.dy-rel.y*dir.dx);
    this.samples.push({t:now-(this.testStartedAt||now),stage:this.stage,direction:dir.key,directionLabel:dir.label,absX:m.copX,absY:m.copY,relX:rel.x,relY:rel.y,projection,offAxis,total:m.total,lf:m.lf,rf:m.rf,lb:m.lb,rb:m.rb,raw});

    if(this.stage==='center'){
      if(dist<=this.centerRadius){
        if(this.centerHoldStart===null){
          this.centerHoldStart=now;
          $('stageTitle').textContent='開始位置で1秒静止';
          this.showCenterCue('開始位置で静止');
        }
        const held=(now-this.centerHoldStart)/1000;
        $('timerValue').textContent=Math.max(0,this.centerHoldSeconds-held).toFixed(1);
        this.feedback('そのまま静止',`${Math.min(held,this.centerHoldSeconds).toFixed(1)} / ${this.centerHoldSeconds.toFixed(1)} 秒`,'success');
        if(held>=this.centerHoldSeconds)this.beginReach(now)
      }else{
        this.centerHoldStart=null;
        $('stageTitle').textContent='開始位置へ戻る';
        $('timerValue').textContent='—';
        this.showCenterCue('開始位置へ');
        this.feedback('CENTERへ','次の方向を始める前にCENTERへ戻ってください。','neutral')
      }
    }else if(this.stage==='reach'){
      const elapsed=(now-this.reachStarted)/1000,remain=Math.max(0,this.reachSeconds-elapsed);$('timerValue').textContent=remain.toFixed(1);
      if(projection>this.peakProjection){this.peakProjection=projection;this.peakAt=elapsed;this.peakPoint={x:m.copX,y:m.copY};$('peakMarker').hidden=false;this.place($('peakMarker'),m.copX,m.copY)}
      this.offAxisSum+=offAxis;this.offAxisN++;
      if(remain<=0){const peak=Math.max(0,this.peakProjection);this.results.push({key:dir.key,label:dir.label,maxExcursion:peak,peakTime:this.peakAt,meanOffAxis:this.offAxisN?this.offAxisSum/this.offAxisN:0,peakPoint:this.peakPoint});this.events.push(SessionDataV02.event(now-this.testStartedAt,'PEAK_REACHED',{phase:'reach',trial:this.dirIndex+1,direction:dir.key,value:peak}));this.events.push(SessionDataV02.event(now-this.testStartedAt,'DIRECTION_END',{phase:'reach',trial:this.dirIndex+1,direction:dir.key}));this.drawResult();this.beginReturn()}
    }else if(this.stage==='return'){
      if(dist<=this.centerRadius){
        if(this.returnHoldStart===null){
          this.returnHoldStart=now;if(!this.centerReachedLogged){this.events.push(SessionDataV02.event(now-this.testStartedAt,'CENTER_REACHED',{phase:'return',trial:this.dirIndex+1,direction:dir.key}));this.centerReachedLogged=true;}
          $('stageTitle').textContent='中央で1秒静止';
          $('timerLabel').textContent='HOLD';
          this.showCenterCue('1秒静止');
        }
        const held=(now-this.returnHoldStart)/1000;
        $('timerValue').textContent=Math.max(0,1-held).toFixed(1);
        this.feedback('そのまま静止',`${Math.min(held,1).toFixed(1)} / 1.0 秒`,'success');
        if(held>=1){this.events.push(SessionDataV02.event(now-this.testStartedAt,'CENTER_HOLD_COMPLETE',{phase:'return',trial:this.dirIndex+1,direction:dir.key,value:held}));this.nextDirection()}
      }else{
        this.returnHoldStart=null;
        $('stageTitle').textContent='中央へ戻る';
        $('timerLabel').textContent='RETURN';
        $('timerValue').textContent='—';
        this.showCenterCue('中央へ戻る');
        this.feedback('中央へ戻る',`CENTERまで ${dist.toFixed(3)}`,'neutral')
      }
    }
    this.drawTrail()
  }

  nextDirection(){
    this.dirIndex++;
    const n=this.directions().length;$('progressBar').style.width=`${Math.min(this.dirIndex/n*100,100)}%`;
    if(this.dirIndex>=n)this.finish();else{this.renderDirection();this.beginDirection()}
  }

  loop(){if(this.state!=='running')return;this.anim=requestAnimationFrame(()=>this.loop())}

  syncMockGoal(){
    if(!(this.device instanceof MockDevice)||!this.center)return;
    const d=this.currentDir();let g={x:this.center.x,y:this.center.y};
    if(this.state==='running'&&this.stage==='reach'){const reach=.42;g={x:clamp(this.center.x+d.dx*reach,-.82,.82),y:clamp(this.center.y+d.dy*reach,-.82,.82)}}
    this.device.setGoal(g)
  }

  finish(){
    if(this.anim){cancelAnimationFrame(this.anim);this.anim=null}this.measurementSec=Math.max(0,(performance.now()-this.testStartedAt)/1000);this.sessionEndedAt=new Date();this.state='done';this.stage='done';$('startButton').disabled=false;$('stopButton').disabled=true;$('stageTitle').textContent='完了';$('timerLabel').textContent='COMPLETE';$('timerValue').textContent='0.0';$('progressBar').style.width='100%';$('saveButton').disabled=false;this.events.push(SessionDataV02.event(performance.now()-this.testStartedAt,'SESSION_END',{phase:'measure'}));this.feedback('テスト完了','方向別の最大到達量を確認できます。','success');this.updateSummary();this.drawResult();this.show('Limits of Stabilityテストが終了しました。','ok')
  }

  stop(notify=true){
    if(this.countdownTimer){clearInterval(this.countdownTimer);this.countdownTimer=null}if(this.anim){cancelAnimationFrame(this.anim);this.anim=null}$('countdown').hidden=true;
    if(this.state==='running'||this.state==='countdown'||this.state==='setup'){this.state='ready';this.setupPhase=null;this.setupStableSince=null;this.stage='ready';$('startButton').disabled=false;$('stopButton').disabled=true;$('stageTitle').textContent='STARTを押してください';this.showCenterCue('開始位置');$('timerLabel').textContent='READY';$('timerValue').textContent=this.reachSeconds.toFixed(1);if(notify)this.show('テストを中止しました。')}
  }

  resetSession(){this.dirIndex=0;this.results=[];this.samples=[];this.totalPath=0;this.lastPoint=null;this.testStartedAt=null;this.events=[];this.sessionId=null;this.sessionStartedAt=null;this.sessionEndedAt=null;this.measurementSec=0;this.centerReachedLogged=false;$('progressBar').style.width='0%';$('peakMarker').hidden=true;this.clearTrail();this.resetResults();this.renderDirection()}
  resetResults(){['meanExcursion','bestDirection','worstDirection','lrDifference','fbDifference','totalPath'].forEach(id=>$(id).textContent='—');$('directionResults').innerHTML='';$('resultNote').textContent='テスト終了後に方向別の最大到達量を表示します。';$('saveButton').disabled=true;this.drawResult()}

  updateSummary(){
    if(!this.results.length)return;const vals=this.results.map(r=>r.maxExcursion),mean=vals.reduce((a,b)=>a+b,0)/vals.length,best=this.results.reduce((a,b)=>a.maxExcursion>b.maxExcursion?a:b),worst=this.results.reduce((a,b)=>a.maxExcursion<b.maxExcursion?a:b);
    const get=k=>this.results.find(r=>r.key===k)?.maxExcursion;
    const right=get('right'),left=get('left'),front=get('front'),back=get('back');
    $('meanExcursion').textContent=mean.toFixed(3);$('bestDirection').textContent=best.label;$('worstDirection').textContent=worst.label;$('lrDifference').textContent=Number.isFinite(right)&&Number.isFinite(left)?Math.abs(right-left).toFixed(3):'—';$('fbDifference').textContent=Number.isFinite(front)&&Number.isFinite(back)?Math.abs(front-back).toFixed(3):'—';$('totalPath').textContent=this.totalPath.toFixed(3);
    $('directionResults').innerHTML=this.results.map(r=>`<div class="direction-result"><span>${r.label}</span><strong>${r.maxExcursion.toFixed(3)}</strong></div>`).join('');
    $('resultNote').textContent='CENTERを原点とした正規化CoPの方向別最大投影量です。物理距離（mm/cm）ではありません。'
  }

  drawTrail(){
    if(!this.ctx)return;const c=$('trailCanvas'),r=c.getBoundingClientRect(),ctx=this.ctx;ctx.clearRect(0,0,c.width,c.height);const current=this.samples.filter(s=>s.direction===this.currentDir().key);if(current.length<2)return;ctx.save();ctx.scale(this.dpr,this.dpr);ctx.strokeStyle='rgba(77,136,255,.72)';ctx.lineWidth=2;ctx.beginPath();current.forEach((s,i)=>{const x=(s.absX+1)/2*r.width,y=(1-s.absY)/2*r.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.restore()
  }
  clearTrail(){if(this.ctx){const c=$('trailCanvas');this.ctx.clearRect(0,0,c.width,c.height)}}

  drawResult(){
    const c=$('resultCanvas'),ctx=c.getContext('2d'),w=c.width,h=c.height,cx=w/2,cy=h/2,R=Math.min(w,h)*.34;ctx.clearRect(0,0,w,h);ctx.save();
    ctx.strokeStyle='rgba(70,103,142,.35)';ctx.lineWidth=1;
    for(let q=1;q<=4;q++){ctx.beginPath();ctx.arc(cx,cy,R*q/4,0,Math.PI*2);ctx.stroke()}
    const dirs=this.directions();for(const d of dirs){ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+d.dx*R,cy-d.dy*R);ctx.stroke();ctx.fillStyle='#7188a1';ctx.font='12px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(d.label,cx+d.dx*(R+24),cy-d.dy*(R+24))}
    if(this.results.length){
      const scale=Math.max(.45,...this.results.map(r=>r.maxExcursion))*1.12;
      ctx.beginPath();this.results.forEach((r,i)=>{const d=dirs.find(x=>x.key===r.key)||dirs[i],rr=R*clamp(r.maxExcursion/scale,0,1),x=cx+d.dx*rr,y=cy-d.dy*rr;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.fillStyle='rgba(77,136,255,.18)';ctx.strokeStyle='rgba(101,161,255,.95)';ctx.lineWidth=3;ctx.fill();ctx.stroke();
      for(const r of this.results){const d=dirs.find(x=>x.key===r.key),rr=R*clamp(r.maxExcursion/scale,0,1);ctx.beginPath();ctx.arc(cx+d.dx*rr,cy-d.dy*rr,5,0,Math.PI*2);ctx.fillStyle='#87adff';ctx.fill()}
    }
    ctx.fillStyle='#dfe8f4';ctx.beginPath();ctx.arc(cx,cy,4,0,Math.PI*2);ctx.fill();ctx.restore()
  }

  save(){
    if(!this.results.length)return;
    const vals=this.results.map(r=>r.maxExcursion),mean=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null,get=k=>this.results.find(r=>r.key===k)?.maxExcursion;
    const right=get('right'),left=get('left'),front=get('front'),back=get('back');
    const best=this.results.length?this.results.reduce((a,b)=>a.maxExcursion>b.maxExcursion?a:b):null,worst=this.results.length?this.results.reduce((a,b)=>a.maxExcursion<b.maxExcursion?a:b):null;
    const rows=this.samples.map(s=>({time_ms:Math.round(s.t),lf_kg:s.lf,rf_kg:s.rf,lb_kg:s.lb,rb_kg:s.rb,total_kg:s.total,cop_x_norm:s.absX,cop_y_norm:s.absY,weight_present:s.total>=this.threshold,phase:s.stage,direction:s.direction,direction_label:s.directionLabel,rel_x_norm:s.relX,rel_y_norm:s.relY,projection_from_center_norm:s.projection,off_axis_from_center_norm:s.offAxis,raw_lf:s.raw?.lf??'',raw_rf:s.raw?.rf??'',raw_lb:s.raw?.lb??'',raw_rb:s.raw?.rb??''}));
    SessionDataV02.saveBundle({
      app:{name:'Limits of Stability',slug:'limits-of-stability',version:'1.0 β'},sessionId:this.sessionId,startedAt:this.sessionStartedAt||new Date(),endedAt:this.sessionEndedAt||new Date(),measurementSec:this.measurementSec,mode:this.mode,
      protocol:{directions:this.directionN,reach_duration_sec:this.reachSeconds,center_hold_sec:this.centerHoldSeconds,center_radius_norm:this.centerRadius,center_abs:this.center,zero_applied:this.zeroApplied,weight_threshold_kg:this.threshold},
      metrics:{planned_directions:this.directionN,completed_directions:this.results.length,directions:this.results.map(r=>({direction:r.key,label:r.label,max_excursion_from_center_norm:r.maxExcursion,peak_time_sec:r.peakTime,mean_off_axis_from_center_norm:r.meanOffAxis})),mean_max_excursion_from_center_norm:mean,best_direction:best?.key||null,worst_direction:worst?.key||null,left_right_difference_norm:Number.isFinite(right)&&Number.isFinite(left)?Math.abs(right-left):null,front_back_difference_norm:Number.isFinite(front)&&Number.isFinite(back)?Math.abs(front-back):null,total_cop_path_norm:this.totalPath},
      samples:rows,sampleExtraColumns:['phase','direction','direction_label','rel_x_norm','rel_y_norm','projection_from_center_norm','off_axis_from_center_norm','raw_lf','raw_rf','raw_lb','raw_rb'],events:this.events,
      notes:['CENTER-relative normalized CoP maximum excursion. Values may exceed 1.0 because they are displacement from CENTER, not absolute CoP coordinates. Not physical mm/cm and not a standardized clinical score.']
    });
    this.show('Session Data v0.2の3ファイルを保存しました。','ok');
  }

  feedback(title,text,type){$('feedbackTitle').textContent=title;$('feedbackText').textContent=text;$('feedbackBox').className=`feedback ${type}`}
  show(text,type='warn'){const b=$('alertBox');b.textContent=text;b.hidden=false;b.style.borderColor=type==='ok'?'#2c684c':'#74542c';b.style.background=type==='ok'?'#0d2a20':'#291c0d';b.style.color=type==='ok'?'#8ce9b2':'#ffd7a7';clearTimeout(this.alertTimer);this.alertTimer=setTimeout(()=>b.hidden=true,6000)}
}

window.addEventListener('DOMContentLoaded',()=>{
  const app=new App();
  setInterval(()=>fetch('/__heartbeat',{cache:'no-store'}).catch(()=>{}),5000);
  fetch('/__heartbeat',{cache:'no-store'}).catch(()=>{});
})();
})();
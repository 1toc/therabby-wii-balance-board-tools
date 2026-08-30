(() => {
'use strict';

const $ = id => document.getElementById(id);
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));
const fmtSigned=(v,d=3)=>Number.isFinite(v)?`${v>=0?'+':''}${v.toFixed(d)}`:'—';
const fmt=(v,d=3)=>Number.isFinite(v)?v.toFixed(d):'—';

class Metrics {
  static fromCorners(c, threshold=5){
    const lf=Math.max(0,c.lf||0),rf=Math.max(0,c.rf||0),lb=Math.max(0,c.lb||0),rb=Math.max(0,c.rb||0);
    const total=lf+rf+lb+rb, present=total>=threshold;
    if(!present||total<=0)return {lf,rf,lb,rb,total,present,copX:null,copY:null,leftPct:0,rightPct:0,frontPct:0,backPct:0};
    const left=lf+lb,right=rf+rb,front=lf+rf,back=lb+rb;
    return {lf,rf,lb,rb,total,present,copX:(right-left)/total,copY:(front-back)/total,
      leftPct:left/total*100,rightPct:right/total*100,frontPct:front/total*100,backPct:back/total*100};
  }
}

class MockDevice {
  constructor(){this.listeners=new Set();this.total=70;this.x=0;this.y=0;this.auto=false;this.target={x:.3,y:0};this.phase=0;this.timer=setInterval(()=>this.tick(),32);this.emit();}
  get connected(){return true}
  get name(){return 'Mock Device'}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  setPose(x,y){this.auto=false;this.x=clamp(x,-.88,.88);this.y=clamp(y,-.88,.88);this.emit()}
  setWeight(v){this.total=Math.max(0,v);this.emit()}
  setAuto(v){this.auto=!!v}
  setTarget(t){this.target=t}
  tick(){if(this.auto&&this.total>=5){this.phase+=.032;const ease=.055;this.x+=(this.target.x-this.x)*ease;this.y+=(this.target.y-this.y)*ease;this.x+=Math.sin(this.phase*6)*.002;this.y+=Math.cos(this.phase*5)*.002;}this.emit()}
  corners(){const t=this.total,x=this.x,y=this.y;return {lf:t*(1-x)*(1+y)/4,rf:t*(1+x)*(1+y)/4,lb:t*(1-x)*(1-y)/4,rb:t*(1+x)*(1-y)/4}}
  emit(){const frame={timestamp:performance.now(),corners:this.corners(),raw:null};this.listeners.forEach(fn=>fn(frame))}
  async connect(){}
  async disconnect(){if(this.timer){clearInterval(this.timer);this.timer=null}}
}

class WebHidWbbDevice {
  constructor(){this.device=null;this.listeners=new Set();this.cal=null;this.pending=[];this.keepAlive=null;this.bound=e=>this.onInput(e)}
  get connected(){return !!this.device?.opened}
  get name(){return this.device?.productName||'Wii Balance Board'}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  async connect(){
    if(!('hid' in navigator))throw new Error('WebHID非対応です。Chrome / Edge の localhost または HTTPS で開いてください。');
    const ds=await navigator.hid.requestDevice({filters:[{vendorId:0x057e,productId:0x0306},{vendorId:0x057e}]});
    if(!ds.length)throw new Error('Wii Balance Boardが選択されませんでした。');
    this.device=ds.find(d=>d.productId===0x0306)||ds[0];if(!this.device.opened)await this.device.open();
    this.device.addEventListener('inputreport',this.bound);await this.initialize();
  }
  async disconnect(){if(this.keepAlive)clearInterval(this.keepAlive);if(this.device){this.device.removeEventListener('inputreport',this.bound);if(this.device.opened){await this.send(0x11,[0x00]).catch(()=>{});await this.device.close()}}this.device=null}
  async send(id,bytes){if(!this.device?.opened)throw new Error('WBB未接続');await this.device.sendReport(id,new Uint8Array(bytes))}
  async writeMemory(address,data){const b=new Uint8Array(21);b[0]=0x04;b[1]=(address>>>16)&255;b[2]=(address>>>8)&255;b[3]=address&255;b[4]=data.length;b.set(data.slice(0,16),5);await this.send(0x16,b)}
  async readMemory(address,length,timeout=1800){const low=address&0xffff;return new Promise(async(resolve,reject)=>{const r={base:low,length,buffer:new Uint8Array(length),received:new Set(),resolve,reject};r.timer=setTimeout(()=>{this.pending=this.pending.filter(x=>x!==r);reject(new Error('Calibration read timeout'))},timeout);this.pending.push(r);try{await this.send(0x17,[0x04,(address>>>16)&255,(address>>>8)&255,address&255,(length>>>8)&255,length&255])}catch(e){clearTimeout(r.timer);this.pending=this.pending.filter(x=>x!==r);reject(e)}})}
  async initialize(){await this.send(0x15,[0]);await new Promise(r=>setTimeout(r,80));await this.writeMemory(0xA400F0,new Uint8Array([0x55]));await new Promise(r=>setTimeout(r,50));await this.writeMemory(0xA400FB,new Uint8Array([0]));await new Promise(r=>setTimeout(r,80));this.cal=this.parseCal(await this.readMemory(0xA40024,24));await this.send(0x12,[0x04,0x32]);await this.send(0x11,[0x10]);this.keepAlive=setInterval(()=>this.send(0x15,[0]).catch(()=>{}),5000)}
  parseCal(b){const u16=i=>(b[i]<<8)|b[i+1],names=['rf','rb','lf','lb'],o={};names.forEach((n,i)=>o[n]={zero:u16(i*2),kg17:u16(8+i*2),kg34:u16(16+i*2)});return o}
  rawToKg(raw,c){let kg=raw<c.kg17?17*(raw-c.zero)/(c.kg17-c.zero||1):17+17*(raw-c.kg17)/(c.kg34-c.kg17||1);return Math.max(0,kg)}
  handleRead(d){if(d.byteLength<6)return;const se=d.getUint8(2),err=se&15,size=((se>>4)&15)+1,offset=(d.getUint8(3)<<8)|d.getUint8(4);if(err)return;const chunk=new Uint8Array(d.buffer,d.byteOffset+5,Math.min(size,d.byteLength-5));for(const r of [...this.pending]){const rel=offset-r.base;if(rel<0||rel>=r.length)continue;const n=Math.min(chunk.length,r.length-rel);r.buffer.set(chunk.slice(0,n),rel);for(let i=0;i<n;i++)r.received.add(rel+i);if(r.received.size>=r.length){clearTimeout(r.timer);this.pending=this.pending.filter(x=>x!==r);r.resolve(r.buffer)}}}
  onInput(e){const id=e.reportId,d=e.data;if(id===0x21){this.handleRead(d);return}if(id!==0x32||!this.cal||d.byteLength<10)return;const u16=i=>(d.getUint8(i)<<8)|d.getUint8(i+1),raw={rf:u16(2),rb:u16(4),lf:u16(6),lb:u16(8)},c={lf:this.rawToKg(raw.lf,this.cal.lf),rf:this.rawToKg(raw.rf,this.cal.rf),lb:this.rawToKg(raw.lb,this.cal.lb),rb:this.rawToKg(raw.rb,this.cal.rb)};this.listeners.forEach(fn=>fn({timestamp:performance.now(),corners:c,raw}))}
}

class App {
  constructor(){
    this.mode='mock';this.device=null;this.unsubscribe=null;this.zero={lf:0,rf:0,lb:0,rb:0};this.threshold=5;this.last=null;this.recent=[];
    this.state='ready';this.targetIndex=0;this.reps=0;this.successes=0;this.holdStarted=null;this.reachStarted=null;this.reachTimes=[];this.holdTimes=[];this.errors=[];this.samples=[];this.path=0;this.lastSample=null;this.events=[];this.sessionId=null;this.sessionStartedAt=null;this.sessionEndedAt=null;this.measurementSec=0;this.targetReachedLogged=false;this.targetReentryCount=0;this.holdInterruptionCount=0;
    this.testStart=0;this.testEnd=0;this.countdownTimer=null;this.anim=null;this.canvas=null;this.ctx=null;this.dpr=1;this.drag=false;this.auto=false;
    this.bind();this.setupCanvas();this.useMock();this.applySettings();this.renderTarget();
  }

  bind(){
    $('modeMock').onclick=()=>this.setMode('mock');$('modeReal').onclick=()=>this.setMode('real');$('connectButton').onclick=()=>this.connectReal();
    $('zeroButton').onclick=()=>this.zeroBoard();$('startButton').onclick=()=>this.start();$('stopButton').onclick=()=>this.stop(true);$('saveButton').onclick=()=>this.save();
    ['directionSelect','distanceSelect','holdSelect','repSelect','durationSelect'].forEach(id=>$(id).onchange=()=>{if(this.state==='ready'||this.state==='done'){this.applySettings();this.resetResults();}});
    $('mockWeight').oninput=e=>{if(this.device instanceof MockDevice){this.device.setWeight(+e.target.value);$('mockWeightValue').textContent=`${(+e.target.value).toFixed(1)} kg`}};
    $('mockCenterButton').onclick=()=>{if(this.device instanceof MockDevice){this.device.setPose(0,0);$('mockAutoButton').textContent='自動練習 ON'}};
    $('mockAutoButton').onclick=()=>{if(this.device instanceof MockDevice){this.auto=!this.auto;this.device.setAuto(this.auto);$('mockAutoButton').textContent=this.auto?'自動練習 OFF':'自動練習 ON'}};
    const board=$('copBoard');
    const move=e=>{if(!(this.device instanceof MockDevice)||!this.drag)return;const r=board.getBoundingClientRect(),x=clamp((e.clientX-r.left)/r.width*2-1,-.88,.88),y=clamp(1-(e.clientY-r.top)/r.height*2,-.88,.88);this.device.setPose(x,y);this.auto=false;$('mockAutoButton').textContent='自動練習 ON'};
    board.onpointerdown=e=>{if(!(this.device instanceof MockDevice))return;this.drag=true;board.setPointerCapture?.(e.pointerId);move(e)};board.onpointermove=move;board.onpointerup=()=>this.drag=false;board.onpointercancel=()=>this.drag=false;
    window.onresize=()=>this.setupCanvas();
    navigator.hid?.addEventListener?.('disconnect',e=>{if(this.device?.device===e.device){this.stop(true);this.connection('Disconnected','error')}});
  }

  setupCanvas(){const c=$('trailCanvas'),r=$('copBoard').getBoundingClientRect();if(!r.width)return;this.dpr=Math.min(devicePixelRatio||1,2);c.width=Math.round(r.width*this.dpr);c.height=Math.round(r.height*this.dpr);this.canvas=c;this.ctx=c.getContext('2d');this.drawTrail()}
  async detach(){if(this.unsubscribe){this.unsubscribe();this.unsubscribe=null}if(this.device?.disconnect)await this.device.disconnect().catch(()=>{});this.device=null}
  useMock(){this.device=new MockDevice();this.unsubscribe=this.device.subscribe(f=>this.onFrame(f));this.connection('Mock Device','on');$('mockControls').hidden=false;$('connectButton').hidden=true}
  async setMode(mode){if(mode===this.mode)return;this.stop(false);await this.detach();this.mode=mode;this.zero={lf:0,rf:0,lb:0,rb:0};$('modeMock').classList.toggle('active',mode==='mock');$('modeReal').classList.toggle('active',mode==='real');$('mockControls').hidden=mode!=='mock';$('connectButton').hidden=mode!=='real';if(mode==='mock')this.useMock();else this.connection('Not connected','idle')}
  async connectReal(){try{$('connectButton').disabled=true;this.connection('Connecting…','idle');const d=new WebHidWbbDevice();await d.connect();await this.detach();this.device=d;this.unsubscribe=d.subscribe(f=>this.onFrame(f));this.connection(d.name,'on');$('connectButton').textContent='接続済み';this.show('実機接続しました。ボードから降りてZEROを実行してください。','ok')}catch(e){console.error(e);this.connection('Connection failed','error');$('connectButton').textContent='再接続';this.show(e.message||String(e))}finally{$('connectButton').disabled=false}}
  connection(text,state){$('connectionText').textContent=text;$('statusDot').className='dot-status'+(state==='on'?' on':state==='error'?' error':'')}

  applySettings(){
    this.direction=$('directionSelect').value;this.distance=+$('distanceSelect').value;this.holdRequired=+$('holdSelect').value;this.repGoal=+$('repSelect').value;this.duration=+$('durationSelect').value;this.radius=.10;
    this.targetIndex=0;this.renderTarget();$('targetDistance').textContent=this.distance.toFixed(3);$('targetRadius').textContent=`±${this.radius.toFixed(3)}`;$('timer').textContent=`00:${String(this.duration).padStart(2,'0')}`;$('repText').textContent=`0 / ${this.repGoal}`;
  }

  targetForIndex(i){
    let d=this.distance;
    if(this.direction==='right')return{x:d,y:0,name:'右へ荷重移動'};
    if(this.direction==='left')return{x:-d,y:0,name:'左へ荷重移動'};
    if(this.direction==='front')return{x:0,y:d,name:'前へ荷重移動'};
    if(this.direction==='back')return{x:0,y:-d,name:'後へ荷重移動'};
    if(this.direction==='alternate-lr')return i%2===0?{x:d,y:0,name:'右へ荷重移動'}:{x:-d,y:0,name:'左へ荷重移動'};
    return i%2===0?{x:0,y:d,name:'前へ荷重移動'}:{x:0,y:-d,name:'後へ荷重移動'};
  }

  renderTarget(){this.target=this.targetForIndex(this.targetIndex);const z=$('targetZone');z.style.left=`${(this.target.x+1)/2*100}%`;z.style.top=`${(1-this.target.y)/2*100}%`;$('taskTitle').textContent=this.target.name;if(this.device instanceof MockDevice)this.device.setTarget(this.target)}
  onFrame(frame){
    const now=performance.now();this.recent.push({t:now,...frame.corners});while(this.recent.length&&now-this.recent[0].t>2500)this.recent.shift();
    const a={lf:Math.max(0,frame.corners.lf-this.zero.lf),rf:Math.max(0,frame.corners.rf-this.zero.rf),lb:Math.max(0,frame.corners.lb-this.zero.lb),rb:Math.max(0,frame.corners.rb-this.zero.rb)},m=Metrics.fromCorners(a,this.threshold);this.last=m;
    this.render(m);
    if(this.state==='running'&&m.present&&Number.isFinite(m.copX))this.processTraining(now,m,frame.raw);
  }

  render(m){
    $('lfKg').textContent=m.lf.toFixed(1);$('rfKg').textContent=m.rf.toFixed(1);$('lbKg').textContent=m.lb.toFixed(1);$('rbKg').textContent=m.rb.toFixed(1);$('totalKg').textContent=`${m.total.toFixed(1)} kg`;
    $('lrRatio').textContent=m.present?`${Math.round(m.leftPct)} : ${Math.round(m.rightPct)}`:'—';$('fbRatio').textContent=m.present?`${Math.round(m.frontPct)} : ${Math.round(m.backPct)}`:'—';
    $('copX').textContent=fmtSigned(m.copX);$('copY').textContent=fmtSigned(m.copY);$('weightBadge').textContent=m.present?'WEIGHT DETECTED':'NO WEIGHT';$('weightBadge').classList.toggle('on',m.present);$('noWeight').hidden=m.present;
    if(m.present){$('copDot').style.left=`${clamp((m.copX+1)/2*100,4,96)}%`;$('copDot').style.top=`${clamp((1-m.copY)/2*100,4,96)}%`}
  }

  async zeroBoard(){
    if(this.state==='running'||this.state==='countdown')return this.show('トレーニング中はZEROできません。');
    if(!this.recent.length)return this.show('センサーデータがありません。');
    const latest=this.recent[this.recent.length-1],total=latest.lf+latest.rf+latest.lb+latest.rb;if(total>=this.threshold)return this.show(`ZEROはボードから降りた状態で実行してください。現在 ${total.toFixed(1)} kg`);
    const start=performance.now();this.show('ZERO取得中…ボードには触れないでください。','ok');await new Promise(r=>setTimeout(r,1000));const s=this.recent.filter(x=>x.t>=start);if(s.length<3)return this.show('ZERO用サンプルが不足しました。');
    for(const k of ['lf','rf','lb','rb'])this.zero[k]=s.reduce((a,x)=>a+x[k],0)/s.length;this.show('ZEROを設定しました。','ok');
  }

  start(){
    if(this.state==='running'||this.state==='countdown')return;
    if(!this.last?.present)return this.show('ボード上に立ってからSTARTを押してください。');
    if(this.mode==='real'&&!this.device?.connected)return this.show('Wii Balance Boardが接続されていません。');
    this.resetSession();this.state='countdown';$('countdown').hidden=false;$('startButton').disabled=true;$('stopButton').disabled=false;
    let n=3;$('countdownNumber').textContent=n;this.countdownTimer=setInterval(()=>{n--;if(n<=0){clearInterval(this.countdownTimer);this.countdownTimer=null;$('countdown').hidden=true;this.begin()}else $('countdownNumber').textContent=n},1000)
  }
  begin(){this.state='running';this.testStart=performance.now();this.sessionStartedAt=new Date();this.sessionEndedAt=null;this.measurementSec=0;this.sessionId=SessionDataV02.makeSessionId('weight-shift-trainer',this.sessionStartedAt);this.events=[SessionDataV02.event(0,'SESSION_START',{phase:'training'})];this.testEnd=this.testStart+this.duration*1000;this.reachStarted=this.testStart;this.renderTarget();this.targetReachedLogged=false;this.events.push(SessionDataV02.event(0,'TARGET_START',{phase:'reach',trial:1,direction:this.targetDirection()}));this.feedback('目標へ移動','目標円の中にCoPを移動し、その位置を保持してください。','neutral');this.loop()}
  loop(){if(this.state!=='running')return;const rem=Math.max(0,(this.testEnd-performance.now())/1000),s=Math.ceil(rem);$('timer').textContent=`00:${String(s).padStart(2,'0')}`;if(rem<=0||this.successes>=this.repGoal)this.finish();else this.anim=requestAnimationFrame(()=>this.loop())}

  targetDirection(){if(Math.abs(this.target.x)>=Math.abs(this.target.y))return this.target.x>=0?'right':'left';return this.target.y>=0?'front':'back'}

  processTraining(now,m,raw){
    const error=Math.hypot(m.copX-this.target.x,m.copY-this.target.y),inside=error<=this.radius,trial=this.successes+1,direction=this.targetDirection(),phase=inside?'hold':'reach';
    $('targetZone').classList.toggle('hit',inside);
    this.errors.push(error);
    if(this.lastSample)this.path+=Math.hypot(m.copX-this.lastSample.x,m.copY-this.lastSample.y);this.lastSample={x:m.copX,y:m.copY};
    this.samples.push({t:now-this.testStart,x:m.copX,y:m.copY,targetX:this.target.x,targetY:this.target.y,error,total:m.total,lf:m.lf,rf:m.rf,lb:m.lb,rb:m.rb,raw,trial,phase,direction});
    if(inside){
      if(this.holdStarted===null){this.holdStarted=now;if(!this.targetReachedLogged){const reach=(now-this.reachStarted)/1000;this.reachTimes.push(reach);this.events.push(SessionDataV02.event(now-this.testStart,'TARGET_REACHED',{phase:'hold',trial,direction,value:reach}));this.targetReachedLogged=true}else{this.targetReentryCount++;this.events.push(SessionDataV02.event(now-this.testStart,'TARGET_REENTRY',{phase:'hold',trial,direction,value:error}))}}
      const held=(now-this.holdStarted)/1000;
      this.feedback('そのまま保持',`${Math.min(held,this.holdRequired).toFixed(1)} / ${this.holdRequired.toFixed(1)} 秒`,'success');
      if(held>=this.holdRequired){this.holdTimes.push(held);this.events.push(SessionDataV02.event(now-this.testStart,'HOLD_SUCCESS',{phase:'hold',trial,direction,value:held}));this.successes++;this.reps++;$('repText').textContent=`${this.successes} / ${this.repGoal}`;$('progressBar').style.width=`${this.successes/this.repGoal*100}%`;this.targetIndex++;this.holdStarted=null;this.reachStarted=now;this.renderTarget();this.targetReachedLogged=false;if(this.successes<this.repGoal)this.events.push(SessionDataV02.event(now-this.testStart,'TARGET_START',{phase:'reach',trial:this.successes+1,direction:this.targetDirection()}));this.feedback('達成','次の目標へ移動してください。','success')}
    }else{
      if(this.holdStarted!==null){this.holdInterruptionCount++;this.events.push(SessionDataV02.event(now-this.testStart,'HOLD_INTERRUPTED',{phase:'reach',trial,direction}));this.holdStarted=null;}
      const dx=this.target.x-m.copX,dy=this.target.y-m.copY;let cue=Math.abs(dx)>Math.abs(dy)?(dx>0?'もう少し右へ':'もう少し左へ'):(dy>0?'もう少し前へ':'もう少し後へ');
      this.feedback(cue,`目標まで ${error.toFixed(3)}`,'neutral')
    }
  }

  feedback(title,text,type){$('feedbackTitle').textContent=title;$('feedbackText').textContent=text;$('feedbackBox').className=`feedback ${type}`}
  stop(notify=true){if(this.countdownTimer){clearInterval(this.countdownTimer);this.countdownTimer=null}if(this.anim){cancelAnimationFrame(this.anim);this.anim=null}$('countdown').hidden=true;$('targetZone').classList.remove('hit');if(this.state==='running'||this.state==='countdown'){this.state='ready';$('startButton').disabled=false;$('stopButton').disabled=true;if(notify)this.show('トレーニングを中止しました。')}}

  finish(){
    if(this.anim){cancelAnimationFrame(this.anim);this.anim=null}this.measurementSec=Math.max(0,(performance.now()-this.testStart)/1000);this.sessionEndedAt=new Date();this.state='done';$('startButton').disabled=false;$('stopButton').disabled=true;$('targetZone').classList.remove('hit');
    const rate=this.repGoal?this.successes/this.repGoal*100:0,avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null,reach=avg(this.reachTimes),hold=avg(this.holdTimes),err=avg(this.errors);
    $('resultSuccess').textContent=`${this.successes} / ${this.repGoal}`;$('resultRate').textContent=rate.toFixed(0);$('resultReach').textContent=fmt(reach,2);$('resultHold').textContent=fmt(hold,2);$('resultError').textContent=fmt(err,3);$('resultPath').textContent=fmt(this.path,3);
    this.events.push(SessionDataV02.event(performance.now()-this.testStart,'SESSION_END',{phase:'training'}));$('resultNote').textContent='正規化CoPに基づくセッション内の参考値です。標準化された臨床評価スコアではありません。';$('saveButton').disabled=false;this.feedback('終了','結果を確認できます。','success');this.show('トレーニングが終了しました。','ok')
  }

  resetSession(){this.targetIndex=0;this.successes=0;this.reps=0;this.holdStarted=null;this.reachStarted=null;this.reachTimes=[];this.holdTimes=[];this.errors=[];this.samples=[];this.path=0;this.lastSample=null;this.events=[];this.sessionId=null;this.sessionStartedAt=null;this.sessionEndedAt=null;this.measurementSec=0;this.targetReachedLogged=false;this.targetReentryCount=0;this.holdInterruptionCount=0;$('progressBar').style.width='0%';$('repText').textContent=`0 / ${this.repGoal}`;this.clearTrail();this.resetResults()}
  resetResults(){['resultSuccess','resultRate','resultReach','resultHold','resultError','resultPath'].forEach(id=>$(id).textContent='—');$('resultNote').textContent='トレーニング終了後に結果を表示します。';$('saveButton').disabled=true}
  drawTrail(){if(!this.ctx)return;const c=this.canvas,r=c.getBoundingClientRect(),ctx=this.ctx;ctx.clearRect(0,0,c.width,c.height);if(this.samples.length<2)return;ctx.save();ctx.scale(this.dpr,this.dpr);ctx.strokeStyle='rgba(77,136,255,.7)';ctx.lineWidth=2;ctx.beginPath();this.samples.forEach((s,i)=>{const x=(s.x+1)/2*r.width,y=(1-s.y)/2*r.height;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.restore()}
  clearTrail(){if(this.ctx)this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height)}

  save(){
    if(!this.samples.length)return;
    const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
    const startedTrials=this.events.filter(e=>e.event==='TARGET_START').length;
    const rows=this.samples.map(s=>({time_ms:Math.round(s.t),lf_kg:s.lf,rf_kg:s.rf,lb_kg:s.lb,rb_kg:s.rb,total_kg:s.total,cop_x_norm:s.x,cop_y_norm:s.y,weight_present:s.total>=this.threshold,trial:s.trial,phase:s.phase,direction:s.direction,target_x_norm:s.targetX,target_y_norm:s.targetY,target_error_norm:s.error,raw_lf:s.raw?.lf??'',raw_rf:s.raw?.rf??'',raw_lb:s.raw?.lb??'',raw_rb:s.raw?.rb??''}));
    SessionDataV02.saveBundle({
      app:{name:'Weight Shift Trainer',slug:'weight-shift-trainer',version:'1.0 β'},sessionId:this.sessionId,startedAt:this.sessionStartedAt||new Date(),endedAt:this.sessionEndedAt||new Date(),measurementSec:this.measurementSec,mode:this.mode,
      protocol:{direction_mode:this.direction,target_distance_norm:this.distance,target_radius_norm:this.radius,hold_sec:this.holdRequired,repetitions:this.repGoal,duration_sec:this.duration,zero_applied:Object.values(this.zero).some(v=>Math.abs(v)>1e-6),weight_threshold_kg:this.threshold},
      metrics:{planned_trials:this.repGoal,started_trials:startedTrials,completed_trials:this.successes,successful_trials:this.successes,completion_rate_pct:this.repGoal?this.successes/this.repGoal*100:0,success_rate_started_pct:startedTrials?this.successes/startedTrials*100:0,mean_first_target_acquisition_sec:avg(this.reachTimes),target_reentry_count:this.targetReentryCount,hold_interruption_count:this.holdInterruptionCount,mean_hold_time_sec:avg(this.holdTimes),mean_target_error_norm:avg(this.errors),total_cop_path_norm:this.path},
      samples:rows,sampleExtraColumns:['trial','phase','direction','target_x_norm','target_y_norm','target_error_norm','raw_lf','raw_rf','raw_lb','raw_rb'],events:this.events,
      notes:['Training performance metrics based on normalized CoP; not a standardized clinical score.']
    });
    this.show('Session Data v0.2の3ファイルを保存しました。','ok');
  }
  show(text,type='warn'){const b=$('alertBox');b.textContent=text;b.hidden=false;b.style.borderColor=type==='ok'?'#2c684c':'#74542c';b.style.background=type==='ok'?'#0d2a20':'#291c0d';b.style.color=type==='ok'?'#8ce9b2':'#ffd7a7';clearTimeout(this.alertTimer);this.alertTimer=setTimeout(()=>b.hidden=true,6000)}
}

window.addEventListener('DOMContentLoaded',()=>{const app=new App();setInterval(()=>fetch('/__heartbeat',{cache:'no-store'}).catch(()=>{}),5000);fetch('/__heartbeat',{cache:'no-store'}).catch(()=>{});setInterval(()=>{if(app.state==='running')app.drawTrail()},100)});
})();

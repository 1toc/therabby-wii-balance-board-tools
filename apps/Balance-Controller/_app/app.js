(() => {
'use strict';

const $ = id => document.getElementById(id);
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const fmtSigned=(v,d=3)=>Number.isFinite(v)?`${v>=0?'+':''}${v.toFixed(d)}`:'—';

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
  constructor(){this.listeners=new Set();this.total=70;this.x=0;this.y=0;this.orbit=false;this.phase=0;this.timer=setInterval(()=>this.tick(),32);this.emit()}
  get connected(){return true} get name(){return'Mock Device'}
  subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
  setPose(x,y){this.orbit=false;this.x=clamp(x,-.88,.88);this.y=clamp(y,-.88,.88);this.emit()}
  setWeight(v){this.total=Math.max(0,v);this.emit()}
  tap(){const original=this.total;this.total=original*1.13;this.emit();setTimeout(()=>{this.total=original;this.emit()},70)}
  setOrbit(v){this.orbit=!!v}
  tick(){if(this.orbit&&this.total>=5){this.phase+=.025;this.x=Math.sin(this.phase*1.7)*.42;this.y=Math.cos(this.phase*1.15)*.35}this.emit()}
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
    this.device=ds.find(d=>d.productId===0x0306)||ds[0];
    if(!this.device.opened)await this.device.open();
    this.device.addEventListener('inputreport',this.bound);
    await this.initialize();
  }
  async disconnect(){
    if(this.keepAlive)clearInterval(this.keepAlive);
    if(this.device){
      this.device.removeEventListener('inputreport',this.bound);
      if(this.device.opened){
        await this.send(0x11,[0x00]).catch(()=>{});
        await this.device.close();
      }
    }
    this.device=null;
  }
  async send(id,b){if(!this.device?.opened)throw new Error('WBB未接続');await this.device.sendReport(id,new Uint8Array(b))}
  async writeMemory(a,data){const b=new Uint8Array(21);b[0]=0x04;b[1]=(a>>>16)&255;b[2]=(a>>>8)&255;b[3]=a&255;b[4]=data.length;b.set(data.slice(0,16),5);await this.send(0x16,b)}
  async readMemory(a,len,timeout=1800){const low=a&0xffff;return new Promise(async(resolve,reject)=>{const r={base:low,length:len,buffer:new Uint8Array(len),received:new Set(),resolve,reject};r.timer=setTimeout(()=>{this.pending=this.pending.filter(x=>x!==r);reject(new Error('Calibration read timeout'))},timeout);this.pending.push(r);try{await this.send(0x17,[0x04,(a>>>16)&255,(a>>>8)&255,a&255,(len>>>8)&255,len&255])}catch(e){clearTimeout(r.timer);this.pending=this.pending.filter(x=>x!==r);reject(e)}})}
  async initialize(){
    await this.send(0x15,[0]);
    await new Promise(r=>setTimeout(r,80));
    await this.writeMemory(0xA400F0,new Uint8Array([0x55]));
    await new Promise(r=>setTimeout(r,50));
    await this.writeMemory(0xA400FB,new Uint8Array([0]));
    await new Promise(r=>setTimeout(r,80));
    this.cal=this.parseCal(await this.readMemory(0xA40024,24));
    await this.send(0x12,[0x04,0x32]);
    await this.send(0x11,[0x10]);
    this.keepAlive=setInterval(()=>this.send(0x15,[0]).catch(()=>{}),5000);
  }
  parseCal(b){const u16=i=>(b[i]<<8)|b[i+1],names=['rf','rb','lf','lb'],o={};names.forEach((n,i)=>o[n]={zero:u16(i*2),kg17:u16(8+i*2),kg34:u16(16+i*2)});return o}
  rawToKg(raw,c){let kg=raw<c.kg17?17*(raw-c.zero)/(c.kg17-c.zero||1):17+17*(raw-c.kg17)/(c.kg34-c.kg17||1);return Math.max(0,kg)}
  handleRead(d){if(d.byteLength<6)return;const se=d.getUint8(2),err=se&15,size=((se>>4)&15)+1,offset=(d.getUint8(3)<<8)|d.getUint8(4);if(err)return;const chunk=new Uint8Array(d.buffer,d.byteOffset+5,Math.min(size,d.byteLength-5));for(const r of [...this.pending]){const rel=offset-r.base;if(rel<0||rel>=r.length)continue;const n=Math.min(chunk.length,r.length-rel);r.buffer.set(chunk.slice(0,n),rel);for(let i=0;i<n;i++)r.received.add(rel+i);if(r.received.size>=r.length){clearTimeout(r.timer);this.pending=this.pending.filter(x=>x!==r);r.resolve(r.buffer)}}}
  onInput(e){const id=e.reportId,d=e.data;if(id===0x21){this.handleRead(d);return}if(id!==0x32||!this.cal||d.byteLength<10)return;const u16=i=>(d.getUint8(i)<<8)|d.getUint8(i+1),raw={rf:u16(2),rb:u16(4),lf:u16(6),lb:u16(8)},c={lf:this.rawToKg(raw.lf,this.cal.lf),rf:this.rawToKg(raw.rf,this.cal.rf),lb:this.rawToKg(raw.lb,this.cal.lb),rb:this.rawToKg(raw.rb,this.cal.rb)};this.listeners.forEach(fn=>fn({timestamp:performance.now(),corners:c,raw}))}
}

class App {
  constructor(){this.mode='mock';this.device=null;this.unsubscribe=null;this.thresholdKg=5;this.center=null;this.last=null;this.deadZone=.10;this.mouseSpeed=700;this.tapSensitivity=.08;this.mouseEnabled=false;this.latestOutput={x:0,y:0};this.mouseBusy=false;this.moveRemainder={x:0,y:0};this.lastMouseTick=performance.now();this.tapBaseline=null;this.lastTotal=null;this.lastTapAt=0;this.previousTapAt=0;this.tapFreezeUntil=0;this.tapArmedAt=0;this.clickCount=0;this.doubleClickCount=0;this.drag=false;this.sessionId=null;this.sessionStartedAt=null;this.sessionPerfStart=0;this.sessionSamples=[];this.sessionEvents=[];this.sessionMouseDistancePx=0;this.sessionMouseMoveEvents=0;this.sessionActiveMs=0;this.mouseOnPerfStart=null;this.pendingMouseDx=0;this.pendingMouseDy=0;this.sessionEndedAt=null;this.sessionSaved=false;this.lastTapImpulse=0;this.bind();this.useMock();this.updateSettingsUI();this.mouseTimer=setInterval(()=>this.mouseTick(),33)}
  bind(){$('modeMock').onclick=()=>this.setMode('mock');$('modeReal').onclick=()=>this.setMode('real');$('connectButton').onclick=()=>this.connectReal();$('centerButton').onclick=()=>this.setCenter();$('mouseToggle').onclick=()=>this.toggleMouse();$('testClickButton').onclick=()=>this.nativeClick('TEST CLICK');$('saveSessionButton').onclick=()=>this.saveSession();$('mouseSpeed').oninput=e=>{this.mouseSpeed=+e.target.value;this.updateSettingsUI()};$('deadZoneInput').oninput=e=>{this.deadZone=+e.target.value;this.updateSettingsUI()};$('tapSensitivity').oninput=e=>{this.tapSensitivity=+e.target.value/100;this.updateSettingsUI()};$('mockWeight').oninput=e=>{if(this.device instanceof MockDevice){this.device.setWeight(+e.target.value);$('mockWeightValue').textContent=`${(+e.target.value).toFixed(1)} kg`}};$('mockCenterButton').onclick=()=>{if(this.device instanceof MockDevice)this.device.setPose(this.center?.x||0,this.center?.y||0)};$('mockTapButton').onclick=()=>{if(this.device instanceof MockDevice)this.device.tap()};const field=$('controllerField');const move=e=>{if(!(this.device instanceof MockDevice)||!this.drag)return;const r=field.getBoundingClientRect(),x=clamp((e.clientX-r.left)/r.width*2-1,-.88,.88),y=clamp(1-(e.clientY-r.top)/r.height*2,-.88,.88);this.device.setPose(x,y)};field.onpointerdown=e=>{if(!(this.device instanceof MockDevice))return;this.drag=true;field.setPointerCapture?.(e.pointerId);move(e)};field.onpointermove=move;field.onpointerup=()=>this.drag=false;field.onpointercancel=()=>this.drag=false;navigator.hid?.addEventListener?.('disconnect',e=>{if(this.device?.device===e.device){this.setMouseEnabled(false);this.connection('Disconnected','error')}})}
  async detach(){this.setMouseEnabled(false);if(this.unsubscribe){this.unsubscribe();this.unsubscribe=null}if(this.device?.disconnect)await this.device.disconnect().catch(()=>{});this.device=null}
  useMock(){this.device=new MockDevice();this.unsubscribe=this.device.subscribe(f=>this.onFrame(f));this.connection('Mock Device','on');$('mockControls').hidden=false;$('connectButton').hidden=true}
  async setMode(mode){if(mode===this.mode)return;await this.detach();this.mode=mode;this.center=null;this.tapBaseline=null;this.updateCenterUI();$('modeMock').classList.toggle('active',mode==='mock');$('modeReal').classList.toggle('active',mode==='real');$('mockControls').hidden=mode!=='mock';$('connectButton').hidden=mode!=='real';if(mode==='mock')this.useMock();else this.connection('Not connected','idle')}
  async connectReal(){try{$('connectButton').disabled=true;this.connection('Connecting…','idle');const d=new WebHidWbbDevice();await d.connect();await this.detach();this.device=d;this.unsubscribe=d.subscribe(f=>this.onFrame(f));this.connection(d.name,'on');$('connectButton').textContent='接続済み';this.show('接続しました。自然立位でSET CENTERを押してください。','ok')}catch(e){console.error(e);this.connection('Connection failed','error');$('connectButton').textContent='再接続';this.show(e.message||String(e))}finally{$('connectButton').disabled=false}}
  connection(text,state){$('connectionText').textContent=text;$('statusDot').className='status-dot'+(state==='on'?' on':state==='error'?' error':'')}
  setCenter(){if(!this.last?.present)return this.show('ボード上に自然立位で立ってからSET CENTERを押してください。');this.center={x:this.last.copX,y:this.last.copY};this.updateCenterUI();this.tapBaseline=this.last.total;this.lastTotal=this.last.total;this.tapArmedAt=performance.now()+1000;this.show('CENTERを設定しました。中央に戻すとマウスが止まります。','ok')}
  updateCenterUI(){const b=$('centerBadge'),m=$('centerMarker');if(this.center){b.textContent='CENTER SET';b.classList.add('green');m.hidden=false;this.place(m,this.center.x,this.center.y)}else{b.textContent='CENTER NOT SET';b.classList.remove('green');m.hidden=true}}
  updateSettingsUI(){$('speedValue').textContent=`${this.mouseSpeed} px/s`;$('deadZoneValue').textContent=this.deadZone.toFixed(2);$('tapValue').textContent=`${Math.round(this.tapSensitivity*100)}%`;$('deadZone').style.width=`${Math.max(4,this.deadZone*100)}%`}
  onFrame(frame){const m=Metrics.calc(frame.corners,this.thresholdKg);this.last=m;$('totalKg').textContent=`${m.total.toFixed(1)} kg`;$('currentKg').textContent=`${m.total.toFixed(1)} kg`;$('weightBadge').textContent=m.present?'WEIGHT DETECTED':'NO WEIGHT';$('weightBadge').classList.toggle('green',m.present);$('noWeight').hidden=m.present;if(!m.present){this.latestOutput={x:0,y:0};$('outX').textContent='—';$('outY').textContent='—';$('directionText').textContent='STOP';return}this.renderOutput(m);this.detectTap(m.total,performance.now());if(this.sessionId&&this.mouseEnabled)this.logSessionSample(frame,m)}
  transform(m){let x=this.center?m.copX-this.center.x:m.copX,y=this.center?m.copY-this.center.y:m.copY;const mag=Math.hypot(x,y);if(mag<=this.deadZone)return{x:0,y:0};const usable=clamp((mag-this.deadZone)/(1-this.deadZone),0,1),nx=x/mag,ny=y/mag;return{x:clamp(nx*usable,-1,1),y:clamp(ny*usable,-1,1)}}
  renderOutput(m){const o=this.transform(m);this.latestOutput=o;$('outX').textContent=fmtSigned(o.x);$('outY').textContent=fmtSigned(o.y);$('directionText').textContent=this.directionName(o.x,o.y);this.place($('pointer'),o.x,o.y)}
  directionName(x,y){if(Math.hypot(x,y)<.02)return'STOP';if(Math.abs(x)>Math.abs(y))return x>0?'RIGHT':'LEFT';return y>0?'UP':'DOWN'}
  toggleMouse(){if(!this.center)return this.show('先にSET CENTERを押してください。');this.setMouseEnabled(!this.mouseEnabled)}
  setMouseEnabled(on){
    const now=performance.now();
    if(on===this.mouseEnabled)return;
    if(on&&!this.sessionId)this.startSession();
    if(!on&&this.mouseEnabled&&this.sessionId){
      if(this.mouseOnPerfStart!==null)this.sessionActiveMs+=Math.max(0,now-this.mouseOnPerfStart);
      this.mouseOnPerfStart=null;
      this.sessionEvents.push(SessionDataV02.event(now-this.sessionPerfStart,'MOUSE_CONTROL_OFF',{phase:'application'}));
    }
    this.mouseEnabled=!!on;
    if(on){
      this.mouseOnPerfStart=now;
      this.sessionEvents.push(SessionDataV02.event(now-this.sessionPerfStart,'MOUSE_CONTROL_ON',{phase:'application'}));
      this.tapBaseline=this.last?.total||null;this.lastTotal=this.last?.total||null;this.tapArmedAt=now+1000;
      this.show('マウス操作をONにしました。最初の1秒は足トン検出を安定化します。','ok')
    }
    const box=$('mouseStatus'),btn=$('mouseToggle');box.classList.toggle('on',this.mouseEnabled);box.querySelector('strong').textContent=this.mouseEnabled?'ON':'OFF';btn.classList.toggle('on',this.mouseEnabled);btn.textContent=this.mouseEnabled?'MOUSE CONTROL OFF':'MOUSE CONTROL ON';if(!on)this.latestOutput={x:0,y:0}
  }
  async mouseTick(){
    const now=performance.now(),dt=Math.min(.08,(now-this.lastMouseTick)/1000);this.lastMouseTick=now;
    if(!this.mouseEnabled||!this.center||!this.last?.present||now<this.tapFreezeUntil||this.mouseBusy)return;
    const o=this.latestOutput;if(Math.abs(o.x)<.001&&Math.abs(o.y)<.001)return;
    this.moveRemainder.x+=o.x*this.mouseSpeed*dt;this.moveRemainder.y+=-o.y*this.mouseSpeed*dt;
    const dx=Math.trunc(this.moveRemainder.x),dy=Math.trunc(this.moveRemainder.y);if(!dx&&!dy)return;
    this.moveRemainder.x-=dx;this.moveRemainder.y-=dy;
    if(this.sessionId){this.sessionMouseDistancePx+=Math.hypot(dx,dy);this.sessionMouseMoveEvents++;this.pendingMouseDx+=dx;this.pendingMouseDy+=dy;}
    this.mouseBusy=true;fetch(`/__mouse_move?dx=${dx}&dy=${dy}`,{cache:'no-store'}).catch(()=>{}).finally(()=>{this.mouseBusy=false})
  }
  detectTap(total,now){if(!Number.isFinite(total)||total<this.thresholdKg){this.tapBaseline=null;this.lastTotal=total;return}if(this.tapBaseline===null){this.tapBaseline=total;this.lastTotal=total;return}const impulse=(total-this.tapBaseline)/Math.max(this.tapBaseline,20),rise=(total-(this.lastTotal??total))/Math.max(this.tapBaseline,20);$('baselineKg').textContent=`${this.tapBaseline.toFixed(1)} kg`;$('tapImpulse').textContent=`${Math.max(0,impulse*100).toFixed(1)}%`;$('tapMeter').style.width=`${clamp(Math.max(0,impulse)/Math.max(this.tapSensitivity,.01)*100,0,100)}%`;this.lastTapImpulse=impulse;const isTap=this.mouseEnabled&&now>=this.tapArmedAt&&impulse>=this.tapSensitivity&&rise>=Math.max(.018,this.tapSensitivity*.28)&&now-this.lastTapAt>220;if(isTap){this.previousTapAt=this.lastTapAt;this.lastTapAt=now;this.tapFreezeUntil=now+180;const isDouble=this.previousTapAt>0&&now-this.previousTapAt<520;this.nativeClick(isDouble?'DOUBLE CLICK':'CLICK')}if(Math.abs(impulse)<Math.max(.04,this.tapSensitivity*.65))this.tapBaseline=this.tapBaseline*.985+total*.015;this.lastTotal=total}
  async nativeClick(label='CLICK'){try{await fetch('/__mouse_click?button=left',{cache:'no-store'});if(label!=='TEST CLICK'){this.clickCount++;if(label==='DOUBLE CLICK')this.doubleClickCount++;if(this.sessionId)this.sessionEvents.push(SessionDataV02.event(performance.now()-this.sessionPerfStart,label==='DOUBLE CLICK'?'DOUBLE_CLICK':'CLICK',{phase:'application',value:'left'}));}$('clickCount').textContent=String(this.clickCount);$('clickAction').textContent=label;$('lastClickTime').textContent=new Date().toLocaleTimeString();clearTimeout(this.clickUiTimer);this.clickUiTimer=setTimeout(()=>$('clickAction').textContent='待機中',800)}catch(e){this.show('クリック出力に失敗しました。')}}
  startSession(){
    this.sessionStartedAt=new Date();this.sessionEndedAt=null;this.sessionPerfStart=performance.now();this.sessionId=SessionDataV02.makeSessionId('balance-controller',this.sessionStartedAt);this.sessionSamples=[];this.sessionEvents=[SessionDataV02.event(0,'SESSION_START',{phase:'application'})];this.sessionMouseDistancePx=0;this.sessionMouseMoveEvents=0;this.sessionActiveMs=0;this.mouseOnPerfStart=null;this.pendingMouseDx=0;this.pendingMouseDy=0;this.clickCount=0;this.doubleClickCount=0;this.sessionSaved=false;$('clickCount').textContent='0';$('saveSessionButton').disabled=true;
  }
  logSessionSample(frame,m){
    const o=this.latestOutput;this.sessionSamples.push({time_ms:Math.round(performance.now()-this.sessionPerfStart),lf_kg:m.lf,rf_kg:m.rf,lb_kg:m.lb,rb_kg:m.rb,total_kg:m.total,cop_x_norm:m.copX,cop_y_norm:m.copY,weight_present:m.present,output_x_norm:o.x,output_y_norm:o.y,direction:this.directionName(o.x,o.y),mouse_enabled:this.mouseEnabled,mouse_dx_px:this.pendingMouseDx,mouse_dy_px:this.pendingMouseDy,tap_impulse_pct:this.lastTapImpulse*100,raw_lf:frame.raw?.lf??'',raw_rf:frame.raw?.rf??'',raw_lb:frame.raw?.lb??'',raw_rb:frame.raw?.rb??''});this.pendingMouseDx=0;this.pendingMouseDy=0;$('saveSessionButton').disabled=this.sessionSamples.length===0;
  }
  saveSession(){
    if(!this.sessionId||!this.sessionSamples.length)return this.show('保存できる操作データがありません。');
    if(this.mouseEnabled)this.setMouseEnabled(false);
    this.sessionEndedAt=new Date();this.sessionEvents.push(SessionDataV02.event(performance.now()-this.sessionPerfStart,'SESSION_END',{phase:'application'}));
    SessionDataV02.saveBundle({app:{name:'Balance Controller',slug:'balance-controller',version:'1.0 β'},sessionId:this.sessionId,startedAt:this.sessionStartedAt,endedAt:this.sessionEndedAt,measurementSec:this.sessionActiveMs/1000,mode:this.mode,
      protocol:{mouse_speed_px_sec:this.mouseSpeed,dead_zone_norm:this.deadZone,tap_sensitivity_pct:this.tapSensitivity*100,center_abs:this.center,weight_threshold_kg:this.thresholdKg},
      metrics:{mouse_distance_px:this.sessionMouseDistancePx,mouse_move_event_count:this.sessionMouseMoveEvents,click_count:this.clickCount,double_click_count:this.doubleClickCount},samples:this.sessionSamples,
      sampleExtraColumns:['output_x_norm','output_y_norm','direction','mouse_enabled','mouse_dx_px','mouse_dy_px','tap_impulse_pct','raw_lf','raw_rf','raw_lb','raw_rb'],events:this.sessionEvents,
      notes:['APPLICATION / device-operation performance log. This is not a standardized balance assessment.']});
    this.sessionSaved=true;$('saveSessionButton').disabled=true;this.show('Session Data v0.2の3ファイルを保存しました。','ok');this.sessionId=null;
  }
  place(el,x,y){el.style.left=`${clamp((x+1)/2*100,2,98)}%`;el.style.top=`${clamp((1-y)/2*100,2,98)}%`}
  show(text,type='warn'){const b=$('alertBox');b.textContent=text;b.hidden=false;b.style.borderColor=type==='ok'?'#2c684c':'#74542c';b.style.background=type==='ok'?'#0d2a20':'#291c0d';b.style.color=type==='ok'?'#8ce9b2':'#ffd7a7';clearTimeout(this.alertTimer);this.alertTimer=setTimeout(()=>b.hidden=true,5500)}
}
window.addEventListener('DOMContentLoaded',()=>{new App();setInterval(()=>fetch('/__heartbeat',{cache:'no-store'}).catch(()=>{}),5000);fetch('/__heartbeat',{cache:'no-store'}).catch(()=>{})});
})();

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const fmtSigned = (v, d=3) => Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}` : '—';
  const fmtKg = (v) => `${Math.max(0, v || 0).toFixed(1)} kg`;
  const fmtPct = (v) => Number.isFinite(v) ? `${v.toFixed(1)}%` : '—';

  class MetricsCalculator {
    static calculate(corners, thresholdKg = 5) {
      const lf = Math.max(0, corners.lf || 0);
      const rf = Math.max(0, corners.rf || 0);
      const lb = Math.max(0, corners.lb || 0);
      const rb = Math.max(0, corners.rb || 0);
      const total = lf + rf + lb + rb;
      const weightPresent = total >= thresholdKg;
      if (!weightPresent || total <= 0) {
        return { lf, rf, lb, rb, total, weightPresent, leftPct:null,rightPct:null,frontPct:null,backPct:null,copX:null,copY:null };
      }
      const left = lf + lb, right = rf + rb, front = lf + rf, back = lb + rb;
      return {
        lf, rf, lb, rb, total, weightPresent,
        leftPct: left / total * 100,
        rightPct: right / total * 100,
        frontPct: front / total * 100,
        backPct: back / total * 100,
        copX: (right - left) / total,
        copY: (front - back) / total,
      };
    }
  }

  class MockWbbDevice {
    constructor() {
      this.name = 'Mock Wii Balance Board';
      this.connected = true;
      this.listeners = new Set();
      this.total = 70;
      this.x = 0;
      this.y = 0;
      this.timer = null;
      this.start();
    }
    start() {
      if (this.timer) return;
      this.timer = setInterval(() => this.emit(), 32);
      this.emit();
    }
    setPose(x,y,total=this.total){ this.x=clamp(x,-.88,.88);this.y=clamp(y,-.88,.88);this.total=Math.max(0,total);this.emit(); }
    setWeight(total){ this.total=Math.max(0,total);this.emit(); }
    getCorners(){
      const t=this.total,x=this.x,y=this.y;
      return {
        lf:t*(1-x)*(1+y)/4,
        rf:t*(1+x)*(1+y)/4,
        lb:t*(1-x)*(1-y)/4,
        rb:t*(1+x)*(1-y)/4,
      };
    }
    emit(){ const frame={timestamp:performance.now(),corners:this.getCorners(),raw:null,battery:null};this.listeners.forEach(fn=>fn(frame)); }
    subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
    async connect(){this.connected=true;this.emit();}
    async disconnect(){this.connected=false;}
  }

  class WebHidWbbDevice {
    constructor() {
      this.device = null;
      this.listeners = new Set();
      this.cal = null;
      this.pendingReads = [];
      this.keepAlive = null;
      this.boundInput = (e) => this.onInputReport(e);
    }
    get connected(){return !!this.device?.opened}
    get name(){return this.device?.productName || 'Wii Balance Board'}
    subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
    async connect(){
      if (!('hid' in navigator)) throw new Error('このブラウザはWebHIDに対応していません。Chrome / Edge の localhost または HTTPS で開いてください。');
      const devices = await navigator.hid.requestDevice({ filters:[{vendorId:0x057e,productId:0x0306},{vendorId:0x057e}] });
      if (!devices.length) throw new Error('Wii Balance Boardが選択されませんでした。');
      this.device = devices.find(d => d.productId === 0x0306) || devices[0];
      if (!this.device.opened) await this.device.open();
      this.device.addEventListener('inputreport', this.boundInput);
      await this.initialize();
    }
    async disconnect(){
      if(this.keepAlive){clearInterval(this.keepAlive);this.keepAlive=null;}
      if(this.device){this.device.removeEventListener('inputreport',this.boundInput);if(this.device.opened){await this.send(0x11,[0x00]).catch(()=>{});await this.device.close();}}
      this.device=null;this.cal=null;
    }
    async send(reportId, bytes){ if(!this.device?.opened) throw new Error('WBBが接続されていません。'); await this.device.sendReport(reportId,new Uint8Array(bytes)); }
    async writeMemory(address, data){
      const bytes=new Uint8Array(21);bytes[0]=0x04;bytes[1]=(address>>>16)&255;bytes[2]=(address>>>8)&255;bytes[3]=address&255;bytes[4]=data.length;bytes.set(data.slice(0,16),5);await this.send(0x16,bytes);
    }
    async readMemory(address,length,timeoutMs=1800){
      const low=address&0xffff;
      return new Promise(async(resolve,reject)=>{
        const req={base:low,length,buffer:new Uint8Array(length),received:new Set(),resolve,reject,timer:null};
        req.timer=setTimeout(()=>{this.pendingReads=this.pendingReads.filter(r=>r!==req);reject(new Error(`Calibration read timeout (0x${address.toString(16)})`));},timeoutMs);
        this.pendingReads.push(req);
        try{await this.send(0x17,[0x04,(address>>>16)&255,(address>>>8)&255,address&255,(length>>>8)&255,length&255]);}
        catch(err){clearTimeout(req.timer);this.pendingReads=this.pendingReads.filter(r=>r!==req);reject(err);}
      });
    }
    async initialize(){
      await this.send(0x15,[0x00]);
      await new Promise(r=>setTimeout(r,80));
      await this.writeMemory(0xA400F0,new Uint8Array([0x55]));
      await new Promise(r=>setTimeout(r,50));
      await this.writeMemory(0xA400FB,new Uint8Array([0x00]));
      await new Promise(r=>setTimeout(r,80));
      const c = await this.readMemory(0xA40024,24);
      this.cal = this.parseCalibration(c);
      await this.send(0x12,[0x04,0x32]);await this.send(0x11,[0x10]);
      this.keepAlive=setInterval(()=>this.send(0x15,[0x00]).catch(()=>{}),5000);
    }
    parseCalibration(bytes){
      const u16=(i)=>(bytes[i]<<8)|bytes[i+1];
      const names=['rf','rb','lf','lb'];
      const out={};
      names.forEach((name,idx)=>{out[name]={zero:u16(idx*2),kg17:u16(8+idx*2),kg34:u16(16+idx*2)}});
      return out;
    }
    rawToKg(raw,c){
      if(!c) return 0;
      let kg;
      if(raw < c.kg17) kg = 17*(raw-c.zero)/(c.kg17-c.zero || 1);
      else kg = 17 + 17*(raw-c.kg17)/(c.kg34-c.kg17 || 1);
      return Math.max(0,kg);
    }
    handleReadMemory(data){
      if(data.byteLength<6)return;
      const se=data.getUint8(2),err=se&0x0f,size=((se>>4)&0x0f)+1,offset=(data.getUint8(3)<<8)|data.getUint8(4);
      if(err)return;
      const chunk=new Uint8Array(data.buffer,data.byteOffset+5,Math.min(size,data.byteLength-5));
      for(const req of [...this.pendingReads]){
        const relative=offset-req.base;if(relative<0||relative>=req.length)continue;
        const n=Math.min(chunk.length,req.length-relative);req.buffer.set(chunk.slice(0,n),relative);
        for(let i=0;i<n;i++)req.received.add(relative+i);
        if(req.received.size>=req.length){clearTimeout(req.timer);this.pendingReads=this.pendingReads.filter(r=>r!==req);req.resolve(req.buffer);}
      }
    }
    onInputReport(event){
      const id=event.reportId,data=event.data;
      if(id===0x21){this.handleReadMemory(data);return;}
      if(id===0x20){return;}
      if(id!==0x32 || !this.cal || data.byteLength<10)return;
      const u16=(i)=>(data.getUint8(i)<<8)|data.getUint8(i+1);
      // WebHID event.data excludes report ID: 0-1 buttons, then TR,BR,TL,BL.
      const raw={rf:u16(2),rb:u16(4),lf:u16(6),lb:u16(8)};
      const corners={lf:this.rawToKg(raw.lf,this.cal.lf),rf:this.rawToKg(raw.rf,this.cal.rf),lb:this.rawToKg(raw.lb,this.cal.lb),rb:this.rawToKg(raw.rb,this.cal.rb)};
      const frame={timestamp:performance.now(),corners,raw,battery:null};
      this.listeners.forEach(fn=>fn(frame));
    }
  }

  class LoadBalanceViewerApp {
    constructor(){
      this.threshold=5;
      this.mode='mock';
      this.device=null;
      this.unsubscribe=null;
      this.zero={lf:0,rf:0,lb:0,rb:0};
      this.center=null;
      this.lastFrame=null;
      this.lastMetrics=null;
      this.log=[];this.logging=false;this.sessionId=null;this.logStartedAt=null;this.logEndedAt=null;this.logPerfStart=0;this.measurementSec=0;this.events=[];
      this.recentBase=[];
      this.renderScheduled=false;
      this.dragging=false;
      this.bindUI();
      this.useMock();
    }
    bindUI(){
      $('modeMock').addEventListener('click',()=>this.setMode('mock'));
      $('modeReal').addEventListener('click',()=>this.setMode('real'));
      $('connectButton').addEventListener('click',()=>this.connectReal());
      $('zeroButton').addEventListener('click',()=>this.zeroBoard());
      $('centerButton').addEventListener('click',()=>this.setCenter());
      $('logButton').addEventListener('click',()=>this.toggleLog());
      $('mockWeight').addEventListener('input',(e)=>{if(this.device instanceof MockWbbDevice){this.device.setWeight(+e.target.value);$('mockWeightValue').textContent=fmtKg(+e.target.value)}});
      $('mockCenterButton').addEventListener('click',()=>{if(this.device instanceof MockWbbDevice)this.device.setPose(0,0)});
      const board=$('copBoard');
      const move=(e)=>{if(!(this.device instanceof MockWbbDevice)||!this.dragging)return;const r=board.getBoundingClientRect();const x=clamp(((e.clientX-r.left)/r.width)*2-1,-.88,.88);const y=clamp(1-((e.clientY-r.top)/r.height)*2,-.88,.88);this.device.setPose(x,y)};
      board.addEventListener('pointerdown',(e)=>{if(!(this.device instanceof MockWbbDevice))return;this.dragging=true;board.setPointerCapture?.(e.pointerId);move(e)});
      board.addEventListener('pointermove',move);
      board.addEventListener('pointerup',()=>this.dragging=false);board.addEventListener('pointercancel',()=>this.dragging=false);
      navigator.hid?.addEventListener?.('disconnect',(e)=>{if(this.device?.device===e.device){this.showAlert('Wii Balance Boardとの接続が切れました。');this.updateConnection('Disconnected','error')}});
    }
    async setMode(mode){
      if(mode===this.mode)return;
      await this.detachDevice();this.mode=mode;this.resetProcessing();
      $('modeMock').classList.toggle('active',mode==='mock');$('modeReal').classList.toggle('active',mode==='real');
      $('mockControls').hidden=mode!=='mock';$('connectButton').hidden=mode!=='real';
      if(mode==='mock')this.useMock();else{this.updateConnection('Not connected','idle');$('connectButton').textContent='Wii Balance Boardを接続';}
    }
    resetProcessing(){this.zero={lf:0,rf:0,lb:0,rb:0};this.center=null;this.recentBase=[];$('zeroState').textContent='Not set';$('centerState').textContent='Not set';$('centerMarker').hidden=true;}
    async detachDevice(){if(this.unsubscribe){this.unsubscribe();this.unsubscribe=null;}if(this.device?.disconnect)await this.device.disconnect().catch(()=>{});this.device=null;}
    useMock(){this.mode='mock';this.device=new MockWbbDevice();this.attach(this.device);this.updateConnection('Mock Device','mock');$('mockControls').hidden=false;$('connectButton').hidden=true;}
    async connectReal(){
      try{
        $('connectButton').disabled=true;this.updateConnection('Connecting…','idle');this.showAlert('Wii Balance BoardをWindows側でBluetoothペアリング済みにしてから、デバイス選択画面で選択してください。');
        await this.detachDevice();const d=new WebHidWbbDevice();await d.connect();this.device=d;this.attach(d);this.resetProcessing();this.updateConnection(d.name,'connected');$('connectButton').textContent='接続済み';this.showAlert('実機接続を開始しました。ボードから降りた状態でZEROを実行してください。','ok');
      }catch(err){console.error(err);this.updateConnection('Connection failed','error');this.showAlert(err.message||String(err));$('connectButton').textContent='再接続';}
      finally{$('connectButton').disabled=false;}
    }
    attach(device){this.unsubscribe=device.subscribe((frame)=>this.onFrame(frame));}
    onFrame(frame){
      this.lastFrame=frame;
      const base=frame.corners;
      this.recentBase.push({t:performance.now(),...base});while(this.recentBase.length&&performance.now()-this.recentBase[0].t>2500)this.recentBase.shift();
      const adjusted={lf:Math.max(0,base.lf-this.zero.lf),rf:Math.max(0,base.rf-this.zero.rf),lb:Math.max(0,base.lb-this.zero.lb),rb:Math.max(0,base.rb-this.zero.rb)};
      const m=MetricsCalculator.calculate(adjusted,this.threshold);this.lastMetrics=m;
      if(this.logging)this.logSample(frame,m);
      if(!this.renderScheduled){this.renderScheduled=true;requestAnimationFrame(()=>{this.renderScheduled=false;this.render(m)})}
    }
    render(m){
      ['lf','rf','lb','rb'].forEach(k=>{$(`${k}Kg`).textContent=fmtKg(m[k]);$(`${k}Bar`).style.width=`${clamp(m[k]/45*100,0,100)}%`});$('totalKg').textContent=fmtKg(m.total);
      $('leftPct').textContent=fmtPct(m.leftPct);$('rightPct').textContent=fmtPct(m.rightPct);$('frontPct').textContent=fmtPct(m.frontPct);$('backPct').textContent=fmtPct(m.backPct);
      $('lrMarker').style.left=`${m.weightPresent?clamp(m.rightPct,0,100):50}%`;
      // Track maps FRONT at left and BACK at right, so use back percent.
      $('fbMarker').style.left=`${m.weightPresent?clamp(m.backPct,0,100):50}%`;
      const present=m.weightPresent;$('weightPresence').textContent=present?'WEIGHT DETECTED':'NO WEIGHT';$('weightPresence').classList.toggle('on',present);$('noWeightOverlay').hidden=present;
      const copX=present?m.copX:null,copY=present?m.copY:null;$('copX').textContent=fmtSigned(copX);$('copY').textContent=fmtSigned(copY);
      const rx=present&&this.center?copX-this.center.x:null, ry=present&&this.center?copY-this.center.y:null;$('relX').textContent=fmtSigned(rx);$('relY').textContent=fmtSigned(ry);
      if(present){$('copDot').style.left=`${clamp((copX+1)/2*100,5,95)}%`;$('copDot').style.top=`${clamp((1-copY)/2*100,5,95)}%`;}
    }
    async zeroBoard(){
      if(!this.lastFrame)return this.showAlert('センサーデータがまだありません。');
      const rawTotal=Object.values(this.lastFrame.corners).reduce((a,b)=>a+b,0);
      if(rawTotal>=this.threshold)return this.showAlert(`ZEROはボードから降りた状態で実行してください。現在の総荷重: ${rawTotal.toFixed(1)} kg`);
      $('zeroState').textContent='Sampling…';this.showAlert('ZEROを取得しています。ボードには触れないでください。','ok');
      const started=performance.now();await new Promise(r=>setTimeout(r,1000));const samples=this.recentBase.filter(s=>s.t>=started);
      if(samples.length<3){$('zeroState').textContent='Failed';return this.showAlert('ZERO用サンプルが不足しました。');}
      for(const k of ['lf','rf','lb','rb'])this.zero[k]=samples.reduce((a,s)=>a+s[k],0)/samples.length;
      $('zeroState').textContent='Applied';this.showAlert('ZEROを設定しました。','ok');
    }
    setCenter(){
      const m=this.lastMetrics;if(!m?.weightPresent)return this.showAlert('SET CENTERはボード上に立った状態で実行してください。');
      this.center={x:m.copX,y:m.copY};$('centerState').textContent='Applied';const mark=$('centerMarker');mark.hidden=false;mark.style.left=`${clamp((m.copX+1)/2*100,5,95)}%`;mark.style.top=`${clamp((1-m.copY)/2*100,5,95)}%`;this.showAlert('現在のCoP位置を基準CENTERとして登録しました。','ok');
    }
    toggleLog(){this.logging?this.stopLog():this.startLog();}
    startLog(){this.log=[];this.events=[];this.logging=true;this.logStartedAt=new Date();this.logEndedAt=null;this.measurementSec=0;this.logPerfStart=performance.now();this.sessionId=SessionDataV02.makeSessionId('load-balance-viewer',this.logStartedAt);this.events.push(SessionDataV02.event(0,'SESSION_START'));$('logButton').textContent='■ LOG STOP';$('logButton').classList.add('logging');$('logState').textContent=this.sessionId;this.showAlert('センサーログの記録を開始しました。','ok');}
    stopLog(){this.logging=false;const endMs=Math.max(0,performance.now()-this.logPerfStart);this.measurementSec=endMs/1000;this.logEndedAt=new Date();this.events.push(SessionDataV02.event(endMs,'SESSION_END'));$('logButton').textContent='● LOG START';$('logButton').classList.remove('logging');$('logState').textContent=`${this.log.length} samples`;if(!this.log.length)return this.showAlert('記録されたデータがありません。');this.downloadLogs();this.showAlert('Session Data v0.2の3ファイルを保存しました。','ok');}
    logSample(frame,m){
      const relX=m.weightPresent&&this.center?m.copX-this.center.x:null,relY=m.weightPresent&&this.center?m.copY-this.center.y:null;
      this.log.push({time_ms:Math.round(performance.now()-this.logPerfStart),lf_kg:m.lf,rf_kg:m.rf,lb_kg:m.lb,rb_kg:m.rb,total_kg:m.total,cop_x_norm:m.copX,cop_y_norm:m.copY,weight_present:m.weightPresent,left_pct:m.leftPct,right_pct:m.rightPct,front_pct:m.frontPct,back_pct:m.backPct,relative_cop_x_norm:relX,relative_cop_y_norm:relY,raw_lf:frame.raw?.lf??'',raw_rf:frame.raw?.rf??'',raw_lb:frame.raw?.lb??'',raw_rb:frame.raw?.rb??''});
    }
    downloadLogs(){
      const valid=this.log.filter(r=>r.weight_present&&Number.isFinite(r.cop_x_norm)&&Number.isFinite(r.cop_y_norm));
      const mean=(key,rows=this.log)=>rows.length?rows.reduce((a,r)=>a+(Number(r[key])||0),0)/rows.length:null;
      SessionDataV02.saveBundle({
        app:{name:'Load Balance Viewer',slug:'load-balance-viewer',version:'1.0 β'},sessionId:this.sessionId,startedAt:this.logStartedAt,endedAt:this.logEndedAt||new Date(),measurementSec:this.measurementSec,mode:this.mode,
        protocol:{zero_applied:Object.values(this.zero).some(v=>Math.abs(v)>1e-6),center_applied:!!this.center,weight_threshold_kg:this.threshold},
        metrics:{valid_samples:valid.length,mean_load_kg:mean('total_kg'),mean_left_pct:mean('left_pct'),mean_right_pct:mean('right_pct'),mean_front_pct:mean('front_pct'),mean_back_pct:mean('back_pct'),mean_cop_x_norm:mean('cop_x_norm',valid),mean_cop_y_norm:mean('cop_y_norm',valid)},
        samples:this.log,
        sampleExtraColumns:['left_pct','right_pct','front_pct','back_pct','relative_cop_x_norm','relative_cop_y_norm','raw_lf','raw_rf','raw_lb','raw_rb'],events:this.events,
        notes:['Realtime load-distribution observation. Normalized CoP; not physical mm/cm and not a standardized clinical score.']
      });
    }
    updateConnection(text,state){$('connectionText').textContent=text;const dot=$('statusDot');dot.className='status-dot';if(state==='mock')dot.classList.add('mock');else if(state==='connected')dot.classList.add('connected');else if(state==='error')dot.classList.add('error');}
    showAlert(text,type='warn'){const box=$('alertBox');box.textContent=text;box.hidden=false;box.style.borderColor=type==='ok'?'#285c4a':'#76532f';box.style.background=type==='ok'?'#0e2b22':'#2a1c0d';box.style.color=type==='ok'?'#8be4ba':'#ffd8a7';clearTimeout(this.alertTimer);this.alertTimer=setTimeout(()=>box.hidden=true,7000);}
  }

  window.addEventListener('DOMContentLoaded',()=>new LoadBalanceViewerApp());
})();


// Keep the one-click local server alive only while this tab is open.
setInterval(() => {
  fetch('/__heartbeat', { cache: 'no-store' }).catch(() => {});
}, 5000);
fetch('/__heartbeat', { cache: 'no-store' }).catch(() => {});

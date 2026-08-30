(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const fmtSigned = (v, d=3) => Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(d)}` : '—';
  const fmtKg = (v) => `${Math.max(0, v || 0).toFixed(1)} kg`;
  const fmtNum = (v, d=3) => Number.isFinite(v) ? v.toFixed(d) : '—';

  class MetricsCalculator {
    static calculate(corners, thresholdKg = 5) {
      const lf = Math.max(0, corners.lf || 0);
      const rf = Math.max(0, corners.rf || 0);
      const lb = Math.max(0, corners.lb || 0);
      const rb = Math.max(0, corners.rb || 0);
      const total = lf + rf + lb + rb;
      const weightPresent = total >= thresholdKg;
      if (!weightPresent || total <= 0) {
        return { lf, rf, lb, rb, total, weightPresent, copX:null, copY:null };
      }
      const left = lf + lb, right = rf + rb, front = lf + rf, back = lb + rb;
      return {
        lf, rf, lb, rb, total, weightPresent,
        copX: (right - left) / total,
        copY: (front - back) / total
      };
    }
  }

  class StabilityMetrics {
    static calculate(samples, activeSeconds) {
      const valid = samples.filter(s => Number.isFinite(s.x) && Number.isFinite(s.y));
      if (valid.length < 2 || activeSeconds <= 0) return null;

      let pathLength = 0;
      for (let i=1;i<valid.length;i++) {
        pathLength += Math.hypot(valid[i].x-valid[i-1].x, valid[i].y-valid[i-1].y);
      }
      const xs = valid.map(s=>s.x), ys = valid.map(s=>s.y);
      const meanX = xs.reduce((a,b)=>a+b,0)/xs.length;
      const meanY = ys.reduce((a,b)=>a+b,0)/ys.length;
      const mlRange = Math.max(...xs)-Math.min(...xs);
      const apRange = Math.max(...ys)-Math.min(...ys);
      const rmsSway = Math.sqrt(valid.reduce((a,s)=>a + (s.x-meanX)**2 + (s.y-meanY)**2,0)/valid.length);
      const meanLoad = valid.reduce((a,s)=>a+s.total,0)/valid.length;
      const meanVelocity = pathLength/activeSeconds;
      return {pathLength, meanVelocity, mlRange, apRange, rmsSway, meanLoad, meanX, meanY, validSamples:valid.length};
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
      this.autoSway = false;
      this.swayT = 0;
      this.start();
    }
    start() {
      if (this.timer) return;
      this.timer = setInterval(() => {
        if (this.autoSway && this.total >= 5) {
          this.swayT += 0.032;
          this.x = clamp(0.035*Math.sin(this.swayT*2.1) + 0.018*Math.sin(this.swayT*5.7), -.88,.88);
          this.y = clamp(0.045*Math.sin(this.swayT*1.55+0.8) + 0.015*Math.cos(this.swayT*4.3), -.88,.88);
        }
        this.emit();
      }, 32);
      this.emit();
    }
    setPose(x,y,total=this.total){ this.autoSway=false;this.x=clamp(x,-.88,.88);this.y=clamp(y,-.88,.88);this.total=Math.max(0,total);this.emit(); }
    setWeight(total){ this.total=Math.max(0,total);this.emit(); }
    setAutoSway(on){this.autoSway=!!on;}
    getCorners(){
      const t=this.total,x=this.x,y=this.y;
      return {
        lf:t*(1-x)*(1+y)/4,
        rf:t*(1+x)*(1+y)/4,
        lb:t*(1-x)*(1-y)/4,
        rb:t*(1+x)*(1-y)/4,
      };
    }
    emit(){ const frame={timestamp:performance.now(),corners:this.getCorners(),raw:null};this.listeners.forEach(fn=>fn(frame)); }
    subscribe(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
    async connect(){this.connected=true;this.emit();}
    async disconnect(){if(this.timer){clearInterval(this.timer);this.timer=null;}this.connected=false;}
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
      const raw={rf:u16(2),rb:u16(4),lf:u16(6),lb:u16(8)};
      const corners={lf:this.rawToKg(raw.lf,this.cal.lf),rf:this.rawToKg(raw.rf,this.cal.rf),lb:this.rawToKg(raw.lb,this.cal.lb),rb:this.rawToKg(raw.rb,this.cal.rb)};
      const frame={timestamp:performance.now(),corners,raw};
      this.listeners.forEach(fn=>fn(frame));
    }
  }

  class CopStabilityTestApp {
    constructor(){
      this.threshold=5;
      this.mode='mock';
      this.device=null;
      this.unsubscribe=null;
      this.zero={lf:0,rf:0,lb:0,rb:0};
      this.lastFrame=null;
      this.lastMetrics=null;
      this.recentBase=[];
      this.duration=30;
      this.testState='ready';
      this.countdownTimer=null;
      this.testTimer=null;
      this.testStartedAt=0;
      this.testEndsAt=0;
      this.samples=[];
      this.result=null;this.events=[];this.sessionId=null;this.sessionStartedAt=null;this.sessionEndedAt=null;this.measurementSec=0;
      this.renderScheduled=false;
      this.dragging=false;
      this.ctx=null;
      this.canvasSize={w:0,h:0,dpr:1};
      this.bindUI();
      this.setupCanvas();
      this.useMock();
      this.setDuration(30);
      this.resetResults();
    }

    bindUI(){
      $('modeMock').addEventListener('click',()=>this.setMode('mock'));
      $('modeReal').addEventListener('click',()=>this.setMode('real'));
      $('connectButton').addEventListener('click',()=>this.connectReal());
      $('zeroButton').addEventListener('click',()=>this.zeroBoard());
      $('startButton').addEventListener('click',()=>this.toggleTest());
      $('saveButton').addEventListener('click',()=>this.saveResult());
      document.querySelectorAll('.duration-button').forEach(btn=>btn.addEventListener('click',()=>this.setDuration(+btn.dataset.duration)));
      $('mockWeight').addEventListener('input',(e)=>{if(this.device instanceof MockWbbDevice){this.device.setWeight(+e.target.value);$('mockWeightValue').textContent=fmtKg(+e.target.value)}});
      $('mockCenterButton').addEventListener('click',()=>{if(this.device instanceof MockWbbDevice){this.device.setPose(0,0);$('mockSwayButton').textContent='自動揺れ ON'}});
      $('mockSwayButton').addEventListener('click',()=>{if(this.device instanceof MockWbbDevice){this.device.setAutoSway(!this.device.autoSway);$('mockSwayButton').textContent=this.device.autoSway?'自動揺れ OFF':'自動揺れ ON';}});
      const board=$('copBoard');
      const move=(e)=>{if(!(this.device instanceof MockWbbDevice)||!this.dragging)return;const r=board.getBoundingClientRect();const x=clamp(((e.clientX-r.left)/r.width)*2-1,-.88,.88);const y=clamp(1-((e.clientY-r.top)/r.height)*2,-.88,.88);this.device.setPose(x,y);$('mockSwayButton').textContent='自動揺れ ON';};
      board.addEventListener('pointerdown',(e)=>{if(!(this.device instanceof MockWbbDevice))return;this.dragging=true;board.setPointerCapture?.(e.pointerId);move(e)});
      board.addEventListener('pointermove',move);
      board.addEventListener('pointerup',()=>this.dragging=false);
      board.addEventListener('pointercancel',()=>this.dragging=false);
      navigator.hid?.addEventListener?.('disconnect',(e)=>{if(this.device?.device===e.device){this.abortTest('Wii Balance Boardとの接続が切れました。');this.updateConnection('Disconnected','error')}});
      window.addEventListener('resize',()=>this.setupCanvas());
    }

    setupCanvas(){
      const canvas=$('trailCanvas'), board=$('copBoard');
      const r=board.getBoundingClientRect();
      if(!r.width||!r.height)return;
      const dpr=Math.min(window.devicePixelRatio||1,2);
      canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);
      this.canvasSize={w:r.width,h:r.height,dpr};this.ctx=canvas.getContext('2d');
      this.drawTrail();
    }

    async setMode(mode){
      if(mode===this.mode)return;
      this.abortTest();
      await this.detachDevice();this.mode=mode;this.resetProcessing();this.resetResults();
      $('modeMock').classList.toggle('active',mode==='mock');$('modeReal').classList.toggle('active',mode==='real');
      $('mockControls').hidden=mode!=='mock';$('connectButton').hidden=mode!=='real';$('modeState').textContent=mode==='mock'?'MOCK':'REAL WBB';
      if(mode==='mock')this.useMock();else{this.updateConnection('Not connected','idle');$('connectButton').textContent='Wii Balance Boardを接続';}
    }
    resetProcessing(){this.zero={lf:0,rf:0,lb:0,rb:0};this.recentBase=[];$('zeroState').textContent='Not set';}
    async detachDevice(){if(this.unsubscribe){this.unsubscribe();this.unsubscribe=null;}if(this.device?.disconnect)await this.device.disconnect().catch(()=>{});this.device=null;}
    useMock(){this.mode='mock';this.device=new MockWbbDevice();this.attach(this.device);this.updateConnection('Mock Device','mock');$('mockControls').hidden=false;$('connectButton').hidden=true;$('modeState').textContent='MOCK';}
    async connectReal(){
      try{
        $('connectButton').disabled=true;this.updateConnection('Connecting…','idle');this.showAlert('Wii Balance BoardをWindows側でBluetoothペアリング済みにしてから選択してください。');
        await this.detachDevice();const d=new WebHidWbbDevice();await d.connect();this.device=d;this.attach(d);this.resetProcessing();this.resetResults();this.updateConnection(d.name,'connected');$('connectButton').textContent='接続済み';this.showAlert('実機接続しました。ボードから降りた状態でZEROを実行してください。','ok');
      }catch(err){console.error(err);this.updateConnection('Connection failed','error');this.showAlert(err.message||String(err));$('connectButton').textContent='再接続';}
      finally{$('connectButton').disabled=false;}
    }
    attach(device){this.unsubscribe=device.subscribe((frame)=>this.onFrame(frame));}
    onFrame(frame){
      this.lastFrame=frame;
      const base=frame.corners;
      const now=performance.now();
      this.recentBase.push({t:now,...base});while(this.recentBase.length&&now-this.recentBase[0].t>2500)this.recentBase.shift();
      const adjusted={lf:Math.max(0,base.lf-this.zero.lf),rf:Math.max(0,base.rf-this.zero.rf),lb:Math.max(0,base.lb-this.zero.lb),rb:Math.max(0,base.rb-this.zero.rb)};
      const m=MetricsCalculator.calculate(adjusted,this.threshold);this.lastMetrics=m;
      if(this.testState==='running' && m.weightPresent && Number.isFinite(m.copX) && Number.isFinite(m.copY)){
        this.samples.push({t:now-this.testStartedAt,x:m.copX,y:m.copY,total:m.total,lf:m.lf,rf:m.rf,lb:m.lb,rb:m.rb,raw:frame.raw});
      }
      if(!this.renderScheduled){this.renderScheduled=true;requestAnimationFrame(()=>{this.renderScheduled=false;this.render(m)})}
    }
    render(m){
      const present=m.weightPresent;
      $('weightPresence').textContent=present?'WEIGHT DETECTED':'NO WEIGHT';$('weightPresence').classList.toggle('on',present);$('noWeightOverlay').hidden=present;
      $('copX').textContent=fmtSigned(present?m.copX:null);$('copY').textContent=fmtSigned(present?m.copY:null);$('totalKg').textContent=fmtKg(m.total);$('sampleCount').textContent=this.samples.length;
      if(present){$('copDot').style.left=`${clamp((m.copX+1)/2*100,5,95)}%`;$('copDot').style.top=`${clamp((1-m.copY)/2*100,5,95)}%`;}
      if(this.testState==='running')this.drawTrail();
    }

    setDuration(sec){
      if(this.testState==='running'||this.testState==='countdown')return;
      this.duration=sec;
      document.querySelectorAll('.duration-button').forEach(b=>b.classList.toggle('active',+b.dataset.duration===sec));
      $('durationState').textContent=`${sec} sec`;$('timerValue').textContent=sec.toFixed(1);$('timerLabel').textContent='READY';
      this.resetResults();
    }

    async zeroBoard(){
      if(this.testState==='running'||this.testState==='countdown')return this.showAlert('測定中はZEROできません。');
      if(!this.lastFrame)return this.showAlert('センサーデータがまだありません。');
      const rawTotal=Object.values(this.lastFrame.corners).reduce((a,b)=>a+b,0);
      if(rawTotal>=this.threshold)return this.showAlert(`ZEROはボードから降りた状態で実行してください。現在の総荷重: ${rawTotal.toFixed(1)} kg`);
      $('zeroState').textContent='Sampling…';this.showAlert('ZEROを取得しています。ボードには触れないでください。','ok');
      const started=performance.now();await new Promise(r=>setTimeout(r,1000));const samples=this.recentBase.filter(s=>s.t>=started);
      if(samples.length<3){$('zeroState').textContent='Failed';return this.showAlert('ZERO用サンプルが不足しました。');}
      for(const k of ['lf','rf','lb','rb'])this.zero[k]=samples.reduce((a,s)=>a+s[k],0)/samples.length;
      $('zeroState').textContent='Applied';this.showAlert('ZEROを設定しました。','ok');
    }

    toggleTest(){
      if(this.testState==='running'||this.testState==='countdown')this.abortTest('測定を中止しました。');
      else this.prepareTest();
    }

    prepareTest(){
      if(!this.lastMetrics?.weightPresent)return this.showAlert('ボード上に立ってからSTART TESTを押してください。');
      if(this.mode==='real' && !this.device?.connected)return this.showAlert('Wii Balance Boardが接続されていません。');
      this.resetResults();
      this.samples=[];
      this.testState='countdown';
      $('startButton').textContent='STOP';$('startButton').classList.add('stop');
      this.setTestBadge('COUNTDOWN','countdown');
      $('countdownOverlay').hidden=false;
      let n=3;$('countdownNumber').textContent=n;
      $('timerLabel').textContent='STARTING';
      this.countdownTimer=setInterval(()=>{
        n--;
        if(n<=0){
          clearInterval(this.countdownTimer);this.countdownTimer=null;$('countdownOverlay').hidden=true;this.beginTest();
        }else $('countdownNumber').textContent=n;
      },1000);
    }

    beginTest(){
      if(!this.lastMetrics?.weightPresent){this.abortTest('開始時に荷重を検出できませんでした。');return;}
      this.testState='running';this.testStartedAt=performance.now();this.sessionStartedAt=new Date();this.sessionEndedAt=null;this.measurementSec=0;this.sessionId=SessionDataV02.makeSessionId('cop-stability-test',this.sessionStartedAt);this.events=[SessionDataV02.event(0,'SESSION_START',{phase:'measure'})];this.testEndsAt=this.testStartedAt+this.duration*1000;
      $('timerLabel').textContent='MEASURING';this.setTestBadge('MEASURING','running');$('validState').textContent='Recording';
      this.clearTrail();
      const tick=()=>{
        if(this.testState!=='running')return;
        const remain=Math.max(0,(this.testEndsAt-performance.now())/1000);$('timerValue').textContent=remain.toFixed(1);
        if(remain<=0)this.finishTest();else this.testTimer=requestAnimationFrame(tick);
      };tick();
    }

    finishTest(){
      if(this.testState!=='running')return;
      if(this.testTimer){cancelAnimationFrame(this.testTimer);this.testTimer=null;}
      const elapsed=(performance.now()-this.testStartedAt)/1000;this.measurementSec=Math.min(elapsed,this.duration);this.sessionEndedAt=new Date();
      this.testState='done';$('startButton').textContent='START TEST';$('startButton').classList.remove('stop');$('timerValue').textContent='0.0';$('timerLabel').textContent='COMPLETE';this.setTestBadge('COMPLETE','done');
      this.result=StabilityMetrics.calculate(this.samples,Math.min(elapsed,this.duration));
      if(!this.result){
        $('validState').textContent='Invalid';this.showAlert('有効なCoPサンプルが不足しました。');return;
      }
      const validRatio=this.samples.length ? this.result.validSamples/this.samples.length : 0;
      $('validState').textContent=`${this.result.validSamples} samples`;
      $('pathLength').textContent=fmtNum(this.result.pathLength,3);
      $('meanVelocity').textContent=fmtNum(this.result.meanVelocity,3);
      $('mlRange').textContent=fmtNum(this.result.mlRange,3);
      $('apRange').textContent=fmtNum(this.result.apRange,3);
      $('rmsSway').textContent=fmtNum(this.result.rmsSway,3);
      $('meanLoad').textContent=fmtNum(this.result.meanLoad,1);
      $('resultNote').textContent='正規化CoPから算出した同一条件内での比較用指標です。mm・cm²などの物理単位ではありません。';
      $('saveButton').disabled=false;
      const mark=$('meanMarker');mark.hidden=false;mark.style.left=`${clamp((this.result.meanX+1)/2*100,5,95)}%`;mark.style.top=`${clamp((1-this.result.meanY)/2*100,5,95)}%`;
      this.events.push(SessionDataV02.event(performance.now()-this.testStartedAt,'SESSION_END',{phase:'measure'}));this.drawTrail();this.showAlert('測定が終了しました。','ok');
    }

    abortTest(message){
      if(this.countdownTimer){clearInterval(this.countdownTimer);this.countdownTimer=null;}
      if(this.testTimer){cancelAnimationFrame(this.testTimer);this.testTimer=null;}
      $('countdownOverlay').hidden=true;
      if(this.testState==='running'||this.testState==='countdown'){
        this.testState='ready';$('startButton').textContent='START TEST';$('startButton').classList.remove('stop');$('timerLabel').textContent='READY';$('timerValue').textContent=this.duration.toFixed(1);this.setTestBadge('READY','ready');$('validState').textContent='—';
        if(message)this.showAlert(message);
      }
    }

    resetResults(){
      this.samples=[];this.result=null;$('sampleCount').textContent='0';$('saveButton').disabled=true;$('meanMarker').hidden=true;
      ['pathLength','meanVelocity','mlRange','apRange','rmsSway','meanLoad'].forEach(id=>$(id).textContent='—');
      $('resultNote').textContent='測定終了後に結果を表示します。';$('validState').textContent='—';this.clearTrail();
      if(this.testState!=='running'&&this.testState!=='countdown'){this.testState='ready';this.setTestBadge('READY','ready');$('timerValue').textContent=this.duration.toFixed(1);$('timerLabel').textContent='READY';}
    }

    setTestBadge(text,state){const b=$('testStateBadge');b.textContent=text;b.className=`test-badge ${state}`;}

    clearTrail(){
      if(!this.ctx)this.setupCanvas();
      const {w,h,dpr}=this.canvasSize;if(!this.ctx||!w||!h)return;this.ctx.clearRect(0,0,w*dpr,h*dpr);
    }

    drawTrail(){
      if(!this.ctx)this.setupCanvas();
      const {w,h,dpr}=this.canvasSize;if(!this.ctx||!w||!h)return;
      const ctx=this.ctx;ctx.clearRect(0,0,w*dpr,h*dpr);
      if(this.samples.length<2)return;
      ctx.save();ctx.scale(dpr,dpr);ctx.lineCap='round';ctx.lineJoin='round';
      ctx.strokeStyle='rgba(79,134,255,.76)';ctx.lineWidth=2;
      ctx.beginPath();
      this.samples.forEach((s,i)=>{
        const x=clamp((s.x+1)/2*w,0,w), y=clamp((1-s.y)/2*h,0,h);
        if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      });ctx.stroke();
      const stride=Math.max(1,Math.floor(this.samples.length/70));
      ctx.fillStyle='rgba(121,164,255,.40)';
      for(let i=0;i<this.samples.length;i+=stride){const s=this.samples[i],x=(s.x+1)/2*w,y=(1-s.y)/2*h;ctx.beginPath();ctx.arc(x,y,1.6,0,Math.PI*2);ctx.fill();}
      ctx.restore();
    }

    saveResult(){
      if(!this.result||!this.samples.length)return;
      const rows=this.samples.map(s=>({time_ms:Math.round(s.t),lf_kg:s.lf,rf_kg:s.rf,lb_kg:s.lb,rb_kg:s.rb,total_kg:s.total,cop_x_norm:s.x,cop_y_norm:s.y,weight_present:Number.isFinite(s.x)&&Number.isFinite(s.y)&&s.total>=this.threshold,raw_lf:s.raw?.lf??'',raw_rf:s.raw?.rf??'',raw_lb:s.raw?.lb??'',raw_rb:s.raw?.rb??''}));
      SessionDataV02.saveBundle({
        app:{name:'CoP Stability Test',slug:'cop-stability-test',version:'1.0 β'},sessionId:this.sessionId,startedAt:this.sessionStartedAt||new Date(),endedAt:this.sessionEndedAt||new Date(),measurementSec:this.measurementSec,mode:this.mode,
        protocol:{duration_sec:this.duration,zero_applied:Object.values(this.zero).some(v=>Math.abs(v)>1e-6),weight_threshold_kg:this.threshold},
        metrics:{valid_samples:this.result.validSamples,path_length_norm:this.result.pathLength,mean_velocity_norm_sec:this.result.meanVelocity,ml_range_norm:this.result.mlRange,ap_range_norm:this.result.apRange,rms_sway_norm:this.result.rmsSway,mean_load_kg:this.result.meanLoad,mean_cop_x_norm:this.result.meanX,mean_cop_y_norm:this.result.meanY},
        samples:rows,sampleExtraColumns:['raw_lf','raw_rf','raw_lb','raw_rb'],events:this.events,
        notes:['Normalized CoP metrics for within-person / same-condition comparison; not physical mm/cm2 and not a standardized clinical score.']
      });
      this.showAlert('Session Data v0.2の3ファイルを保存しました。','ok');
    }

    updateConnection(text,state){$('connectionText').textContent=text;const dot=$('statusDot');dot.className='status-dot';if(state==='mock')dot.classList.add('mock');else if(state==='connected')dot.classList.add('connected');else if(state==='error')dot.classList.add('error');}
    showAlert(text,type='warn'){const box=$('alertBox');box.textContent=text;box.hidden=false;box.style.borderColor=type==='ok'?'#285c4a':'#76532f';box.style.background=type==='ok'?'#0e2b22':'#2a1c0d';box.style.color=type==='ok'?'#8be4ba':'#ffd8a7';clearTimeout(this.alertTimer);this.alertTimer=setTimeout(()=>box.hidden=true,7000);}
  }

  window.addEventListener('DOMContentLoaded',()=>new CopStabilityTestApp());
})();


// Keep the one-click local server alive only while this tab is open.
setInterval(() => {
  fetch('/__heartbeat', { cache: 'no-store' }).catch(() => {});
}, 5000);
fetch('/__heartbeat', { cache: 'no-store' }).catch(() => {});

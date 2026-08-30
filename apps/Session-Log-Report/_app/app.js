(() => {
'use strict';

const $ = id => document.getElementById(id);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const fmt=(v,d=3)=>Number.isFinite(Number(v))?Number(v).toFixed(d):'—';
const pct=(v,d=1)=>Number.isFinite(Number(v))?`${Number(v).toFixed(d)}%`:'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':'&quot;',"'":"&#39;"}[m]));

const APP_META={
  'load-balance-viewer':{label:'Load Balance Viewer',role:'OBSERVE',color:'#2268e8'},
  'cop-stability-test':{label:'CoP Stability Test',role:'STABILITY',color:'#008a9b'},
  'limits-of-stability':{label:'Limits of Stability',role:'CAPACITY',color:'#7a55c7'},
  'weight-shift-trainer':{label:'Weight Shift Trainer',role:'CONTROL',color:'#d07b18'},
  'balance-controller':{label:'Balance Controller',role:'APPLICATION',color:'#168a5b'}
};

const state={sessions:new Map(),selectedId:null,view:'overview',noteBySession:new Map()};

function stripBom(s){return String(s??'').replace(/^\uFEFF/,'')}
function parseCsv(text){
  const rows=[];let row=[],field='',q=false;const s=stripBom(text).replace(/\r\n/g,'\n').replace(/\r/g,'\n');
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(q){if(c==='"'&&s[i+1]==='"'){field+='"';i++}else if(c==='"')q=false;else field+=c}
    else if(c==='"')q=true;else if(c===','){row.push(field);field=''}else if(c==='\n'){row.push(field);if(row.some(x=>x!==''))rows.push(row);row=[];field=''}else field+=c;
  }
  if(field!==''||row.length){row.push(field);rows.push(row)}
  if(!rows.length)return[];
  const headers=rows[0].map(h=>stripBom(h));
  return rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,coerce(r[i]??'')])));
}
function coerce(v){if(v==='true')return true;if(v==='false')return false;if(v==='')return '';const n=Number(v);return Number.isFinite(n)&&/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(v)?n:v}

function fileKind(name){
  if(name.endsWith('-summary.json'))return'summary';
  if(name.endsWith('-samples.csv'))return'samples';
  if(name.endsWith('-events.csv'))return'events';
  return null;
}
function sessionIdFromName(name,kind){return name.replace(new RegExp(`-${kind}\\.(json|csv)$`),'')}

async function addFiles(files){
  const accepted=[...files].filter(f=>fileKind(f.name));
  if(!accepted.length){showMessage('Session Data Formatの summary.json / samples.csv / events.csv を選択してください。',true);return}
  let ok=0,errors=[];
  for(const file of accepted){
    const kind=fileKind(file.name);let id=sessionIdFromName(file.name,kind);
    try{
      const text=await file.text();let data;
      if(kind==='summary'){
        data=JSON.parse(stripBom(text));id=data.session_id||id;
        if(!String(data.schema_version||'').startsWith('0.'))throw new Error('schema_versionが見つかりません');
      }else data=parseCsv(text);
      const s=state.sessions.get(id)||{id,summary:null,samples:null,events:null,files:{},loadedAt:Date.now()};
      s[kind]=data;s.files[kind]=file.name;state.sessions.set(id,s);ok++;
    }catch(e){errors.push(`${file.name}: ${e.message}`)}
  }
  // Attach orphan CSVs to a summary when the filename-derived id differs only through known summary id.
  hydrateSessionMeta();
  const valid=[...state.sessions.values()].filter(s=>s.summary||s.samples||s.events);
  if(!state.selectedId&&valid.length)state.selectedId=sortSessions(valid)[0].id;
  showMessage(errors.length?`${ok}ファイルを読み込みました。${errors.length}ファイルでエラーがあります。`:`${valid.length}セッション / ${ok}ファイルを読み込みました。`,!!errors.length);
  render();
}

function hydrateSessionMeta(){
  for(const s of state.sessions.values()){
    if(s.summary){s.slug=s.summary.app?.slug||detectSlug(s.id);s.name=s.summary.app?.name||APP_META[s.slug]?.label||s.id;s.date=s.summary.session?.datetime||null;s.version=s.summary.app?.version||''}
    else{s.slug=detectSlug(s.id);s.name=APP_META[s.slug]?.label||s.id;s.date=null;s.version=''}
  }
}
function detectSlug(id){return Object.keys(APP_META).find(x=>id.includes(x))||'unknown'}
function sortSessions(arr=[...state.sessions.values()]){return arr.slice().sort((a,b)=>String(b.date||b.id).localeCompare(String(a.date||a.id)))}

function showMessage(msg,error=false){const el=$('loadMessage');el.hidden=false;el.textContent=msg;el.classList.toggle('error',error);clearTimeout(showMessage.t);showMessage.t=setTimeout(()=>el.hidden=true,6000)}

function render(){
  hydrateSessionMeta();const sessions=sortSessions();const has=sessions.length>0;
  $('datasetBadge').textContent=has?`${sessions.length} SESSION${sessions.length>1?'S':''}`:'NO DATA';
  $('sessionCount').textContent=String(sessions.length);$('clearButton').disabled=!has;$('printButton').disabled=!has;$('overviewButton').disabled=!has;
  const sameAppCount=Math.max(0,...Object.keys(APP_META).map(slug=>sessions.filter(s=>s.slug===slug&&s.summary).length));
  $('comparisonButton').disabled=sameAppCount<2;
  renderSidebar(sessions);
  $('emptyState').hidden=has;
  $('overviewView').hidden=true;$('sessionView').hidden=true;$('comparisonView').hidden=true;
  if(!has)return;
  if(state.view==='comparison'&&sameAppCount>=2){$('comparisonView').hidden=false;renderComparison(sessions)}
  else if(state.view==='session'&&state.selectedId&&state.sessions.get(state.selectedId)){$('sessionView').hidden=false;renderSession(state.sessions.get(state.selectedId))}
  else{state.view='overview';$('overviewView').hidden=false;renderOverview(sessions)}
  $('overviewButton').classList.toggle('active',state.view==='overview');$('comparisonButton').classList.toggle('active',state.view==='comparison');
}

function renderSidebar(sessions){
  const list=$('sessionList');list.innerHTML='';
  if(!sessions.length){list.innerHTML='<div class="empty-mini">まだセッションはありません。</div>';return}
  for(const s of sessions){
    const node=$('sessionCardTemplate').content.firstElementChild.cloneNode(true);node.classList.toggle('active',s.id===state.selectedId&&state.view==='session');
    node.querySelector('.session-app').textContent=s.name;node.querySelector('.session-date').textContent=formatDate(s.date)||s.id;
    node.querySelector('.session-files').textContent=`${fileCount(s)}/3 files · ${APP_META[s.slug]?.role||'SESSION'}`;
    node.querySelector('.session-color').style.background=APP_META[s.slug]?.color||'#77899e';
    node.onclick=()=>{state.selectedId=s.id;state.view='session';render()};list.appendChild(node);
  }
}
function fileCount(s){return ['summary','samples','events'].filter(k=>s[k]).length}
function formatDate(v){if(!v)return'';const d=new Date(v);if(Number.isNaN(d.getTime()))return String(v);return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(d)}
function formatTimeMs(ms){return Number.isFinite(Number(ms))?`${(Number(ms)/1000).toFixed(2)} s`:'—'}

function renderOverview(sessions){
  const root=$('overviewView');
  root.innerHTML=`<div class="overview-intro"><h2>Session Overview</h2><p>1セッションでも複数セッションでも読み込めます。カードを選択すると詳細レポートを表示します。</p></div><div class="overview-cards" id="overviewCards"></div><div class="report-footer"><strong>表示の原則：</strong> 数値はSession Data Formatに保存された結果を記述的に可視化します。標準化された臨床評価の基準値や診断判定は自動適用しません。</div>`;
  const cards=root.querySelector('#overviewCards');
  for(const s of sessions){
    const meta=APP_META[s.slug]||{role:'SESSION',color:'#66798f'};const primary=primaryMetric(s);
    const c=document.createElement('button');c.type='button';c.className='overview-card';c.innerHTML=`
      <div class="overview-card-top"><div><span class="app-tag" style="background:${meta.color}"><span class="app-dot"></span>${esc(meta.role)}</span><h3>${esc(s.name)}</h3></div><time>${esc(formatDate(s.date)||'日時なし')}</time></div>
      <div class="big-metric">${esc(primary.value)}</div><div class="big-label">${esc(primary.label)}</div>
      <div class="mini-row"><span>${esc(sessionDurationLabel(s))}</span><span>${s.summary?.session?.sample_count??s.samples?.length??'—'} samples</span></div>
      <div class="files-row">${filePillsHtml(s)}</div>`;
    c.onclick=()=>{state.selectedId=s.id;state.view='session';render()};cards.appendChild(c)
  }
}

function primaryMetric(s){const m=s.summary?.metrics||{};switch(s.slug){
  case'load-balance-viewer':return{label:'平均 左 / 右 荷重',value:Number.isFinite(m.mean_left_pct)?`${m.mean_left_pct.toFixed(1)} / ${m.mean_right_pct.toFixed(1)}%`:'—'};
  case'cop-stability-test':return{label:'RMS Sway (norm)',value:fmt(m.rms_sway_norm,3)};
  case'limits-of-stability':return{label:'平均最大到達量 (from center)',value:fmt(m.mean_max_excursion_from_center_norm,3)};
  case'weight-shift-trainer':return{label:'完遂 / 開始 trial',value:`${m.completed_trials??'—'} / ${m.started_trials??'—'}`};
  case'balance-controller':return{label:'マウス操作距離',value:Number.isFinite(m.mouse_distance_px)?`${m.mouse_distance_px.toFixed(0)} px`:'—'};
  default:return{label:'Session',value:s.id}
}}
function sessionDurationLabel(s){const x=s.summary?.session;return x?`${fmt(x.measurement_sec??x.duration_sec,1)} sec`:'summaryなし'}
function filePillsHtml(s){return ['summary','samples','events'].map(k=>`<span class="file-pill ${s[k]?'ok':''}">${k}</span>`).join('')}

function renderSession(s){
  const root=$('sessionView'),meta=APP_META[s.slug]||{role:'SESSION',color:'#66798f'};root.className=`view app-${s.slug}`;
  const summary=s.summary||{};const ss=summary.session||{};
  root.innerHTML=`
    <div class="view-header"><div><span class="app-tag" style="background:${meta.color}"><span class="app-dot"></span>${esc(meta.role)}</span><h2>${esc(s.name)}</h2><p>${esc(s.id)} · schema ${esc(summary.schema_version||'unknown')}</p></div><div class="header-meta"><span class="meta-chip">${esc(ss.mode||'MODE UNKNOWN')}</span><span class="meta-chip">${fileCount(s)}/3 files</span></div></div>
    ${!s.summary?'<div class="notice">summary.json がありません。CSVだけから表示できる情報に限定しています。</div>':''}
    <div class="summary-grid">${summaryCardsHtml(s)}</div>
    <div class="content-grid">
      <div class="stack">
        <section class="panel"><div class="panel-head"><div><h3>主要指標</h3><p>summary.json に保存された結果</p></div></div><div class="panel-body">${metricsHtml(s)}</div></section>
        <section class="panel"><div class="panel-head"><div><h3>今回の特徴</h3><p>数値から直接記述できる範囲のみ</p></div></div><div class="panel-body"><div class="analysis-list">${analysisHtml(s)}</div><div class="guard-note">この記述は診断・予後判定ではありません。同一条件での経時比較や実際の生活動作観察と組み合わせて解釈してください。</div></div></section>
        <section class="panel"><div class="panel-head"><div><h3>生活場面で確認する候補</h3><p>結果を生活能力と直接同一視せず、観察仮説として使用</p></div></div><div class="panel-body"><div class="life-list">${lifeHtml(s.slug)}</div></div></section>
        <section class="panel"><div class="panel-head"><div><h3>臨床家コメント</h3><p>このブラウザ内で保持します</p></div></div><div class="panel-body"><textarea id="clinicianNote" class="clinician-note" placeholder="例：右方向へのリーチ時に実際の更衣動作でも同様の左右差がみられるか確認する。"></textarea></div></section>
      </div>
      <div class="stack">
        <section class="panel chart-panel"><div class="panel-head"><div><h3>可視化</h3><p>${s.samples?'samples.csv から描画':'samples.csv を追加するとCoP・時系列グラフを表示できます'}</p></div></div><div class="panel-body"><div id="chartGrid" class="chart-grid"></div></div></section>
        <section class="panel"><div class="panel-head"><div><h3>イベントログ</h3><p>${s.events?'events.csv':'events.csv を追加すると課題中の出来事を表示できます'}</p></div></div><div class="panel-body">${eventsHtml(s)}</div></section>
      </div>
    </div>
    <div class="report-footer"><strong>注意：</strong> 本レポートはWii Balance Boardから得られた正規化CoP・荷重・課題パフォーマンスを扱います。物理単位の重心動揺計測や標準化された臨床スコアとは異なります。</div>`;
  const note=$('clinicianNote');note.value=state.noteBySession.get(s.id)||'';note.oninput=()=>state.noteBySession.set(s.id,note.value);
  requestAnimationFrame(()=>renderCharts(s));
}

function summaryCardsHtml(s){const ss=s.summary?.session||{};return[
  ['Session ID',s.id,''],['アプリ',s.name,s.version?(String(s.version).startsWith('v')?String(s.version):`v${s.version}`):'—'],['測定時間',Number.isFinite(ss.measurement_sec)?`${fmt(ss.measurement_sec,1)} sec`:'—',Number.isFinite(ss.elapsed_sec)?`elapsed ${fmt(ss.elapsed_sec,1)} sec`:'' ],['サンプル数',ss.sample_count??s.samples?.length??'—',s.samples?`${sampleHz(s)} Hz approx.`:'samples.csvなし'],['記録日時',formatDate(ss.datetime||s.date)||'—',ss.mode||'']
].map(([a,b,c])=>`<div class="summary-card"><span>${esc(a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small>${a==='Session ID'?`<div class="data-completeness">${filePillsHtml(s)}</div>`:''}</div>`).join('')}
function sampleHz(s){const arr=s.samples;if(!arr||arr.length<2)return'—';const dt=(arr[arr.length-1].time_ms-arr[0].time_ms)/1000;return dt>0?(arr.length/dt).toFixed(1):'—'}

function metricRows(s){const m=s.summary?.metrics||{};const rows=[];const add=(label,key,unit,note,d=3)=>{if(m[key]!==undefined&&m[key]!==null)rows.push([label,Number.isFinite(Number(m[key]))?fmt(m[key],d):String(m[key]),unit,note])};
  switch(s.slug){
    case'load-balance-viewer':add('Mean Load','mean_load_kg','kg','平均総荷重',1);add('Left','mean_left_pct','%','平均左荷重',1);add('Right','mean_right_pct','%','平均右荷重',1);add('Front','mean_front_pct','%','平均前方荷重',1);add('Back','mean_back_pct','%','平均後方荷重',1);add('Mean CoP X','mean_cop_x_norm','norm','絶対正規化座標');add('Mean CoP Y','mean_cop_y_norm','norm','絶対正規化座標');break;
    case'cop-stability-test':add('Path Length','path_length_norm','norm','総軌跡長');add('Mean Velocity','mean_velocity_norm_sec','norm/s','平均移動速度');add('ML Range','ml_range_norm','norm','左右方向範囲');add('AP Range','ap_range_norm','norm','前後方向範囲');add('RMS Sway','rms_sway_norm','norm','平均位置周囲の動揺');add('Mean Load','mean_load_kg','kg','平均総荷重',1);break;
    case'limits-of-stability':add('Completed Directions','completed_directions','count','完遂方向数',0);add('Mean Max Excursion','mean_max_excursion_from_center_norm','norm','CENTERからの平均最大到達');if(m.best_direction)rows.push(['Best Direction',m.best_direction,'—','最大到達方向']);if(m.worst_direction)rows.push(['Worst Direction',m.worst_direction,'—','最小到達方向']);add('L/R Difference','left_right_difference_norm','norm','右−左の絶対差');add('F/B Difference','front_back_difference_norm','norm','前−後の絶対差');break;
    case'weight-shift-trainer':add('Planned Trials','planned_trials','count','予定回数',0);add('Started Trials','started_trials','count','開始した試行',0);add('Completed Trials','completed_trials','count','完遂した試行',0);add('Success / Started','success_rate_started_pct','%','開始試行に対する成功率',1);add('First Acquisition','mean_first_target_acquisition_sec','sec','最初の目標到達時間');add('Target Re-entry','target_reentry_count','count','再進入回数',0);add('Hold Interruptions','hold_interruption_count','count','保持中断回数',0);add('Mean Target Error','mean_target_error_norm','norm','平均目標誤差');break;
    case'balance-controller':add('Mouse Active Time','mouse_active_duration_sec','sec','存在する場合');add('Mouse Distance','mouse_distance_px','px','累積マウス移動距離',0);add('Mouse Move Events','mouse_move_event_count','count','移動出力回数',0);add('Clicks','click_count','count','左クリック',0);add('Double Clicks','double_click_count','count','ダブルクリック',0);break;
  }return rows}
function metricsHtml(s){const rows=metricRows(s);if(!s.summary)return'<div class="chart-empty">summary.json を追加すると主要指標を表示できます。</div>';if(!rows.length)return'<div class="chart-empty">表示できる主要指標がありません。</div>';return`<table class="metrics-table"><thead><tr><th>指標</th><th>値</th><th>単位</th><th>意味</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r[0])}</td><td class="value">${esc(r[1])}</td><td>${esc(r[2])}</td><td class="note">${esc(r[3])}</td></tr>`).join('')}</tbody></table>`}

function analysisFor(s){const m=s.summary?.metrics||{},a=[];const push=t=>a.push(t);
  if(!s.summary){push('summary.json がないため、自動記述は行っていません。');return a}
  switch(s.slug){
    case'load-balance-viewer':{
      if(Number.isFinite(m.mean_left_pct)&&Number.isFinite(m.mean_right_pct)){const d=m.mean_right_pct-m.mean_left_pct;if(Math.abs(d)<5)push(`平均左右荷重は左${m.mean_left_pct.toFixed(1)}% / 右${m.mean_right_pct.toFixed(1)}%で、大きな左右差はみられません。`);else push(`平均左右荷重は左${m.mean_left_pct.toFixed(1)}% / 右${m.mean_right_pct.toFixed(1)}%で、${d>0?'右':'左'}側が${Math.abs(d).toFixed(1)}ポイント大きくなっています。`)}
      if(Number.isFinite(m.mean_front_pct)&&Number.isFinite(m.mean_back_pct)){const d=m.mean_front_pct-m.mean_back_pct;push(`平均前後荷重は前${m.mean_front_pct.toFixed(1)}% / 後${m.mean_back_pct.toFixed(1)}%です。${Math.abs(d)>=5?`${d>0?'前':'後'}方の割合が大きい状態でした。`:''}`)}break}
    case'cop-stability-test':{
      if(Number.isFinite(m.ml_range_norm)&&Number.isFinite(m.ap_range_norm)){const larger=m.ap_range_norm>m.ml_range_norm?'前後(AP)':'左右(ML)',ratio=Math.max(m.ap_range_norm,m.ml_range_norm)/Math.max(.0001,Math.min(m.ap_range_norm,m.ml_range_norm));push(`ML Rangeは${m.ml_range_norm.toFixed(3)}、AP Rangeは${m.ap_range_norm.toFixed(3)}で、今回の測定では${larger}方向の範囲が${ratio.toFixed(2)}倍でした。`)}
      if(Number.isFinite(m.path_length_norm)&&Number.isFinite(m.rms_sway_norm))push(`30秒の軌跡長は${m.path_length_norm.toFixed(3)} norm、RMS Swayは${m.rms_sway_norm.toFixed(3)} normでした。同一条件の別セッションがあると変化を比較できます。`);break}
    case'limits-of-stability':{
      const dirs=m.directions||[];const best=dirs.find(d=>d.direction===m.best_direction),worst=dirs.find(d=>d.direction===m.worst_direction);if(best&&worst)push(`最大到達は${best.label||best.direction} ${fmt(best.max_excursion_from_center_norm)}、最小到達は${worst.label||worst.direction} ${fmt(worst.max_excursion_from_center_norm)}でした。`);if(Number.isFinite(m.left_right_difference_norm)||Number.isFinite(m.front_back_difference_norm))push(`方向差は左右${fmt(m.left_right_difference_norm)} norm、前後${fmt(m.front_back_difference_norm)} normです。方向別ポリゴンと実動作を照合してください。`);break}
    case'weight-shift-trainer':{
      if(Number.isFinite(m.started_trials)&&Number.isFinite(m.completed_trials))push(`${m.planned_trials??'—'}回予定のうち${m.started_trials}試行を開始し、${m.completed_trials}試行を完遂しました。開始試行に対する成功率は${pct(m.success_rate_started_pct)}です。`);if((m.target_reentry_count||0)>0||(m.hold_interruption_count||0)>0)push(`ターゲット再進入${m.target_reentry_count||0}回、保持中断${m.hold_interruption_count||0}回が記録されています。到達後の保持・修正過程を確認できます。`);break}
    case'balance-controller':{
      push(`マウス操作時間は${fmt(s.summary?.session?.measurement_sec,1)}秒、累積移動距離は${Number(m.mouse_distance_px||0).toFixed(0)} px、クリックは${m.click_count??0}回でした。`);push('このセッションはバランス能力の標準化評価ではなく、重心入力をデバイス操作へ活用したAPPLICATIONのパフォーマンス記録です。');break}
  }
  return a.length?a:['今回のデータから自動記述できる主要な特徴はありません。']
}
function analysisHtml(s){return analysisFor(s).map(t=>`<div class="analysis-item"><span class="analysis-bullet"></span><p>${esc(t)}</p></div>`).join('')}

function lifeItems(slug){switch(slug){
  case'load-balance-viewer':return['立ち上がり・移乗時の左右荷重の使い方','立位更衣や洗面中に同じ荷重偏位が出るか','リーチや物品操作の開始時に荷重がどう変化するか'];
  case'cop-stability-test':return['洗面・歯磨きなど、その場で立ち続ける活動','待機・立位会話など、持続的な静止立位','実生活でも左右／前後の揺れ方向に同じ特徴があるか'];
  case'limits-of-stability':return['棚・キッチンで左右や斜め方向へ手を伸ばす場面','トイレ更衣など支持基底面内で身体を傾ける場面','小さい方向が実生活のリーチ範囲にも表れるか'];
  case'weight-shift-trainer':return['物を取る・衣服を操作する際の「動く→止める→戻る」','移乗や一歩目の前に必要な荷重移動','ターゲット到達後に姿勢を保持できるか'];
  case'balance-controller':return['PCやWebを重心入力で実際に操作できるか','目的位置までポインタを動かし、中央へ戻して停止できるか','クリック動作を含めて余暇・コミュニケーション活動へ使えるか'];
  default:return['実際の生活動作で同じ特徴がみられるか確認する']}}
function lifeHtml(slug){return lifeItems(slug).map((x,i)=>`<div class="life-item"><b>${i+1}</b><span>${esc(x)}</span></div>`).join('')}

function eventsHtml(s){if(!s.events)return'<div class="chart-empty">events.csv を追加するとイベントを表示できます。</div>';if(!s.events.length)return'<div class="chart-empty">イベントは記録されていません。</div>';const rows=s.events.slice(0,200);return`<div class="events-wrap"><table class="events-table"><thead><tr><th>時刻</th><th>イベント</th><th>phase</th><th>trial</th><th>方向</th><th>値</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(formatTimeMs(e.time_ms))}</td><td>${esc(e.event)}</td><td>${esc(e.phase)}</td><td>${esc(e.trial)}</td><td>${esc(e.direction)}</td><td>${esc(e.value)}</td></tr>`).join('')}</tbody></table></div>${s.events.length>200?`<div class="guard-note">最初の200イベントを表示しています（全${s.events.length}件）。</div>`:''}`}

function chartCard(title,id,cls=''){return`<div class="chart-card ${cls}"><h4>${esc(title)}</h4><canvas id="${id}"></canvas></div>`}
function chartEmpty(msg){return`<div class="chart-card wide"><div class="chart-empty">${esc(msg)}</div></div>`}
function renderCharts(s){const grid=$('chartGrid');if(!grid)return;if(!s.samples||!s.samples.length){grid.innerHTML=chartEmpty('samples.csv を追加すると詳細グラフを表示できます。');return}
  switch(s.slug){
    case'load-balance-viewer':grid.innerHTML=chartCard('CoP軌跡','chartA')+chartCard('左右荷重比','chartB','small')+chartCard('前後荷重比','chartC','small');drawCop($('chartA'),s.samples,'cop_x_norm','cop_y_norm');drawSeries($('chartB'),s.samples,[['left_pct','#2268e8','Left %'],['right_pct','#d05c6e','Right %']],{yMin:0,yMax:100});drawSeries($('chartC'),s.samples,[['front_pct','#008a9b','Front %'],['back_pct','#d07b18','Back %']],{yMin:0,yMax:100});break;
    case'cop-stability-test':grid.innerHTML=chartCard('CoP軌跡','chartA')+chartCard('CoP X / Y 時間変化','chartB','small')+chartCard('総荷重','chartC','small');drawCop($('chartA'),s.samples,'cop_x_norm','cop_y_norm');drawSeries($('chartB'),s.samples,[['cop_x_norm','#2268e8','X'],['cop_y_norm','#d05c6e','Y']],{zero:true});drawSeries($('chartC'),s.samples,[['total_kg','#168a5b','Total kg']],{});break;
    case'limits-of-stability':grid.innerHTML=chartCard('8方向 最大到達ポリゴン','chartA')+chartCard('CENTER相対CoP軌跡','chartB')+chartCard('Projection 時間変化','chartC','wide small');drawRadar($('chartA'),s.summary?.metrics?.directions||[]);drawCop($('chartB'),s.samples,'rel_x_norm','rel_y_norm',{auto:true});drawSeries($('chartC'),s.samples,[[hasKey(s.samples,'projection_from_center_norm')?'projection_from_center_norm':'projection_norm','#7a55c7','projection']],{});break;
    case'weight-shift-trainer':grid.innerHTML=chartCard('CoP軌跡','chartA')+chartCard('Target Error','chartB')+chartCard('Trial / Event Timeline','chartC','wide small');drawCop($('chartA'),s.samples,'cop_x_norm','cop_y_norm');drawSeries($('chartB'),s.samples,[['target_error_norm','#d07b18','target error']],{});drawEventTimeline($('chartC'),s.events||[]);break;
    case'balance-controller':grid.innerHTML=chartCard('CoP入力','chartA')+chartCard('Mouse Output X / Y','chartB')+chartCard('Mouse dx / dy','chartC','wide small');drawCop($('chartA'),s.samples,'cop_x_norm','cop_y_norm');drawSeries($('chartB'),s.samples,[['output_x_norm','#2268e8','X'],['output_y_norm','#168a5b','Y']],{zero:true});drawSeries($('chartC'),s.samples,[['mouse_dx_px','#2268e8','dx px'],['mouse_dy_px','#d05c6e','dy px']],{zero:true});break;
    default:grid.innerHTML=chartCard('CoP軌跡','chartA');drawCop($('chartA'),s.samples,'cop_x_norm','cop_y_norm')
  }
}
function hasKey(arr,key){return arr.some(r=>r[key]!==undefined&&r[key]!=='')}
function setupCanvas(canvas){const r=canvas.getBoundingClientRect(),dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.max(1,Math.floor(r.width*dpr));canvas.height=Math.max(1,Math.floor(r.height*dpr));const ctx=canvas.getContext('2d');ctx.setTransform(dpr,0,0,dpr,0,0);return{ctx,w:r.width,h:r.height}}
function axes(ctx,w,h,p=35){ctx.strokeStyle='#dfe6ee';ctx.lineWidth=1;for(let i=0;i<=4;i++){const x=p+(w-2*p)*i/4,y=p+(h-2*p)*i/4;ctx.beginPath();ctx.moveTo(x,p);ctx.lineTo(x,h-p);ctx.stroke();ctx.beginPath();ctx.moveTo(p,y);ctx.lineTo(w-p,y);ctx.stroke()}ctx.strokeStyle='#8798ab';ctx.beginPath();ctx.moveTo(p,h-p);ctx.lineTo(w-p,h-p);ctx.stroke();ctx.beginPath();ctx.moveTo(p,p);ctx.lineTo(p,h-p);ctx.stroke()}
function decimate(arr,max=1200){if(arr.length<=max)return arr;const step=Math.ceil(arr.length/max);return arr.filter((_,i)=>i%step===0)}
function drawCop(canvas,rows,xKey,yKey,opt={}){const {ctx,w,h}=setupCanvas(canvas),p=34,data=decimate(rows.filter(r=>Number.isFinite(Number(r[xKey]))&&Number.isFinite(Number(r[yKey]))));ctx.clearRect(0,0,w,h);axes(ctx,w,h,p);if(!data.length)return;let lim=1;if(opt.auto){lim=Math.max(.2,...data.flatMap(r=>[Math.abs(Number(r[xKey])),Math.abs(Number(r[yKey]))]));lim*=1.08}else lim=Math.max(1,...data.flatMap(r=>[Math.abs(Number(r[xKey])),Math.abs(Number(r[yKey]))]));const sx=x=>p+(Number(x)+lim)/(2*lim)*(w-2*p),sy=y=>h-p-(Number(y)+lim)/(2*lim)*(h-2*p);ctx.strokeStyle='#2b70e8';ctx.lineWidth=1;ctx.globalAlpha=.65;ctx.beginPath();data.forEach((r,i)=>{const x=sx(r[xKey]),y=sy(r[yKey]);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke();ctx.globalAlpha=1;ctx.fillStyle='#d34d5f';ctx.beginPath();ctx.arc(sx(0),sy(0),3,0,Math.PI*2);ctx.fill();ctx.fillStyle='#73859a';ctx.font='10px sans-serif';ctx.fillText(`X ±${lim.toFixed(2)}`,p,h-9);ctx.save();ctx.translate(10,h/2);ctx.rotate(-Math.PI/2);ctx.fillText(`Y ±${lim.toFixed(2)}`,0,0);ctx.restore()}
function drawSeries(canvas,rows,series,opt={}){const {ctx,w,h}=setupCanvas(canvas),p=34,data=decimate(rows,1000),valid=[];for(const [key] of series)for(const r of data){const v=Number(r[key]);if(Number.isFinite(v))valid.push(v)}ctx.clearRect(0,0,w,h);axes(ctx,w,h,p);if(!valid.length){ctx.fillStyle='#8a99aa';ctx.font='11px sans-serif';ctx.fillText('No data',w/2-18,h/2);return}const x0=Number(data[0]?.time_ms||0),x1=Number(data[data.length-1]?.time_ms||data.length);let ymin=opt.yMin??Math.min(...valid),ymax=opt.yMax??Math.max(...valid);if(opt.zero){const a=Math.max(Math.abs(ymin),Math.abs(ymax),.05);ymin=-a;ymax=a}if(ymax===ymin){ymax+=1;ymin-=1}else if(opt.yMin===undefined){const pad=(ymax-ymin)*.08;ymin-=pad;ymax+=pad}const sx=t=>p+(Number(t)-x0)/Math.max(1,x1-x0)*(w-2*p),sy=v=>h-p-(Number(v)-ymin)/Math.max(.00001,ymax-ymin)*(h-2*p);if(ymin<0&&ymax>0){ctx.strokeStyle='#bdc9d6';ctx.beginPath();ctx.moveTo(p,sy(0));ctx.lineTo(w-p,sy(0));ctx.stroke()}series.forEach(([key,color,label],si)=>{ctx.strokeStyle=color;ctx.lineWidth=si===0?1.5:1.2;ctx.beginPath();let started=false;for(const r of data){const v=Number(r[key]);if(!Number.isFinite(v))continue;const x=sx(r.time_ms),y=sy(v);started?ctx.lineTo(x,y):(ctx.moveTo(x,y),started=true)}ctx.stroke();ctx.fillStyle=color;ctx.fillRect(p+si*78,8,12,2);ctx.fillStyle='#5f7289';ctx.font='9px sans-serif';ctx.fillText(label,p+17+si*78,11)});ctx.fillStyle='#718399';ctx.font='9px sans-serif';ctx.fillText(`${(x0/1000).toFixed(0)}s`,p,h-9);ctx.fillText(`${(x1/1000).toFixed(1)}s`,w-p-28,h-9);ctx.fillText(ymax.toFixed(2),3,p+3);ctx.fillText(ymin.toFixed(2),3,h-p)}
function drawRadar(canvas,dirs){const {ctx,w,h}=setupCanvas(canvas);ctx.clearRect(0,0,w,h);if(!dirs.length){ctx.fillStyle='#8a99aa';ctx.fillText('No direction data',w/2-30,h/2);return}const labels=['front','front-right','right','back-right','back','back-left','left','front-left'],map=Object.fromEntries(dirs.map(d=>[d.direction,d])),vals=labels.map(k=>Number(map[k]?.max_excursion_from_center_norm||0)),max=Math.max(1,...vals)*1.08,cx=w/2,cy=h/2,r=Math.min(w,h)*.36;ctx.strokeStyle='#dce4ed';ctx.fillStyle='#75879c';ctx.font='9px sans-serif';for(let ring=1;ring<=4;ring++){ctx.beginPath();labels.forEach((_,i)=>{const a=-Math.PI/2+i*Math.PI/4,rr=r*ring/4,x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.stroke()}labels.forEach((k,i)=>{const a=-Math.PI/2+i*Math.PI/4,x=cx+Math.cos(a)*r,y=cy+Math.sin(a)*r;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(x,y);ctx.stroke();const t=map[k]?.label||k;ctx.fillText(t,cx+Math.cos(a)*(r+16)-ctx.measureText(t).width/2,cy+Math.sin(a)*(r+16)+3)});ctx.strokeStyle='#7a55c7';ctx.fillStyle='rgba(122,85,199,.17)';ctx.lineWidth=2;ctx.beginPath();vals.forEach((v,i)=>{const a=-Math.PI/2+i*Math.PI/4,rr=r*v/max,x=cx+Math.cos(a)*rr,y=cy+Math.sin(a)*rr;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.closePath();ctx.fill();ctx.stroke();ctx.fillStyle='#7a55c7';vals.forEach((v,i)=>{const a=-Math.PI/2+i*Math.PI/4,rr=r*v/max;ctx.beginPath();ctx.arc(cx+Math.cos(a)*rr,cy+Math.sin(a)*rr,3,0,Math.PI*2);ctx.fill()})}
function drawEventTimeline(canvas,events){const {ctx,w,h}=setupCanvas(canvas),p=34;ctx.clearRect(0,0,w,h);axes(ctx,w,h,p);if(!events.length){ctx.fillStyle='#8a99aa';ctx.fillText('events.csv を追加するとイベントを描画します',p+20,h/2);return}const end=Math.max(...events.map(e=>Number(e.time_ms)||0),1),types=['TARGET_START','TARGET_REACHED','TARGET_REENTRY','HOLD_INTERRUPTED','HOLD_SUCCESS','SESSION_END'],colors=['#708399','#2268e8','#7a55c7','#d14d5c','#168a5b','#263d59'];types.forEach((t,i)=>{const y=p+(h-2*p)*(i+.5)/types.length;ctx.fillStyle='#66798e';ctx.font='8px sans-serif';ctx.fillText(t,4,y+3);ctx.strokeStyle='#eef1f5';ctx.beginPath();ctx.moveTo(p+88,y);ctx.lineTo(w-p,y);ctx.stroke()});for(const e of events){const i=types.indexOf(e.event);if(i<0)continue;const y=p+(h-2*p)*(i+.5)/types.length,x=p+88+(Number(e.time_ms)||0)/end*(w-p-(p+88));ctx.fillStyle=colors[i];ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill()}ctx.fillStyle='#7b8c9f';ctx.font='8px sans-serif';ctx.fillText('0s',p+88,h-8);ctx.fillText(`${(end/1000).toFixed(1)}s`,w-p-26,h-8)}

function renderComparison(sessions){
  const groups=Object.entries(APP_META).map(([slug,m])=>({slug,m,items:sortSessions(sessions.filter(s=>s.slug===slug&&s.summary)).reverse()})).filter(g=>g.items.length>=2);const root=$('comparisonView');
  if(!groups.length){root.innerHTML='<div class="notice">同じアプリのsummary.jsonが2セッション以上あると比較できます。</div>';return}
  const initial=renderComparison.current&&groups.some(g=>g.slug===renderComparison.current)?renderComparison.current:groups[0].slug;renderComparison.current=initial;
  root.innerHTML=`<div class="comparison-head"><h2>Session Comparison</h2><p>同じアプリ・同じ測定条件での比較を基本とします。条件が未記録の場合は数値差のみを表示します。</p><div class="compare-controls"><select id="compareApp" class="select">${groups.map(g=>`<option value="${g.slug}" ${g.slug===initial?'selected':''}>${esc(g.m.label)} (${g.items.length})</option>`).join('')}</select></div></div><div id="compareBody"></div>`;
  $('compareApp').onchange=e=>{renderComparison.current=e.target.value;renderComparison(sessions)};renderComparisonBody(groups.find(g=>g.slug===initial));
}
function comparableMetricDefs(slug){switch(slug){
  case'load-balance-viewer':return[['mean_left_pct','Left %'],['mean_right_pct','Right %'],['mean_front_pct','Front %'],['mean_back_pct','Back %']];
  case'cop-stability-test':return[['path_length_norm','Path Length'],['mean_velocity_norm_sec','Mean Velocity'],['ml_range_norm','ML Range'],['ap_range_norm','AP Range'],['rms_sway_norm','RMS Sway']];
  case'limits-of-stability':return[['mean_max_excursion_from_center_norm','Mean Max Excursion'],['left_right_difference_norm','L/R Difference'],['front_back_difference_norm','F/B Difference']];
  case'weight-shift-trainer':return[['success_rate_started_pct','Success / Started %'],['mean_first_target_acquisition_sec','First Acquisition'],['target_reentry_count','Re-entry'],['hold_interruption_count','Hold Interruptions'],['mean_target_error_norm','Target Error']];
  case'balance-controller':return[['mouse_distance_px','Mouse Distance px'],['mouse_move_event_count','Move Events'],['click_count','Clicks']];default:return[]}}
function renderComparisonBody(group){const body=$('compareBody'),items=group.items,defs=comparableMetricDefs(group.slug);const conditionsConsistent=items.every((s,i)=>i===0||JSON.stringify(s.summary.condition||{})===JSON.stringify(items[0].summary.condition||{}));body.innerHTML=`${conditionsConsistent?'':'<div class="notice">測定条件が一致していない、または記録内容が異なります。変化量の臨床的解釈には注意してください。</div>'}<div class="comparison-grid"><section class="panel"><div class="panel-head"><div><h3>セッション別主要指標</h3><p>${items.length} sessions</p></div></div><div class="panel-body"><div class="events-wrap"><table class="compare-table"><thead><tr><th>日時</th>${defs.map(d=>`<th>${esc(d[1])}</th>`).join('')}</tr></thead><tbody>${items.map(s=>`<tr><td>${esc(formatDate(s.date))}</td>${defs.map(([k])=>`<td>${esc(fmt(s.summary.metrics?.[k]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></section><section class="panel trend-chart"><div class="panel-head"><div><h3>経時変化</h3><p>主要指標をセッション順に表示</p></div></div><div class="panel-body"><canvas id="trendCanvas"></canvas></div></section></div>`;requestAnimationFrame(()=>drawTrend($('trendCanvas'),items,defs.slice(0,3)))}
function drawTrend(canvas,items,defs){const {ctx,w,h}=setupCanvas(canvas),p=40;ctx.clearRect(0,0,w,h);axes(ctx,w,h,p);const vals=defs.flatMap(([k])=>items.map(s=>Number(s.summary.metrics?.[k])).filter(Number.isFinite));if(!vals.length)return;let ymin=Math.min(...vals),ymax=Math.max(...vals);if(ymax===ymin){ymin-=1;ymax+=1}else{const pad=(ymax-ymin)*.12;ymin-=pad;ymax+=pad}const colors=['#2268e8','#d05c6e','#168a5b'];defs.forEach(([k,label],j)=>{ctx.strokeStyle=colors[j];ctx.lineWidth=2;ctx.beginPath();let started=false;items.forEach((s,i)=>{const v=Number(s.summary.metrics?.[k]);if(!Number.isFinite(v))return;const x=p+(w-2*p)*(items.length===1?.5:i/(items.length-1)),y=h-p-(v-ymin)/(ymax-ymin)*(h-2*p);started?ctx.lineTo(x,y):(ctx.moveTo(x,y),started=true);ctx.fillStyle=colors[j];ctx.beginPath();ctx.arc(x,y,3,0,Math.PI*2);ctx.fill()});ctx.stroke();ctx.fillStyle=colors[j];ctx.fillRect(p+j*130,9,14,2);ctx.fillStyle='#5f7289';ctx.font='9px sans-serif';ctx.fillText(label,p+19+j*130,12)})}

function clearAll(){state.sessions.clear();state.selectedId=null;state.view='overview';state.noteBySession.clear();$('fileInput').value='';render()}

function bind(){
  $('fileInput').onchange=e=>addFiles(e.target.files);$('emptySelectButton').onclick=()=>$('fileInput').click();$('clearButton').onclick=clearAll;$('printButton').onclick=()=>window.print();
  $('overviewButton').onclick=()=>{state.view='overview';render()};$('comparisonButton').onclick=()=>{if(!$('comparisonButton').disabled){state.view='comparison';render()}};
  const dz=$('dropZone');['dragenter','dragover'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add('dragover')}));['dragleave','drop'].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove('dragover')}));dz.addEventListener('drop',e=>addFiles(e.dataTransfer.files));dz.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('fileInput').click()}});
  window.addEventListener('resize',()=>{if(state.view==='session'&&state.selectedId)renderCharts(state.sessions.get(state.selectedId));else if(state.view==='comparison')render()});
}

bind();render();
if(location.protocol==='http:'||location.protocol==='https:'){setInterval(()=>fetch('/__heartbeat',{cache:'no-store'}).catch(()=>{}),5000);fetch('/__heartbeat',{cache:'no-store'}).catch(()=>{});}
})();

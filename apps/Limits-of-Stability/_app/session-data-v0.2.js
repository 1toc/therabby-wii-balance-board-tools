(() => {
'use strict';

const SCHEMA_VERSION='0.2';
const COMMON_SAMPLE_COLUMNS=['time_ms','lf_kg','rf_kg','lb_kg','rb_kg','total_kg','cop_x_norm','cop_y_norm','weight_present'];
const EVENT_COLUMNS=['time_ms','event','phase','trial','direction','value','note'];
const DEFAULT_CONDITION={
  eyes:'not_recorded',
  stance:'not_recorded',
  footwear:'not_recorded',
  upper_limb_support:'not_recorded',
  assist:'not_recorded'
};

const pad=(n,w=2)=>String(n).padStart(w,'0');
const compactTimestamp=(d=new Date())=>`${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
const makeSessionId=(slug,d=new Date())=>`${compactTimestamp(d)}-${slug}`;
const localIso=(d=new Date())=>{
  const off=-d.getTimezoneOffset(),sign=off>=0?'+':'-',abs=Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}${sign}${pad(Math.floor(abs/60))}:${pad(abs%60)}`;
};
const modeValue=(mode)=>String(mode).toLowerCase()==='real'?'REAL_WBB':'MOCK';
const cleanValue=(v)=>v===undefined?null:v;
const csvCell=(v)=>{
  if(v===null||v===undefined)return '';
  if(typeof v==='number')return Number.isFinite(v)?String(v):'';
  if(typeof v==='boolean')return v?'true':'false';
  const s=String(v);
  return /[",\r\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;
};
const toCsv=(rows,columns)=>'\uFEFF'+[columns.join(','),...rows.map(row=>columns.map(c=>csvCell(row[c])).join(','))].join('\r\n');
const download=(name,type,content)=>{
  const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
};
const event=(time_ms,eventName,{phase='',trial='',direction='',value='',note=''}={})=>({time_ms:Math.max(0,Math.round(time_ms||0)),event:eventName,phase,trial,direction,value,note});
const sampleSpanSec=(samples)=>{
  if(!samples?.length)return 0;
  const times=samples.map(r=>Number(r.time_ms)).filter(Number.isFinite);
  if(times.length<2)return 0;
  return Math.max(0,(Math.max(...times)-Math.min(...times))/1000);
};

function saveBundle({app,sessionId,startedAt,endedAt=new Date(),measurementSec=null,mode='mock',condition={},protocol={},metrics={},samples=[],sampleExtraColumns=[],events=[],notes=[]}){
  if(!app?.name||!app?.slug)throw new Error('SessionDataV02: app.name / app.slug are required.');
  const start=startedAt instanceof Date?startedAt:new Date(startedAt||Date.now());
  const end=endedAt instanceof Date?endedAt:new Date(endedAt||Date.now());
  const id=sessionId||makeSessionId(app.slug,start);
  const sampleColumns=[...COMMON_SAMPLE_COLUMNS,...sampleExtraColumns.filter(c=>!COMMON_SAMPLE_COLUMNS.includes(c))];
  const normalizedSamples=samples.map(row=>Object.fromEntries(sampleColumns.map(c=>[c,cleanValue(row[c])])));
  const normalizedEvents=(events||[]).map(row=>Object.fromEntries(EVENT_COLUMNS.map(c=>[c,cleanValue(row[c])])));
  const elapsedSec=Math.max(0,(end-start)/1000);
  const measured=Number.isFinite(Number(measurementSec))?Math.max(0,Number(measurementSec)):sampleSpanSec(normalizedSamples);
  const summary={
    schema_version:SCHEMA_VERSION,
    session_id:id,
    app:{name:app.name,slug:app.slug,version:app.version||'1.0 β'},
    session:{
      datetime:localIso(start),
      ended_at:localIso(end),
      elapsed_sec:elapsedSec,
      measurement_sec:measured,
      mode:modeValue(mode),
      sample_count:normalizedSamples.length
    },
    condition:{...DEFAULT_CONDITION,...condition},
    protocol,
    metrics,
    notes:Array.isArray(notes)?notes:[String(notes)]
  };
  const base=`${compactTimestamp(start)}-${app.slug}`;
  download(`${base}-summary.json`,'application/json;charset=utf-8',JSON.stringify(summary,null,2));
  setTimeout(()=>download(`${base}-samples.csv`,'text/csv;charset=utf-8',toCsv(normalizedSamples,sampleColumns)),180);
  setTimeout(()=>download(`${base}-events.csv`,'text/csv;charset=utf-8',toCsv(normalizedEvents,EVENT_COLUMNS)),360);
  return {summary,sampleColumns,eventColumns:EVENT_COLUMNS,base};
}

window.SessionDataV02={SCHEMA_VERSION,COMMON_SAMPLE_COLUMNS,EVENT_COLUMNS,DEFAULT_CONDITION,compactTimestamp,makeSessionId,localIso,modeValue,event,saveBundle,toCsv,sampleSpanSec};
})();

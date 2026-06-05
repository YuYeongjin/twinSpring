/**
 * WorkPlanDashboard.jsx  (v3 — i18n + FormulaTooltip)
 */
import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useT } from '../../../i18n/LanguageContext';

// ═══════════════════════════════════════════════════════════════════════════
// 계산 상수
// ═══════════════════════════════════════════════════════════════════════════

const FLOOR_GAP   = 2.0;
const OVERLAP     = 0.60;
const SAFETY      = 1.20;
const TARGET_DAYS = 21;

const DEFAULT_SIZE = {
  IfcColumn: [0.50, 0.50, 3.00],
  IfcBeam:   [5.00, 0.40, 0.40],
  IfcWall:   [5.00, 0.20, 3.00],
  IfcSlab:   [5.00, 5.00, 0.20],
  IfcPier:   [1.00, 1.00, 5.00],
};

const SPEC = {
  'IfcColumn:concrete': { prod:3.5/6,  workers:6,  maxW:18, roles:'거푸집공·철근공·콘크리트공', equipment:'거푸집, 진동기, 콘크리트 펌프카' },
  'IfcColumn:steel':    { prod:0.19/5, workers:5,  maxW:10, roles:'용접공·조립공·신호수',       equipment:'용접기, 타워 크레인' },
  'IfcColumn:timber':   { prod:2.0/4,  workers:4,  maxW:8,  roles:'목수·신호수',               equipment:'전동공구, 이동 크레인' },
  'IfcColumn:composite':{ prod:2.5/7,  workers:7,  maxW:14, roles:'철골공·콘크리트공',           equipment:'용접기, 펌프카, 타워 크레인' },
  'IfcBeam:concrete':   { prod:4.0/6,  workers:6,  maxW:18, roles:'거푸집공·철근공·콘크리트공', equipment:'거푸집, 진동기, 콘크리트 펌프카' },
  'IfcBeam:steel':      { prod:0.26/5, workers:5,  maxW:10, roles:'용접공·조립공·신호수',       equipment:'용접기, 고장력 볼트 공구, 타워 크레인' },
  'IfcBeam:timber':     { prod:2.5/4,  workers:4,  maxW:8,  roles:'목수·신호수',               equipment:'전동공구, 이동 크레인' },
  'IfcBeam:composite':  { prod:3.0/7,  workers:7,  maxW:14, roles:'철골공·콘크리트공',           equipment:'용접기, 펌프카, 타워 크레인' },
  'IfcSlab:concrete':   { prod:6.0/8,  workers:8,  maxW:16, roles:'철근공·콘크리트공',           equipment:'바이브레이터, 레벨링 장비, 콘크리트 펌프카' },
  'IfcSlab:steel':      { prod:0.32/6, workers:6,  maxW:12, roles:'데크공·용접공',              equipment:'핀 용접기, 타워 크레인' },
  'IfcSlab:timber':     { prod:3.5/5,  workers:5,  maxW:10, roles:'목수',                      equipment:'전동공구, 못 박기 총' },
  'IfcSlab:composite':  { prod:4.5/7,  workers:7,  maxW:14, roles:'데크공·콘크리트공',           equipment:'핀 용접기, 바이브레이터, 펌프카' },
  'IfcWall:concrete':   { prod:4.0/6,  workers:6,  maxW:18, roles:'거푸집공·철근공·콘크리트공', equipment:'유로폼, 진동기, 콘크리트 펌프카' },
  'IfcWall:steel':      { prod:0.19/5, workers:5,  maxW:10, roles:'용접공·조립공·신호수',       equipment:'용접기, 이동 크레인' },
  'IfcWall:timber':     { prod:2.5/4,  workers:4,  maxW:8,  roles:'목수',                      equipment:'전동공구' },
  'IfcPier:concrete':   { prod:3.0/8,  workers:8,  maxW:16, roles:'거푸집공·철근공·콘크리트공', equipment:'거푸집, 진동기, 이동 크레인, 펌프카' },
  'IfcPier:steel':      { prod:0.15/6, workers:6,  maxW:12, roles:'용접공·조립공·신호수',       equipment:'용접기, 대형 이동 크레인' },
};
const SPEC_DEF = { prod:4.0/6, workers:6, maxW:12, roles:'일반공', equipment:'일반 공구' };

const FIXED = {
  '설계 및 인허가':    { days:30, workers:5,  roles:'건축사·구조기술사·감리',          equipment:'CAD/BIM 소프트웨어',             phase:'design' },
  '가설공사':          { days:14, workers:10, roles:'형틀목수·일반공·안전관리자',       equipment:'굴착기 1대, 이동 크레인 1대',    phase:'temporary' },
  '토공사 및 기초굴착':{ days:21, workers:15, roles:'굴착기 운전사·덤프 운전사·측량사',equipment:'굴착기 2대, 덤프트럭 4대, 항타기',phase:'earthwork' },
  '기초공사':          { days:21, workers:14, roles:'항타공·철근공·콘크리트공·측량사', equipment:'항타기 1대, 펌프카 1대, 진동기 2대',phase:'foundation' },
  '마감공사':          { days:30, workers:10, roles:'미장공·타일공·도장공·창호공',      equipment:'시스템 비계, 믹서 1대',          phase:'finishing' },
  '설비 및 전기공사':  { days:21, workers:8,  roles:'배관공·전기공·소방공',             equipment:'배관·전기 공구 세트, 고소 작업차',phase:'mep' },
  '검사 및 준공':      { days:14, workers:4,  roles:'감리원·검사관·측량사',             equipment:'측량기, 내화 시험 장비',          phase:'completion' },
};

const PHASE_COLOR = {
  design:'#64748b', temporary:'#78716c', earthwork:'#d97706', foundation:'#f97316',
  frame:'#3b82f6',  slab:'#06b6d4',      wall:'#6366f1',      finishing:'#22c55e',
  mep:'#14b8a6',    completion:'#a855f7',
};
const PHASE_LABEL_KO = {
  design:'설계', temporary:'가설', earthwork:'토공', foundation:'기초',
  frame:'골조',  slab:'슬래브',    wall:'벽체',      finishing:'마감',
  mep:'설비·전기', completion:'준공',
};

const CONCRETE_MIX = { cement:350, sand:0.53, gravel:0.60, water:175 };
const REBAR_RATIO  = { IfcColumn:150, IfcBeam:120, IfcSlab:100, IfcWall:80, IfcPier:180 };
const STEEL_DENSITY = 7.85;
const WELD_RATIO    = 0.020;
const BOLT_PER_MEMBER = 4;
const TIMBER_HW     = 9;

// ═══════════════════════════════════════════════════════════════════════════
// 헬퍼
// ═══════════════════════════════════════════════════════════════════════════

const r2 = v => Math.round(v*100)/100;
const r1 = v => Math.round(v*10)/10;
const r0 = v => Math.round(v);

function classifyMat(mat) {
  if (!mat) return 'concrete';
  const m = mat.toLowerCase();
  if (/steel|ss\d|shn|grade|stainless/.test(m)) return 'steel';
  if (/timber|pine|oak|glulam|clt|lvl/.test(m))  return 'timber';
  if (/composite|frp|carbon|fiber/.test(m))       return 'composite';
  return 'concrete';
}

function elDims(el) {
  const def = DEFAULT_SIZE[el.elementType] || [1,1,1];
  const g = (k,d) => { const v=parseFloat(el[k]); return v>0?v:d; };
  return [g('sizeX',def[0]), g('sizeY',def[1]), g('sizeZ',def[2])];
}

function elVol(el) { const [x,y,z]=elDims(el); return x*y*z; }
function elZ(el)   { return parseFloat(el.positionZ)||0; }
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function dateDiff(a,b){ return Math.round((b-a)/86400000); }
function fmtDate(d){ return d instanceof Date ? d.toISOString().slice(0,10) : d; }

function fwArea(el) {
  const [sx,sy,sz] = elDims(el);
  switch(el.elementType){
    case 'IfcColumn': return 2*(sx+sy)*sz;
    case 'IfcBeam':   return sx*(sy+2*sz);
    case 'IfcWall':   return 2*sx*sz;
    case 'IfcSlab':   return sx*sy;
    case 'IfcPier':   return 2*(sx+sy)*sz;
    default:          return sx*sy;
  }
}

function detectFloors(elements) {
  if (!elements.length) return [];
  const sorted = [...elements].sort((a,b)=>elZ(a)-elZ(b));
  const groups = [[sorted[0]]];
  for (let i=1; i<sorted.length; i++) {
    const prev = groups[groups.length-1];
    if (elZ(sorted[i]) - elZ(prev[prev.length-1]) >= FLOOR_GAP) groups.push([sorted[i]]);
    else prev.push(sorted[i]);
  }
  return groups.map(g => {
    const zs=g.map(elZ);
    return { avgZ:zs.reduce((a,b)=>a+b)/zs.length, elements:g };
  });
}

function floorLabel(idx, floors) {
  const above = floors.map((_,i)=>i).filter(i=>floors[i].avgZ>=0.5);
  const below  = floors.map((_,i)=>i).filter(i=>floors[i].avgZ<0.5);
  if (above.includes(idx)) return `${above.indexOf(idx)+1}층`;
  return `B${below.length-below.indexOf(idx)}`;
}

function calcPhase(vol, etype, mat) {
  if (!vol||vol<=0) return null;
  const spec = SPEC[`${etype}:${mat}`]||SPEC_DEF;
  const w = Math.min(Math.ceil(vol/(spec.prod*TARGET_DAYS/SAFETY)), spec.maxW);
  return { days:Math.max(1,Math.ceil(vol/(spec.prod*w)*SAFETY)), workers:w,
           roles:spec.roles, equipment:spec.equipment, volume:r2(vol) };
}

function calcMaterials(elements) {
  const floors = detectFloors(elements);
  const agg = {
    concrete:{ vol:0, cement:0, sand:0, gravel:0, water:0, rebar:0, formwork:0 },
    steel:   { weight:0, weldKg:0, bolts:0 },
    timber:  { vol:0, hardware:0 },
    byFloor: [],
  };
  for (let i=0; i<floors.length; i++) {
    const fl = { label:floorLabel(i,floors), conc_m3:0, rebar_t:0, fw_m2:0, steel_t:0, timber_m3:0 };
    for (const el of floors[i].elements) {
      if (!['IfcColumn','IfcBeam','IfcSlab','IfcWall','IfcPier'].includes(el.elementType)) continue;
      const mat=classifyMat(el.material), vol=elVol(el), fw=fwArea(el);
      if (mat==='concrete'||mat==='composite') {
        const rb=vol*(REBAR_RATIO[el.elementType]||100);
        agg.concrete.vol+=vol; agg.concrete.cement+=vol*CONCRETE_MIX.cement;
        agg.concrete.sand+=vol*CONCRETE_MIX.sand; agg.concrete.gravel+=vol*CONCRETE_MIX.gravel;
        agg.concrete.water+=vol*CONCRETE_MIX.water; agg.concrete.rebar+=rb;
        agg.concrete.formwork+=fw; fl.conc_m3+=vol; fl.rebar_t+=rb/1000; fl.fw_m2+=fw;
      } else if (mat==='steel') {
        const wt=vol*STEEL_DENSITY;
        agg.steel.weight+=wt; agg.steel.weldKg+=wt*WELD_RATIO*1000;
        agg.steel.bolts+=BOLT_PER_MEMBER; fl.steel_t+=wt;
      } else if (mat==='timber') {
        agg.timber.vol+=vol; agg.timber.hardware+=vol*TIMBER_HW; fl.timber_m3+=vol;
      }
    }
    agg.byFloor.push(fl);
  }
  const c=agg.concrete, s=agg.steel, t=agg.timber;
  c.vol=r1(c.vol); c.cement=r1(c.cement/1000); c.sand=r1(c.sand);
  c.gravel=r1(c.gravel); c.water=r1(c.water/1000); c.rebar=r1(c.rebar/1000);
  c.formwork=r0(c.formwork);
  s.weight=r1(s.weight); s.weldKg=r0(s.weldKg); s.bolts=r0(s.bolts);
  t.vol=r1(t.vol); t.hardware=r0(t.hardware);
  agg.byFloor = agg.byFloor.map(f=>({
    ...f, conc_m3:r1(f.conc_m3), rebar_t:r1(f.rebar_t),
    fw_m2:r0(f.fw_m2), steel_t:r1(f.steel_t), timber_m3:r1(f.timber_m3),
  }));
  return agg;
}

function buildTasks(elements, startDate) {
  const floors=detectFloors(elements); const tasks=[]; let cur=new Date(startDate);
  function push(name,startD,days,workers,roles,equipment,phase,extra={}) {
    const end=addDays(startD,days-1);
    tasks.push({name,start:startD,end,days,workers,roles,equipment,phase,...extra});
    return addDays(end,1);
  }
  for (const pname of ['설계 및 인허가','가설공사']) {
    const f=FIXED[pname]; cur=push(pname,cur,f.days,f.workers,f.roles,f.equipment,f.phase);
  }
  const pierVol=elements.filter(e=>e.elementType==='IfcPier').reduce((s,e)=>s+elVol(e),0);
  const pierP=calcPhase(pierVol,'IfcPier','concrete');
  const ef=FIXED['토공사 및 기초굴착'];
  cur=push('토공사 및 기초굴착',cur,pierP?pierP.days:ef.days,ef.workers+(pierP?pierP.workers:0),ef.roles,ef.equipment,ef.phase);
  const foundVol=elements.filter(e=>['IfcColumn','IfcPier'].includes(e.elementType)).reduce((s,e)=>s+elVol(e),0)*1.5;
  const foundP=calcPhase(foundVol,'IfcColumn','concrete');
  const ff=FIXED['기초공사'];
  cur=push('기초공사',cur,foundP?foundP.days:ff.days,ff.workers+(foundP?foundP.workers:0),ff.roles,ff.equipment,ff.phase);

  if (!floors.length) {
    cur=push('골조공사',cur,30,12,'거푸집공·철근공·콘크리트공','펌프카 1대, 타워 크레인 1대','frame');
  } else {
    const fStarts=[],fDays=[],fRes=[];
    for (let i=0; i<floors.length; i++) {
      const lbl=floorLabel(i,floors), fEls=floors[i].elements;
      const domMat=(etypes)=>{
        const vols={};
        fEls.filter(e=>etypes.includes(e.elementType)).forEach(e=>{const m=classifyMat(e.material);vols[m]=(vols[m]||0)+elVol(e);});
        return Object.entries(vols).sort((a,b)=>b[1]-a[1])[0]?.[0]||'concrete';
      };
      const sumVol=(et)=>fEls.filter(e=>et.includes(e.elementType)).reduce((s,e)=>s+elVol(e),0);
      const frameP=calcPhase(sumVol(['IfcColumn','IfcBeam','IfcPier']),'IfcColumn',domMat(['IfcColumn','IfcBeam','IfcPier']));
      const slabP =calcPhase(sumVol(['IfcSlab']),'IfcSlab',domMat(['IfcSlab']));
      const wallP =calcPhase(sumVol(['IfcWall']),'IfcWall',domMat(['IfcWall']));
      fRes.push({lbl,frameP,slabP,wallP});
      fStarts.push(i===0 ? new Date(cur) : addDays(fStarts[i-1],Math.ceil(fDays[i-1]*OVERLAP)));
      fDays.push(frameP?frameP.days:1);
    }
    const allEnds=[];
    for (let i=0; i<fRes.length; i++) {
      const {lbl,frameP,slabP,wallP}=fRes[i], fs=fStarts[i]; let next=fs;
      if (frameP) {
        const spec=SPEC[`IfcColumn:${classifyMat(floors[i].elements.find(e=>e.elementType==='IfcColumn')?.material||'')}`]||SPEC_DEF;
        tasks.push({name:`${lbl} 골조공사`,start:fs,end:addDays(fs,frameP.days-1),days:frameP.days,workers:frameP.workers,roles:spec.roles,equipment:spec.equipment,phase:'frame',volume:frameP.volume});
        next=addDays(fs,frameP.days);
      }
      let se=next,we=next;
      if (slabP) {
        const spec=SPEC[`IfcSlab:${classifyMat(floors[i].elements.find(e=>e.elementType==='IfcSlab')?.material||'')}`]||SPEC_DEF;
        tasks.push({name:`${lbl} 슬래브 공사`,start:next,end:addDays(next,slabP.days-1),days:slabP.days,workers:slabP.workers,roles:spec.roles,equipment:spec.equipment,phase:'slab',volume:slabP.volume});
        se=addDays(next,slabP.days);
      }
      if (wallP) {
        const spec=SPEC[`IfcWall:${classifyMat(floors[i].elements.find(e=>e.elementType==='IfcWall')?.material||'')}`]||SPEC_DEF;
        tasks.push({name:`${lbl} 벽체공사`,start:next,end:addDays(next,wallP.days-1),days:wallP.days,workers:wallP.workers,roles:spec.roles,equipment:spec.equipment,phase:'wall',volume:wallP.volume});
        we=addDays(next,wallP.days);
      }
      allEnds.push(se>we?se:we);
    }
    cur=allEnds.length?allEnds.reduce((a,b)=>a>b?a:b):cur;
  }
  const finArea=elements.filter(e=>['IfcSlab','IfcWall'].includes(e.elementType)).reduce((s,e)=>{const [sx,sy]=elDims(e);return s+sx*sy;},0);
  const finDays=Math.max(21,Math.min(90,Math.ceil(finArea/30)));
  const fin=FIXED['마감공사'];
  cur=push('마감공사',cur,finDays,fin.workers,fin.roles,`${fin.equipment} (면적 ${r0(finArea)}m² 기준)`,fin.phase);
  const mepStart=addDays(tasks[tasks.length-1].start,Math.ceil(finDays*0.70));
  const mep=FIXED['설비 및 전기공사'];
  const mepEnd=addDays(mepStart,mep.days-1);
  tasks.push({name:'설비 및 전기공사',start:mepStart,end:mepEnd,days:mep.days,workers:mep.workers,roles:mep.roles,equipment:mep.equipment,phase:'mep'});
  const lastEnd=tasks[tasks.length-2].end>mepEnd?tasks[tasks.length-2].end:mepEnd;
  const cl=FIXED['검사 및 준공'];
  tasks.push({name:'검사 및 준공',start:addDays(lastEnd,1),end:addDays(lastEnd,cl.days),days:cl.days,workers:cl.workers,roles:cl.roles,equipment:cl.equipment,phase:'completion'});
  return tasks;
}

function computeWorkPlan(modelData) {
  if (!modelData?.length) return null;
  const relevant=modelData.filter(e=>['IfcColumn','IfcBeam','IfcSlab','IfcWall','IfcPier'].includes(e.elementType));
  if (!relevant.length) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  const tasks=buildTasks(relevant,today);
  if (!tasks.length) return null;
  const ps=tasks[0].start, pe=tasks[tasks.length-1].end;
  return { tasks, projectStart:ps, projectEnd:pe,
    totalDays:dateDiff(ps,pe)+1, peakWorkers:Math.max(...tasks.map(t=>t.workers)),
    floorCount:detectFloors(relevant).length, elementCount:relevant.length,
    materials:calcMaterials(relevant) };
}

// ═══════════════════════════════════════════════════════════════════════════
// FormulaTooltip  (StructuralDashboard 패턴 동일)
// ═══════════════════════════════════════════════════════════════════════════

function FormulaTooltip({ data }) {
  const [visible, setVisible] = useState(false);
  const [pinned,  setPinned]  = useState(false);
  const [rect,    setRect]    = useState(null);
  const btnRef = useRef(null);
  const tipRef = useRef(null);
  const show   = visible || pinned;

  const openAt = () => {
    if (btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setVisible(true);
  };

  useEffect(() => {
    if (!pinned) return;
    const close = e => {
      if (btnRef.current?.contains(e.target) || tipRef.current?.contains(e.target)) return;
      setPinned(false); setVisible(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pinned]);

  const tipStyle = rect ? {
    position:'fixed', top:rect.bottom+6,
    left:Math.min(rect.left-4, window.innerWidth-284), zIndex:9999, width:272,
  } : {};

  return (
    <>
      <button
        ref={btnRef}
        onMouseEnter={openAt}
        onMouseLeave={() => { if (!pinned) setVisible(false); }}
        onClick={() => { if (pinned){setPinned(false);setVisible(false);}else{openAt();setPinned(true);} }}
        title={data.title}
        style={{
          display:'inline-flex', alignItems:'center', justifyContent:'center',
          width:14, height:14, borderRadius:'50%', fontSize:9, fontWeight:700,
          lineHeight:1, userSelect:'none', cursor:'pointer', flexShrink:0,
          background:'#1b2236', border:'1px solid #2a3a5a', color:'#64748b',
          transition:'all .15s',
        }}
        onMouseOver={e=>{e.currentTarget.style.color='#60a5fa';e.currentTarget.style.borderColor='#3b82f6';}}
        onMouseOut={e=>{e.currentTarget.style.color='#64748b';e.currentTarget.style.borderColor='#2a3a5a';}}
      >?</button>

      {show && rect && (
        <div ref={tipRef} style={tipStyle}
          onMouseEnter={()=>setVisible(true)}
          onMouseLeave={()=>{if(!pinned)setVisible(false);}}
          className="bg-[#080c18] border border-[#1e2d48] rounded-xl shadow-2xl p-3 text-left"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-bold text-blue-400">{data.title}</span>
            {pinned && (
              <button onClick={()=>{setPinned(false);setVisible(false);}}
                className="text-gray-600 hover:text-gray-300 text-xs leading-none ml-2">✕</button>
            )}
          </div>
          <div className="bg-[#0d1220] border border-[#1b2a40] rounded-lg px-2.5 py-2 mb-2.5
                         font-mono text-[10px] text-emerald-300 whitespace-pre leading-relaxed">
            {data.formula}
          </div>
          <div className="flex flex-col gap-1 mb-2">
            {data.vars.map(({s,d})=>(
              <div key={s} className="flex gap-2 text-[10px] leading-snug">
                <span className="font-mono text-amber-300 shrink-0 w-[88px] truncate">{s}</span>
                <span className="text-gray-400">{d}</span>
              </div>
            ))}
          </div>
          {data.sub && (
            <div className="border-t border-[#1b2236] pt-1.5 text-[10px] text-gray-500 leading-snug">
              {data.sub}
            </div>
          )}
          {!pinned && <div className="mt-1.5 text-[9px] text-gray-600 text-right">click to pin</div>}
        </div>
      )}
    </>
  );
}

// ── 섹션 헤더 (타이틀 + 툴팁) ────────────────────────────────────────────
function SectionHeader({ title, tipData }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:700,
      color:'#f1f5f9', marginBottom:8, marginTop:14, paddingBottom:4, borderBottom:'1px solid #1a2a3a' }}>
      <span>{title}</span>
      {tipData && <FormulaTooltip data={tipData} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 뷰 컴포넌트
// ═══════════════════════════════════════════════════════════════════════════

function SummaryCards({ plan, t }) {
  return (
    <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
      {[
        { label:t('cardDuration'), value:`${plan.totalDays}일`,     color:'#60a5fa' },
        { label:t('cardFloors'),   value:`${plan.floorCount}개 층`, color:'#34d399' },
        { label:t('cardTasks'),    value:`${plan.tasks.length}개`,  color:'#f59e0b' },
        { label:t('cardPeak'),     value:`${plan.peakWorkers}명`,   color:'#c084fc' },
      ].map(c=>(
        <div key={c.label} style={{ background:'#1c2a3a', border:'1px solid #253347', borderRadius:12, padding:'12px 14px' }}>
          <p style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>{c.label}</p>
          <p style={{ fontSize:20, fontWeight:700, color:c.color }}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

function GanttChart({ plan, t }) {
  const { tasks, projectStart, totalDays, projectEnd } = plan;
  const today=new Date(); today.setHours(0,0,0,0);
  const NAME_W=160;
  const months=[];
  let m=new Date(projectStart); m.setDate(1);
  while (m<=projectEnd) {
    months.push({ label:`${m.getFullYear()}.${m.getMonth()+1}`, offset:Math.max(0,dateDiff(projectStart,m)) });
    m=new Date(m.getFullYear(),m.getMonth()+1,1);
  }
  const todayOff=dateDiff(projectStart,today);
  const showToday=todayOff>=0&&todayOff<=totalDays;
  return (
    <div style={{ overflowX:'auto', fontSize:11 }}>
      <div style={{ display:'flex', marginBottom:4, paddingLeft:NAME_W }}>
        <div style={{ position:'relative', flex:1, height:20, background:'#0d1b2a', borderRadius:4 }}>
          {months.map(mo=>(
            <span key={mo.label+mo.offset} style={{ position:'absolute', left:`${(mo.offset/totalDays)*100}%`,
              fontSize:10, color:'#475569', paddingLeft:3 }}>{mo.label}</span>
          ))}
        </div>
      </div>
      {tasks.map((task,i)=>{
        const left=(dateDiff(projectStart,task.start)/totalDays)*100;
        const width=Math.max(0.5,(task.days/totalDays)*100);
        const color=PHASE_COLOR[task.phase]||'#3b82f6';
        return (
          <div key={i} style={{ display:'flex', alignItems:'center', marginBottom:3, height:26 }}>
            <div style={{ width:NAME_W, minWidth:NAME_W, fontSize:11, color:'#94a3b8',
              paddingRight:8, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis', flexShrink:0 }}
              title={task.name}>{task.name}</div>
            <div style={{ flex:1, position:'relative', height:20, background:'#0d1b2a', borderRadius:3 }}>
              {showToday && <div style={{ position:'absolute', left:`${(todayOff/totalDays)*100}%`,
                top:0,bottom:0,width:1,background:'#ef4444',zIndex:2 }} />}
              <div title={`${fmtDate(task.start)} ~ ${fmtDate(task.end)} (${task.days}일, ${task.workers}명)`}
                style={{ position:'absolute', left:`${left}%`, width:`${width}%`, height:'100%',
                  borderRadius:3, background:color, opacity:0.85, display:'flex', alignItems:'center',
                  paddingLeft:4, overflow:'hidden', whiteSpace:'nowrap', fontSize:10, color:'#fff',
                  fontWeight:600, cursor:'default' }}>
                {width>5?`${task.days}일·${task.workers}명`:''}
              </div>
            </div>
          </div>
        );
      })}
      <div style={{ display:'flex', flexWrap:'wrap', gap:'6px 14px', marginTop:12, paddingLeft:NAME_W }}>
        {Object.entries(PHASE_LABEL_KO).map(([k,lbl])=>(
          <div key={k} style={{ display:'flex', alignItems:'center', gap:4 }}>
            <div style={{ width:10, height:10, borderRadius:2, background:PHASE_COLOR[k] }} />
            <span style={{ fontSize:10, color:'#64748b' }}>{lbl}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TaskTable({ plan, t }) {
  const th={ padding:'7px 10px', background:'#0d1b2a', color:'#64748b', fontSize:11,
    fontWeight:600, textAlign:'left', borderBottom:'1px solid #253347', whiteSpace:'nowrap' };
  const td=(ex={})=>({ padding:'6px 10px', fontSize:11, color:'#cbd5e1',
    borderBottom:'1px solid #1a2a3a', verticalAlign:'middle', ...ex });
  return (
    <div style={{ overflowX:'auto' }}>
      <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'fixed' }}>
        <colgroup>
          <col style={{width:30}}/><col style={{width:155}}/><col style={{width:88}}/>
          <col style={{width:88}}/><col style={{width:55}}/><col style={{width:50}}/>
          <col style={{width:165}}/><col/>
        </colgroup>
        <thead><tr>
          {[t('colNo'),t('colTask'),t('colStart'),t('colEnd'),t('colDays'),t('colWorkers'),t('colRoles'),t('colEquip')].map(h=>(
            <th key={h} style={th}>{h}</th>
          ))}
        </tr></thead>
        <tbody>{plan.tasks.map((task,i)=>(
          <tr key={i} style={{ background:i%2===0?'transparent':'#0d1b2a10' }}>
            <td style={td({color:'#475569'})}>{i+1}</td>
            <td style={td()}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <div style={{ width:8,height:8,borderRadius:2,background:PHASE_COLOR[task.phase],flexShrink:0 }}/>
                <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{task.name}</span>
              </div>
            </td>
            <td style={td({color:'#94a3b8',fontFamily:'monospace'})}>{fmtDate(task.start)}</td>
            <td style={td({color:'#94a3b8',fontFamily:'monospace'})}>{fmtDate(task.end)}</td>
            <td style={td({color:'#60a5fa',textAlign:'center'})}>{task.days}</td>
            <td style={td({color:'#c084fc',textAlign:'center',fontWeight:600})}>{task.workers}명</td>
            <td style={td({color:'#94a3b8',fontSize:10,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'})}>{task.roles}</td>
            <td style={td({color:'#64748b',fontSize:10})}>{task.equipment}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr style={{background:'#1c2a3a'}}>
          <td colSpan={4} style={{...td(),color:'#64748b',fontWeight:600}}>{t('total')}</td>
          <td style={td({color:'#60a5fa',fontWeight:700,textAlign:'center'})}>{plan.totalDays}일</td>
          <td style={td({color:'#c084fc',fontWeight:700,textAlign:'center'})}>{t('peak',{n:plan.peakWorkers})}</td>
          <td colSpan={2} style={td()}/>
        </tr></tfoot>
      </table>
    </div>
  );
}

function MaterialsView({ materials, t }) {
  const {concrete:c,steel:s,timber:tl,byFloor}=materials;
  const hasConcrete=c.vol>0, hasSteel=s.weight>0, hasTimber=tl.vol>0;

  // 툴팁 데이터 (t() 호출 결과로 구성)
  const tipDuration = {
    title:   t('tipDurationTitle'),
    formula: t('tipDurationFormula'),
    vars: [
      {s:t('tipDurationV1'), d:t('tipDurationD1')},
      {s:t('tipDurationV2'), d:t('tipDurationD2')},
      {s:t('tipDurationV3'), d:t('tipDurationD3')},
    ],
    sub: t('tipDurationSub'),
  };
  const tipRebar = {
    title:   t('tipRebarTitle'),
    formula: t('tipRebarFormula'),
    vars: [
      {s:t('tipRebarV1'), d:t('tipRebarD1')},
      {s:t('tipRebarV2'), d:t('tipRebarD2')},
      {s:t('tipRebarV3'), d:t('tipRebarD3')},
      {s:t('tipRebarV4'), d:t('tipRebarD4')},
    ],
    sub: t('tipRebarSub'),
  };
  const tipFw = {
    title:   t('tipFwTitle'),
    formula: t('tipFwFormula'),
    vars: [
      {s:t('tipFwV1'), d:t('tipFwD1')},
      {s:t('tipFwV2'), d:t('tipFwD2')},
    ],
    sub: t('tipFwSub'),
  };
  const tipOverlap = {
    title:   t('tipOverlapTitle'),
    formula: t('tipOverlapFormula'),
    vars: [{s:t('tipOverlapV1'), d:t('tipOverlapD1')}],
    sub: t('tipOverlapSub'),
  };

  const th={ padding:'6px 10px', background:'#0d1b2a', color:'#64748b', fontSize:11,
    fontWeight:600, textAlign:'left', borderBottom:'1px solid #253347' };
  const td1={ padding:'6px 10px', fontSize:11, color:'#94a3b8', borderBottom:'1px solid #1a2a3a' };
  const td2={ padding:'6px 10px', fontSize:12, color:'#f1f5f9', fontWeight:600, fontFamily:'monospace',
    borderBottom:'1px solid #1a2a3a', textAlign:'right' };
  const td3={ padding:'6px 10px', fontSize:10, color:'#475569', borderBottom:'1px solid #1a2a3a' };

  function MatRow({label, value, unit, note, color='#f1f5f9', tipData}) {
    return (
      <tr>
        <td style={td1}>
          <div style={{ display:'flex', alignItems:'center', gap:5 }}>
            <span>{label}</span>
            {tipData && <FormulaTooltip data={tipData} />}
          </div>
        </td>
        <td style={{...td2,color}}>{value.toLocaleString('ko-KR')}</td>
        <td style={{...td2,color:'#64748b',fontSize:11}}>{unit}</td>
        <td style={td3}>{note}</td>
      </tr>
    );
  }

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>

      {/* ── 좌측: 자재 요약 ──────────────────────────────────────────── */}
      <div>
        {/* 공기 산정 방법 안내 */}
        <SectionHeader title={t('basisNote')} tipData={tipDuration} />
        <p style={{ fontSize:10, color:'#475569', marginBottom:14, lineHeight:1.6 }}>
          물량(m³) ÷ 생산성(m³/인·일) × 안전계수 1.2 → 공기·인원 자동 결정
          &nbsp;&nbsp;<FormulaTooltip data={tipOverlap} />
          &nbsp;층별 중첩 시공 적용
        </p>

        {hasConcrete && (<>
          <SectionHeader title={t('secConcrete')} />
          <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:4 }}>
            <thead><tr>
              <th style={th}>자재</th>
              <th style={{...th,textAlign:'right'}}>수량</th>
              <th style={{...th,textAlign:'right'}}>단위</th>
              <th style={th}>{t('basisNote')}</th>
            </tr></thead>
            <tbody>
              <MatRow label={t('matConcrete')} value={c.vol}      unit="m³"  note="부재 부피 합산"  color="#60a5fa" />
              <MatRow label={t('matCement')}   value={c.cement}   unit="t"   note="350 kg/m³" />
              <MatRow label={t('matSand')}     value={c.sand}     unit="m³"  note="0.53 m³/m³" />
              <MatRow label={t('matGravel')}   value={c.gravel}   unit="m³"  note="0.60 m³/m³" />
              <MatRow label={t('matWater')}    value={c.water}    unit="m³"  note="175 L/m³" />
              <MatRow label={t('matRebar')}    value={c.rebar}    unit="t"   note="부재 유형별 배근율" color="#f59e0b" tipData={tipRebar} />
              <MatRow label={t('matFormwork')} value={c.formwork} unit="m²"  note="노출 면적 (재사용 전)" color="#34d399" tipData={tipFw} />
            </tbody>
          </table>
        </>)}

        {hasSteel && (<>
          <SectionHeader title={t('secSteel')} />
          <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:4 }}>
            <thead><tr>
              <th style={th}>자재</th><th style={{...th,textAlign:'right'}}>수량</th>
              <th style={{...th,textAlign:'right'}}>단위</th><th style={th}>{t('basisNote')}</th>
            </tr></thead>
            <tbody>
              <MatRow label={t('matSteel')} value={s.weight} unit="t"    note="부피×7.85 t/m³"  color="#f59e0b" />
              <MatRow label={t('matWeld')}  value={s.weldKg} unit="kg"   note="철골 중량의 2%" />
              <MatRow label={t('matBolts')} value={s.bolts}  unit="세트" note="부재당 4세트 추정" />
            </tbody>
          </table>
        </>)}

        {hasTimber && (<>
          <SectionHeader title={t('secTimber')} />
          <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:4 }}>
            <thead><tr>
              <th style={th}>자재</th><th style={{...th,textAlign:'right'}}>수량</th>
              <th style={{...th,textAlign:'right'}}>단위</th><th style={th}>{t('basisNote')}</th>
            </tr></thead>
            <tbody>
              <MatRow label={t('matTimber')}   value={tl.vol}      unit="m³" note="부재 부피 합산"  color="#a78bfa" />
              <MatRow label={t('matHardware')} value={tl.hardware} unit="kg" note="9 kg/m³" />
            </tbody>
          </table>
        </>)}

        {!hasConcrete && !hasSteel && !hasTimber && (
          <p style={{ color:'#475569', fontSize:12, marginTop:20 }}>{t('noMatInfo')}</p>
        )}
      </div>

      {/* ── 우측: 층별 집계 ──────────────────────────────────────────── */}
      <div>
        <SectionHeader title={t('secFloorBreakdown')} />
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead><tr>
              <th style={th}>{t('flColFloor')}</th>
              {hasConcrete && <th style={{...th,textAlign:'right'}}>{t('flColConc')}</th>}
              {hasConcrete && <th style={{...th,textAlign:'right'}}>{t('flColRebar')}</th>}
              {hasConcrete && <th style={{...th,textAlign:'right'}}>{t('flColFw')}</th>}
              {hasSteel    && <th style={{...th,textAlign:'right'}}>{t('flColSteel')}</th>}
              {hasTimber   && <th style={{...th,textAlign:'right'}}>{t('flColTimber')}</th>}
            </tr></thead>
            <tbody>{byFloor.map((f,i)=>(
              <tr key={f.label} style={{ background:i%2===0?'transparent':'#0d1b2a10' }}>
                <td style={{...td1,color:'#60a5fa',fontWeight:600}}>{f.label}</td>
                {hasConcrete && <td style={{...td2,fontSize:11}}>{f.conc_m3||'-'}</td>}
                {hasConcrete && <td style={{...td2,fontSize:11,color:'#f59e0b'}}>{f.rebar_t||'-'}</td>}
                {hasConcrete && <td style={{...td2,fontSize:11,color:'#34d399'}}>{f.fw_m2||'-'}</td>}
                {hasSteel    && <td style={{...td2,fontSize:11,color:'#f59e0b'}}>{f.steel_t||'-'}</td>}
                {hasTimber   && <td style={{...td2,fontSize:11,color:'#a78bfa'}}>{f.timber_m3||'-'}</td>}
              </tr>
            ))}</tbody>
            <tfoot><tr style={{background:'#1c2a3a'}}>
              <td style={{...td1,fontWeight:700,color:'#f1f5f9'}}>{t('total')}</td>
              {hasConcrete && <td style={{...td2,color:'#60a5fa'}}>{c.vol}</td>}
              {hasConcrete && <td style={{...td2,color:'#f59e0b'}}>{c.rebar}</td>}
              {hasConcrete && <td style={{...td2,color:'#34d399'}}>{c.formwork}</td>}
              {hasSteel    && <td style={{...td2,color:'#f59e0b'}}>{s.weight}</td>}
              {hasTimber   && <td style={{...td2,color:'#a78bfa'}}>{tl.vol}</td>}
            </tr></tfoot>
          </table>
        </div>

        {hasConcrete && (
          <div style={{ marginTop:20, padding:'14px 16px', background:'#0d1b2a',
            border:'1px solid #1a2a3a', borderRadius:10 }}>
            <p style={{ fontSize:11, color:'#64748b', marginBottom:10 }}>주요 자재 비중</p>
            {[
              {label:`콘크리트 ${c.vol} m³`,   val:c.vol,           color:'#3b82f6', max:c.vol},
              {label:`철근 ${c.rebar} t`,       val:c.rebar*5,       color:'#f59e0b', max:c.vol},
              {label:`시멘트 ${c.cement} t`,    val:c.cement*3,      color:'#94a3b8', max:c.vol},
              {label:`거푸집 ${c.formwork} m²`, val:c.formwork*0.15, color:'#34d399', max:c.vol},
            ].map(row=>(
              <div key={row.label} style={{marginBottom:6}}>
                <span style={{fontSize:10,color:'#64748b'}}>{row.label}</span>
                <div style={{height:5,borderRadius:3,background:'#1a2a3a',overflow:'hidden',marginTop:2}}>
                  <div style={{height:'100%',borderRadius:3,background:row.color,
                    width:`${Math.min(100,(row.val/row.max)*100)}%`}}/>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 내보내기
// ═══════════════════════════════════════════════════════════════════════════

function exportCSV(plan, projectName) {
  const {tasks, materials:mat} = plan;
  const c=mat.concrete, s=mat.steel, tl=mat.timber;
  const taskRows=tasks.map((t,i)=>[i+1,`"${t.name}"`,fmtDate(t.start),fmtDate(t.end),t.days,t.workers,`"${t.roles}"`,`"${t.equipment}"`].join(','));
  const matRows=[
    [],['"[자재 소요량]"'],
    ['"자재명"','"수량"','"단위"','"산정 기준"'],
    ...(c.vol>0?[
      ['"콘크리트"',c.vol,'"m³"','"부재 부피 합산"'],['"시멘트"',c.cement,'"t"','"350 kg/m³"'],
      ['"모래"',c.sand,'"m³"','"0.53 m³/m³"'],['"자갈"',c.gravel,'"m³"','"0.60 m³/m³"'],
      ['"혼합수"',c.water,'"m³"','"175 L/m³"'],['"철근"',c.rebar,'"t"','"부재 유형별 배근율"'],
      ['"거푸집"',c.formwork,'"m²"','"노출 면적"'],
    ]:[]),
    ...(s.weight>0?[['"철골"',s.weight,'"t"','"부피×7.85"'],['"용접봉"',s.weldKg,'"kg"','"2%"'],['"볼트"',s.bolts,'"세트"','"부재당 4"']]:[]),
    ...(tl.vol>0?[['"목재"',tl.vol,'"m³"','"합산"'],['"철물"',tl.hardware,'"kg"','"9 kg/m³"']]:[]),
  ];
  const floorRows=[
    [],['"[층별 집계]"'],
    ['"층"','"콘크리트(m³)"','"철근(t)"','"거푸집(m²)"','"철골(t)"','"목재(m³)"'],
    ...mat.byFloor.map(f=>[`"${f.label}"`,f.conc_m3,f.rebar_t,f.fw_m2,f.steel_t,f.timber_m3]),
  ];
  const csv='﻿'+[
    ['#','공정명','착공일','준공일','공기(일)','인원','역할','주요 장비'].join(','),
    ...taskRows, ...matRows.map(r=>r.join(',')), ...floorRows.map(r=>r.join(',')),
  ].join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
  a.download=`${projectName}_작업계획.csv`; a.click(); URL.revokeObjectURL(a.href);
}

function printPlan(plan, projectName) {
  const {tasks,materials:mat,totalDays,peakWorkers,floorCount}=plan;
  const c=mat.concrete,s=mat.steel,tl=mat.timber;
  const taskHtml=tasks.map((t,i)=>`<tr><td>${i+1}</td><td>${t.name}</td><td>${fmtDate(t.start)}</td><td>${fmtDate(t.end)}</td><td style="text-align:center">${t.days}</td><td style="text-align:center">${t.workers}명</td><td>${t.roles}</td><td>${t.equipment}</td></tr>`).join('');
  const matHtml=[
    ...(c.vol>0?[`<tr><td>콘크리트</td><td>${c.vol}</td><td>m³</td><td>부재 부피 합산</td></tr>`,`<tr><td>시멘트</td><td>${c.cement}</td><td>t</td><td>350 kg/m³</td></tr>`,`<tr><td>모래</td><td>${c.sand}</td><td>m³</td><td>0.53 m³/m³</td></tr>`,`<tr><td>자갈</td><td>${c.gravel}</td><td>m³</td><td>0.60 m³/m³</td></tr>`,`<tr><td>혼합수</td><td>${c.water}</td><td>m³</td><td>175 L/m³</td></tr>`,`<tr><td>철근</td><td>${c.rebar}</td><td>t</td><td>부재 유형별 배근율</td></tr>`,`<tr><td>거푸집</td><td>${c.formwork}</td><td>m²</td><td>노출 면적</td></tr>`]:[]),
    ...(s.weight>0?[`<tr><td>철골</td><td>${s.weight}</td><td>t</td><td>부피×7.85</td></tr>`,`<tr><td>용접봉</td><td>${s.weldKg}</td><td>kg</td><td>2%</td></tr>`,`<tr><td>볼트</td><td>${s.bolts}</td><td>세트</td><td>부재당 4</td></tr>`]:[]),
    ...(tl.vol>0?[`<tr><td>목재</td><td>${tl.vol}</td><td>m³</td><td>합산</td></tr>`,`<tr><td>철물</td><td>${tl.hardware}</td><td>kg</td><td>9 kg/m³</td></tr>`]:[]),
  ].join('');
  const floorHtml=mat.byFloor.map(f=>`<tr><td>${f.label}</td><td>${f.conc_m3||'-'}</td><td>${f.rebar_t||'-'}</td><td>${f.fw_m2||'-'}</td><td>${f.steel_t||'-'}</td><td>${f.timber_m3||'-'}</td></tr>`).join('');
  const w=window.open('','_blank','width=1100,height=800');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${projectName} — 작업계획서</title>
  <style>body{font-family:'Malgun Gothic',Arial,sans-serif;font-size:10pt;margin:15px}h2{font-size:14pt;margin-bottom:4px}h3{font-size:11pt;margin:14px 0 6px;color:#1e40af}.meta{color:#555;font-size:9pt;margin-bottom:14px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}.card{border:1px solid #ccc;border-radius:6px;padding:8px 12px}.card .v{font-size:14pt;font-weight:bold;color:#1e40af}.card .l{font-size:8pt;color:#888}table{border-collapse:collapse;width:100%}th{background:#1e3a5f;color:#fff;padding:5px 8px;font-size:9pt;text-align:left}td{padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:9pt}tr:nth-child(even){background:#f8fafc}tfoot td{background:#f0f4ff;font-weight:bold}@page{size:A4 landscape;margin:12mm}</style></head><body>
  <h2>작업계획서 — ${projectName}</h2>
  <p class="meta">출력일: ${new Date().toLocaleDateString('ko-KR')} │ 총 공기 ${totalDays}일 │ ${floorCount}개 층 │ ${tasks.length}개 공정 │ 최대 ${peakWorkers}명</p>
  <div class="summary"><div class="card"><div class="l">총 공기</div><div class="v">${totalDays}일</div></div><div class="card"><div class="l">층수</div><div class="v">${floorCount}층</div></div><div class="card"><div class="l">공정수</div><div class="v">${tasks.length}개</div></div><div class="card"><div class="l">최대 인원</div><div class="v">${peakWorkers}명</div></div></div>
  <h3>공정표</h3><table><thead><tr><th>#</th><th>공정명</th><th>착공일</th><th>준공일</th><th>공기(일)</th><th>인원</th><th>역할</th><th>주요 장비</th></tr></thead><tbody>${taskHtml}</tbody><tfoot><tr><td colspan="4">합계</td><td style="text-align:center">${totalDays}일</td><td style="text-align:center">최대 ${peakWorkers}명</td><td colspan="2"></td></tr></tfoot></table>
  ${matHtml?`<h3>자재 소요량</h3><table style="width:48%;display:inline-table;margin-right:2%;vertical-align:top"><thead><tr><th>자재</th><th>수량</th><th>단위</th><th>기준</th></tr></thead><tbody>${matHtml}</tbody></table><table style="width:48%;display:inline-table;vertical-align:top"><thead><tr><th>층</th><th>콘크리트</th><th>철근</th><th>거푸집</th><th>철골</th><th>목재</th></tr></thead><tbody>${floorHtml}</tbody></table>`:''}
  <script>window.onload=()=>{window.print();window.close();}</script></body></html>`);
  w.document.close();
}

// ═══════════════════════════════════════════════════════════════════════════
// 메인
// ═══════════════════════════════════════════════════════════════════════════

export default function WorkPlanDashboard({ selectedProject, modelData }) {
  const t    = useT('workPlan');
  const [view, setView] = useState('gantt');
  const plan = useMemo(() => computeWorkPlan(modelData), [modelData]);
  const projectName = selectedProject?.projectName || t('title');

  if (!plan) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center',
      justifyContent:'center', height:'100%', gap:12 }}>
      <div style={{fontSize:40}}>📋</div>
      <p style={{color:'#475569',fontSize:14}}>{t('noDataDesc')}</p>
      <p style={{color:'#334155',fontSize:12,textAlign:'center',whiteSpace:'pre-line'}}>{t('noDataHint')}</p>
    </div>
  );

  const VIEWS = [['gantt',t('tabGantt')],['table',t('tabTable')],['materials',t('tabMaterials')]];

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', padding:'16px 20px',
      overflowY:'auto', gap:14, background:'#080f1a', color:'#e2e8f0', fontFamily:'inherit' }}>

      {/* 헤더 */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
        <div>
          <h2 style={{ fontSize:15, fontWeight:700, color:'#f1f5f9', margin:0 }}>
            {t('title')} — {projectName}
          </h2>
          <p style={{ fontSize:11, color:'#475569', marginTop:2 }}>
            {t('subtitle',{n:plan.elementCount})} · {fmtDate(plan.projectStart)} ~ {fmtDate(plan.projectEnd)}
          </p>
        </div>
        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
          <div style={{ display:'flex', background:'#0d1b2a', border:'1px solid #253347', borderRadius:8, padding:2 }}>
            {VIEWS.map(([v,lbl])=>(
              <button key={v} onClick={()=>setView(v.trim())} style={{
                padding:'4px 12px', borderRadius:6, fontSize:11, fontWeight:600,
                border:'none', cursor:'pointer', transition:'all .15s',
                background:view===v?'#1e3a5f':'transparent',
                color:view===v?'#60a5fa':'#64748b',
              }}>{lbl}</button>
            ))}
          </div>
          <button onClick={()=>exportCSV(plan,projectName)} style={{ padding:'5px 12px', borderRadius:8,
            fontSize:11, fontWeight:600, background:'#1c2a3a', border:'1px solid #253347', color:'#4ade80', cursor:'pointer' }}>
            {t('btnCsv')}
          </button>
          <button onClick={()=>printPlan(plan,projectName)} style={{ padding:'5px 12px', borderRadius:8,
            fontSize:11, fontWeight:600, background:'#1c2a3a', border:'1px solid #253347', color:'#60a5fa', cursor:'pointer' }}>
            {t('btnPrint')}
          </button>
        </div>
      </div>

      <SummaryCards plan={plan} t={t} />

      <div style={{ background:'#0d1b2a', border:'1px solid #1a2a3a', borderRadius:14, padding:'16px 18px', flex:1 }}>
        {view==='gantt'     && <GanttChart    plan={plan} t={t} />}
        {view==='table'     && <TaskTable     plan={plan} t={t} />}
        {view==='materials' && <MaterialsView materials={plan.materials} t={t} />}
      </div>
    </div>
  );
}

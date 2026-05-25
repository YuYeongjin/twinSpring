import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useT, useLanguage } from '../../../i18n/LanguageContext';

// ── Marching Squares ──────────────────────────────────────────────────────────
const MS_EDGES = [
  [],[[3,2]],[[2,1]],[[3,1]],[[1,0]],[[3,0],[2,1]],[[2,0]],[[3,0]],
  [[0,3]],[[0,2]],[[0,1],[3,2]],[[0,1]],[[1,3]],[[1,2]],[[2,3]],[],
];
function edgePt(x,y,e,v00,v10,v01,v11,thr){
  const l=(a,b)=>a===b?.5:Math.max(0,Math.min(1,(thr-a)/(b-a)));
  if(e===0)return[x+l(v00,v10),y];
  if(e===1)return[x+1,y+l(v10,v11)];
  if(e===2)return[x+l(v01,v11),y+1];
  return[x,y+l(v00,v01)];
}
function marchingSquares(grid,threshold){
  const R=grid.length,C=grid[0].length,segs=[];
  for(let y=0;y<R-1;y++)for(let x=0;x<C-1;x++){
    const v00=grid[y][x],v10=grid[y][x+1],v01=grid[y+1][x],v11=grid[y+1][x+1];
    const idx=((v00>=threshold)?8:0)|((v10>=threshold)?4:0)|((v11>=threshold)?2:0)|((v01>=threshold)?1:0);
    for(const[e1,e2]of MS_EDGES[idx])
      segs.push([edgePt(x,y,e1,v00,v10,v01,v11,threshold),edgePt(x,y,e2,v00,v10,v01,v11,threshold)]);
  }
  return segs;
}

// ── Segment chaining (O(n) via hash map) ─────────────────────────────────────
function chainSegments(segs){
  if(!segs.length)return[];
  const eps=0.05,key=p=>`${Math.round(p[0]/eps)},${Math.round(p[1]/eps)}`;
  const adj=new Map();
  for(let i=0;i<segs.length;i++){
    const k1=key(segs[i][0]),k2=key(segs[i][1]);
    if(!adj.has(k1))adj.set(k1,[]);
    if(!adj.has(k2))adj.set(k2,[]);
    adj.get(k1).push({i,e:0});adj.get(k2).push({i,e:1});
  }
  const used=new Uint8Array(segs.length),chains=[];
  for(let s=0;s<segs.length;s++){
    if(used[s])continue;
    used[s]=1;
    const chain=[segs[s][0],segs[s][1]];
    for(let fwd=1;fwd>=0;fwd--){
      let ext=true;
      while(ext){
        ext=false;
        const tip=fwd?chain[chain.length-1]:chain[0];
        for(const{i,e}of(adj.get(key(tip))||[])){
          if(used[i])continue;
          used[i]=1;
          const pt=e===0?segs[i][1]:segs[i][0];
          fwd?chain.push(pt):chain.unshift(pt);
          ext=true;break;
        }
      }
    }
    if(chain.length>=3)chains.push(chain);
  }
  return chains;
}

// ── Gaussian blur (separable) ─────────────────────────────────────────────────
function gaussianBlur(grid,sigma=2.5){
  const R=grid.length,C=grid[0].length;
  const rad=Math.ceil(sigma*2.5),size=2*rad+1;
  const k=new Float32Array(size);
  let sum=0;
  for(let i=0;i<size;i++){const x=i-rad;k[i]=Math.exp(-(x*x)/(2*sigma*sigma));sum+=k[i];}
  for(let i=0;i<size;i++)k[i]/=sum;
  const tmp=Array.from({length:R},()=>new Float32Array(C));
  for(let y=0;y<R;y++)for(let x=0;x<C;x++){
    let v=0;for(let d=-rad;d<=rad;d++)v+=grid[y][Math.max(0,Math.min(C-1,x+d))]*k[d+rad];
    tmp[y][x]=v;
  }
  const out=Array.from({length:R},()=>new Float32Array(C));
  for(let y=0;y<R;y++)for(let x=0;x<C;x++){
    let v=0;for(let d=-rad;d<=rad;d++)v+=tmp[Math.max(0,Math.min(R-1,y+d))][x]*k[d+rad];
    out[y][x]=v;
  }
  return out;
}

// ── Hillshading ───────────────────────────────────────────────────────────────
function hillshade(grid,az=315,al=45){
  const R=grid.length,C=grid[0].length;
  const azR=az*Math.PI/180,alR=al*Math.PI/180;
  const lx=Math.cos(alR)*Math.cos(azR),ly=Math.cos(alR)*Math.sin(azR),lz=Math.sin(alR);
  const sc=10;
  return grid.map((row,y)=>row.map((_,x)=>{
    const dx=((x<C-1?grid[y][x+1]:grid[y][x])-(x>0?grid[y][x-1]:grid[y][x]))*sc;
    const dy=((y<R-1?grid[y+1][x]:grid[y][x])-(y>0?grid[y-1][x]:grid[y][x]))*sc;
    const len=Math.sqrt(dx*dx+dy*dy+1);
    return Math.max(0,Math.min(1,(-dx*lx-dy*ly+lz)/len));
  }));
}

// ── Hypsometric color ─────────────────────────────────────────────────────────
const STOPS=[
  [0.00,[20,100,50]],[0.12,[46,140,87]],[0.28,[95,180,110]],
  [0.42,[190,225,100]],[0.55,[235,205,60]],[0.68,[210,135,40]],
  [0.82,[165,78,25]],[0.92,[118,42,18]],[1.00,[210,205,195]],
];
function lerpColor(t){
  for(let i=1;i<STOPS.length;i++){
    if(t<=STOPS[i][0]){
      const[t0,c0]=STOPS[i-1],[t1,c1]=STOPS[i],f=(t-t0)/(t1-t0);
      return[c0[0]+(c1[0]-c0[0])*f|0,c0[1]+(c1[1]-c0[1])*f|0,c0[2]+(c1[2]-c0[2])*f|0];
    }
  }
  return[210,205,195];
}
function elevHex(t){const[r,g,b]=lerpColor(t);return'#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');}

// ── Image → elevation grid ────────────────────────────────────────────────────
function imageToGrid(data,W,H,step){
  const cols=Math.floor(W/step),rows=Math.floor(H/step);
  const grid=Array.from({length:rows},(_,r)=>{
    const row=new Float32Array(cols);
    for(let c=0;c<cols;c++){
      const i=(Math.floor(r*step)*W+Math.floor(c*step))*4;
      row[c]=(0.299*data[i]+0.587*data[i+1]+0.114*data[i+2])/255;
    }
    return row;
  });
  return{grid,cols,rows};
}

// ── Smooth polyline on canvas ─────────────────────────────────────────────────
function drawChain(ctx,chain,sx,sy){
  if(chain.length<2)return;
  ctx.beginPath();ctx.moveTo(chain[0][0]*sx,chain[0][1]*sy);
  for(let i=1;i<chain.length-1;i++){
    const mx=(chain[i][0]+chain[i+1][0])/2*sx,my=(chain[i][1]+chain[i+1][1])/2*sy;
    ctx.quadraticCurveTo(chain[i][0]*sx,chain[i][1]*sy,mx,my);
  }
  ctx.lineTo(chain[chain.length-1][0]*sx,chain[chain.length-1][1]*sy);
  ctx.stroke();
}

// ── Sobel edge detection ──────────────────────────────────────────────────────
function sobelEdge(grid){
  const R=grid.length,C=grid[0].length;
  const out=Array.from({length:R},()=>new Float32Array(C));
  for(let y=1;y<R-1;y++)for(let x=1;x<C-1;x++){
    const gx=(-grid[y-1][x-1]+grid[y-1][x+1]
              -2*grid[y][x-1]+2*grid[y][x+1]
              -grid[y+1][x-1]+grid[y+1][x+1]);
    const gy=(-grid[y-1][x-1]-2*grid[y-1][x]-grid[y-1][x+1]
              +grid[y+1][x-1]+2*grid[y+1][x]+grid[y+1][x+1]);
    out[y][x]=Math.min(1,Math.sqrt(gx*gx+gy*gy)*3.5);
  }
  return out;
}

// ── 도면 선 변환 (엣지 맵 → 평면 BIM 폴리라인) ────────────────────────────
function buildDrawingLines(edgeGrid,cols,rows,scaleW,scaleH,threshold,maxN){
  const sx=scaleW/cols,sy=scaleH/rows,lines=[];
  const segs=marchingSquares(edgeGrid,threshold);
  const chains=chainSegments(segs);
  for(const chain of chains){
    if(lines.length>=maxN)break;
    if(chain.length<2)continue;
    const pts=chain.map(([cx,cy])=>[
      +((cx*sx-scaleW/2).toFixed(3)),
      0,
      +((cy*sy-scaleH/2).toFixed(3)),
    ]);
    const first=pts[0],last=pts[pts.length-1];
    lines.push({
      startX:first[0],startY:0,startZ:first[2],
      endX:last[0],endY:0,endZ:last[2],
      color:'#93c5fd',
      lineWidth:1,
      pointsJson:JSON.stringify(pts),
      closed:false,shapeHeight:0,
    });
  }
  return lines;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DroneAnalysisModal({onClose,onConvertToBIM,onProjectSelect}){
  const t = useT('drone');
  const { lang } = useLanguage();

  const[file,setFile]=useState(null);
  const[imgUrl,setImgUrl]=useState(null);
  const[drag,setDrag]=useState(false);
  const fileRef=useRef(null);

  const[scaleW,setScaleW]=useState(100);
  const[scaleH,setScaleH]=useState(100);
  const[elevMin,setElevMin]=useState(0);
  const[elevMax,setElevMax]=useState(20);
  const[refElev,setRefElev]=useState(10);
  const[contourInt,setContourInt]=useState(2);
  const[step,setStep]=useState(4);
  const[showPhoto,setShowPhoto]=useState(false);

  const[result,setResult]=useState(null);
  const[busy,setBusy]=useState(false);
  const[tab,setTab]=useState('upload');

  const[cvName,setCvName]=useState('');
  const[cvThreshold,setCvThreshold]=useState(0.15); // Sobel 엣지 감도 (낮을수록 더 많은 선)
  const[cvBusy,setCvBusy]=useState(false);
  const[cvDone,setCvDone]=useState(null);

  const canvasRef=useRef(null);
  const hidRef=useRef(null);

  const loadFile=useCallback(f=>{
    if(!f)return;
    if(!f.name.match(/\.(jpe?g|png|tiff?|bmp|webp)$/i)){alert(t('imageMustBeImage'));return;}
    setFile(f);setResult(null);setCvDone(null);setTab('upload');
    setImgUrl(URL.createObjectURL(f));
    setCvName(f.name.replace(/\.[^.]+$/,''));
  },[lang]);

  const analyse=useCallback(()=>{
    if(!imgUrl||!hidRef.current)return;
    setBusy(true);
    const img=new Image();
    img.onload=()=>{
      const hc=hidRef.current;hc.width=img.naturalWidth;hc.height=img.naturalHeight;
      const ctx=hc.getContext('2d');ctx.drawImage(img,0,0);
      const d=ctx.getImageData(0,0,img.naturalWidth,img.naturalHeight).data;
      const{grid:raw,cols,rows}=imageToGrid(d,img.naturalWidth,img.naturalHeight,step);
      const smooth=gaussianBlur(raw,2.5);
      const shade=hillshade(smooth);
      const elevRange=elevMax-elevMin;

      const levels=[];
      for(let e=elevMin;e<=elevMax+0.001;e+=contourInt){
        const t=Math.max(0,Math.min(1,(e-elevMin)/Math.max(0.001,elevRange)));
        const major=Math.abs(Math.round(e/(contourInt*5))*contourInt*5-e)<contourInt*0.05;
        levels.push({elev:e,t,major});
      }
      const contours=levels.map(({elev,t,major})=>{
        const segs=marchingSquares(smooth,t);
        return{segs,chains:chainSegments(segs),t,elev,major};
      });
      const refT=Math.max(0,Math.min(1,(refElev-elevMin)/Math.max(0.001,elevRange)));
      const refChains=chainSegments(marchingSquares(smooth,refT));

      let cut=0,fill=0;
      const pa=(scaleW/cols)*(scaleH/rows);
      for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
        const diff=smooth[r][c]*elevRange+elevMin-refElev;
        if(diff>0)cut+=diff*pa;else fill-=diff*pa;
      }
      setResult({contours,refChains,smooth,shade,cols,rows,img,refT,raw,
        stats:{cut:Math.round(cut),fill:Math.round(fill),net:Math.round(cut-fill),
               area:Math.round(scaleW*scaleH),cols,rows,pa:pa.toFixed(4)}});
      setTab('result');setBusy(false);
    };
    img.onerror=()=>{alert(t('imageLoadFailed'));setBusy(false);};
    img.src=imgUrl;
  },[imgUrl,step,elevMin,elevMax,refElev,contourInt,scaleW,scaleH,lang]);

  // canvas render
  useEffect(()=>{
    if(tab!=='result'||!result||!canvasRef.current)return;
    const{contours,refChains,smooth,shade,cols,rows,img,refT}=result;
    const cv=canvasRef.current,cw=cv.width,ch=cv.height;
    const ctx=cv.getContext('2d');
    ctx.clearRect(0,0,cw,ch);
    const sx=cw/cols,sy=ch/rows;

    if(showPhoto&&img){
      ctx.globalAlpha=0.55;ctx.drawImage(img,0,0,cw,ch);ctx.globalAlpha=1;
    } else {
      // pixel-level hypsometric + hillshade
      const id=ctx.createImageData(cw,ch);
      for(let py=0;py<ch;py++)for(let px=0;px<cw;px++){
        const gc=Math.min(cols-1,px/sx|0),gr=Math.min(rows-1,py/sy|0);
        const t=smooth[gr][gc],s=0.35+0.65*shade[gr][gc];
        const[r,g,b]=lerpColor(t);
        const i=(py*cw+px)*4;
        id.data[i]=r*s;id.data[i+1]=g*s;id.data[i+2]=b*s;id.data[i+3]=255;
      }
      ctx.putImageData(id,0,0);
    }

    // cut/fill tint
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const t=smooth[r][c];
      if(t>refT+0.01){ctx.fillStyle='rgba(239,68,68,0.15)';ctx.fillRect(c*sx,r*sy,sx+1,sy+1);}
      else if(t<refT-0.01){ctx.fillStyle='rgba(34,197,94,0.1)';ctx.fillRect(c*sx,r*sy,sx+1,sy+1);}
    }

    // minor contours
    ctx.save();ctx.globalAlpha=0.5;
    for(const{chains,t,major}of contours){
      if(major)continue;
      ctx.strokeStyle=elevHex(t);ctx.lineWidth=0.7;
      for(const ch of chains)drawChain(ctx,ch,sx,sy);
    }ctx.restore();

    // major contours + labels
    ctx.save();ctx.globalAlpha=0.92;
    for(const{chains,t,major,elev}of contours){
      if(!major)continue;
      ctx.strokeStyle=elevHex(t);ctx.lineWidth=2.0;
      for(const ch of chains)drawChain(ctx,ch,sx,sy);
      if(chains[0]?.length>4){
        const mid=chains[0][chains[0].length>>1];
        ctx.save();ctx.globalAlpha=1;ctx.font='bold 10px monospace';
        ctx.fillStyle='#fff';ctx.shadowColor='#000';ctx.shadowBlur=4;
        ctx.fillText(`${elev.toFixed(0)}m`,mid[0]*sx+3,mid[1]*sy-3);
        ctx.restore();
      }
    }ctx.restore();

    // reference line
    ctx.save();ctx.strokeStyle='#facc15';ctx.lineWidth=2.2;
    ctx.setLineDash([10,5]);ctx.globalAlpha=0.95;
    for(const ch of refChains)drawChain(ctx,ch,sx,sy);
    ctx.restore();

    // right color bar
    ctx.save();
    const bh=ch*0.45,by=(ch-bh)/2,bx=cw-14;
    const grad=ctx.createLinearGradient(0,by+bh,0,by);
    STOPS.forEach(([t,[r,g,b]])=>grad.addColorStop(t,`rgb(${r},${g},${b})`));
    ctx.fillStyle=grad;ctx.fillRect(bx,by,10,bh);
    ctx.strokeStyle='rgba(255,255,255,0.25)';ctx.lineWidth=1;ctx.strokeRect(bx,by,10,bh);
    ctx.font='9px monospace';ctx.fillStyle='#e2e8f0';ctx.textAlign='right';
    ctx.shadowColor='#000';ctx.shadowBlur=3;
    ctx.fillText(`${elevMax}m`,bx-3,by+5);ctx.fillText(`${elevMin}m`,bx-3,by+bh+5);
    ctx.restore();

    // scale bar
    const bm=Math.pow(10,Math.floor(Math.log10(scaleW/4)));
    const bp=(bm/scaleW)*cw;
    ctx.save();ctx.fillStyle='#fff';
    ctx.fillRect(16,ch-20,bp,5);ctx.fillRect(16,ch-26,2,12);ctx.fillRect(16+bp,ch-26,2,12);
    ctx.font='bold 11px monospace';ctx.fillStyle='#e2e8f0';
    ctx.shadowColor='#000';ctx.shadowBlur=4;ctx.fillText(`${bm}m`,16,ch-30);
    ctx.restore();

    // N arrow
    ctx.save();ctx.translate(cw-26,30);
    ctx.beginPath();ctx.moveTo(0,-15);ctx.lineTo(5,8);ctx.lineTo(0,3);ctx.lineTo(-5,8);ctx.closePath();
    ctx.fillStyle='#60a5fa';ctx.fill();
    ctx.font='bold 12px sans-serif';ctx.fillStyle='#93c5fd';ctx.textAlign='center';
    ctx.shadowColor='#000';ctx.shadowBlur=4;ctx.fillText('N',0,-20);
    ctx.restore();

    // legend box
    ctx.save();
    ctx.fillStyle='rgba(8,17,26,0.82)';ctx.strokeStyle='rgba(255,255,255,0.12)';ctx.lineWidth=1;
    ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(10,10,120,68,6);else ctx.rect(10,10,120,68);
    ctx.fill();ctx.stroke();
    ctx.font='10px monospace';
    const cutLegend = t('cutLegend');
    const fillLegend = t('fillLegend');
    const refLineTxt = t('refLine', { n: refElev });
    ctx.fillStyle='rgba(239,68,68,0.85)';ctx.fillRect(16,20,13,10);
    ctx.fillStyle='#e2e8f0';ctx.fillText(cutLegend,33,29);
    ctx.fillStyle='rgba(34,197,94,0.85)';ctx.fillRect(16,36,13,10);
    ctx.fillStyle='#e2e8f0';ctx.fillText(fillLegend,33,45);
    ctx.strokeStyle='#facc15';ctx.lineWidth=2;ctx.setLineDash([5,3]);
    ctx.beginPath();ctx.moveTo(16,58);ctx.lineTo(29,58);ctx.stroke();ctx.setLineDash([]);
    ctx.fillStyle='#facc15';ctx.fillText(refLineTxt,33,62);
    ctx.restore();

  },[result,tab,showPhoto,scaleW,scaleH,refElev,elevMin,elevMax,lang]);

  const exportPNG=useCallback(()=>{
    canvasRef.current?.toBlob(b=>{
      const a=document.createElement('a');a.href=URL.createObjectURL(b);
      a.download=`topo_${Date.now()}.png`;a.click();
    },'image/png');
  },[]);

  const convertBIM=useCallback(()=>{
    if(!result||!onConvertToBIM||!cvName.trim())return;
    const{raw,smooth,cols,rows,refT}=result;
    setCvBusy(true);setCvDone(null);

    // Sobel 엣지 감지 → 도면 폴리라인 (선 형태)
    const src=raw?gaussianBlur(raw,0.8):smooth;
    const edges=sobelEdge(src);
    const drawingLines=buildDrawingLines(edges,cols,rows,scaleW,scaleH,cvThreshold,600);

    // ── 절토/성토 Slab 생성 ─────────────────────────────────────────
    // 블록별 평균 밝기(고도)를 계산한 뒤 전체 블록을 밝기 순으로 정렬
    // → 상위 50%를 절토(빨강), 하위 50%를 성토(초록)로 분류
    // 이미지 전체 밝기와 무관하게 항상 양쪽 색상이 나오도록 순위 기반 분류
    const GROUP=Math.max(4,Math.ceil(Math.min(cols,rows)/25));
    const slabSX=+((scaleW/cols*GROUP).toFixed(3));
    const slabSZ=+((scaleH/rows*GROUP).toFixed(3));

    const rawBlocks=[];
    for(let r=0;r<rows-GROUP;r+=GROUP){
      for(let c=0;c<cols-GROUP;c+=GROUP){
        let s=0,n=0;
        for(let dr=0;dr<GROUP&&r+dr<rows;dr++)
          for(let dc=0;dc<GROUP&&c+dc<cols;dc++){s+=smooth[r+dr][c+dc];n++;}
        const avg=s/n;
        const wx=+((c/cols*scaleW-scaleW/2+slabSX/2).toFixed(3));
        const wz=+((r/rows*scaleH-scaleH/2+slabSZ/2).toFixed(3));
        rawBlocks.push({avg,wx,wz});
      }
    }

    // 순위 기반: 밝기 내림차순 정렬 → 상위 절반=절토(빨강), 하위 절반=성토(초록)
    const sorted=[...rawBlocks].sort((a,b)=>b.avg-a.avg);
    const half=Math.ceil(sorted.length/2);
    sorted.forEach((b,i)=>{b._color=i<half?'#ef4444':'#22c55e';});

    const terrainEls=rawBlocks.map(b=>({
      elementType:'IfcSlab',material:'Earthwork',
      positionX:b.wx,positionY:-0.05,positionZ:b.wz,
      sizeX:slabSX,sizeY:0.1,sizeZ:slabSZ,
      _color:b._color, // 절토=빨강, 성토=초록
    }));

    onConvertToBIM('Building',cvName.trim(),terrainEls,[],drawingLines,proj=>{
      setCvBusy(false);
      if(proj){setCvDone('ok');setTimeout(()=>{if(onProjectSelect)onProjectSelect(proj);},1200);}
      else setCvDone('err');
    });
  },[result,onConvertToBIM,onProjectSelect,cvName,cvThreshold,scaleW,scaleH]);

  // 현재 threshold에서 예상 폴리라인 수 (Sobel 맵 미리 실행)
  const lineCount=useMemo(()=>{
    if(!result)return 0;
    const src=result.raw?gaussianBlur(result.raw,0.8):result.smooth;
    const edges=sobelEdge(src);
    const segs=marchingSquares(edges,cvThreshold);
    return Math.min(chainSegments(segs).length,600);
  },[result,cvThreshold]);

  const T2='#8896a4';

  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center"
         style={{backgroundColor:'rgba(0,0,0,0.82)',backdropFilter:'blur(6px)'}}>
      <div className="relative w-full max-w-5xl max-h-[95vh] flex flex-col rounded-2xl overflow-hidden"
           style={{backgroundColor:'#06101a',border:'1px solid #1a3350',boxShadow:'0 25px 80px rgba(0,0,0,0.7)'}}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0"
             style={{background:'linear-gradient(90deg,#071420,#0a1e34)',borderBottom:'1px solid #1a3350'}}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl"
                 style={{background:'linear-gradient(135deg,#0d2a1a,#0a3520)',border:'1px solid #22c55e50'}}>
              🛸
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">{t('title')}</h3>
              <p className="text-xs mt-0.5" style={{color:T2}}>{t('subtitle')}</p>
            </div>
          </div>
          <button onClick={onClose}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex shrink-0" style={{backgroundColor:'#07121e',borderBottom:'1px solid #1a3350'}}>
          {[['upload','📤',t('uploadTab')],['result','📊',t('resultTab')]].map(([id,ic,lb])=>(
            <button key={id} onClick={()=>result&&setTab(id)}
                    disabled={id==='result'&&!result}
                    className="flex items-center gap-2 px-6 py-3 text-xs font-semibold transition"
                    style={{color:tab===id?'#60a5fa':T2,
                      borderBottom:tab===id?'2px solid #60a5fa':'2px solid transparent',
                      opacity:id==='result'&&!result?0.3:1,
                      cursor:id==='result'&&!result?'not-allowed':'pointer'}}>
              <span>{ic}</span><span>{lb}</span>
            </button>
          ))}
          {result&&(
            <div className="ml-auto flex items-center pr-5 gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-400"/>
              <span className="text-xs text-green-400">{t('analysisComplete', { rows: result.stats.rows, cols: result.stats.cols })}</span>
            </div>
          )}
        </div>

        <canvas ref={hidRef} className="hidden"/>

        <div className="flex-1 overflow-hidden min-h-0">

          {/* ─── UPLOAD TAB ─── */}
          {tab==='upload'&&(
            <div className="h-full overflow-y-auto p-6">
              <div className="max-w-2xl mx-auto space-y-5">

                {/* Dropzone */}
                <div onClick={()=>fileRef.current?.click()}
                     onDragOver={e=>{e.preventDefault();setDrag(true);}}
                     onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);loadFile(e.dataTransfer.files[0]);}}
                     className="flex flex-col items-center justify-center rounded-2xl cursor-pointer transition-all"
                     style={{border:`2px dashed ${drag?'#60a5fa':file?'#22c55e':'#1a3350'}`,
                       backgroundColor:drag?'#0c1e30':'#07121e',minHeight:148,
                       boxShadow:drag?'0 0 24px #60a5fa25':'none'}}>
                  <input ref={fileRef} type="file" accept="image/*" className="hidden"
                         onChange={e=>loadFile(e.target.files[0])}/>
                  {file?(
                    <div className="flex items-center gap-5 p-5">
                      {imgUrl&&<img src={imgUrl} alt="" className="w-20 h-20 object-cover rounded-xl"
                                    style={{border:'2px solid #22c55e50'}}/>}
                      <div>
                        <p className="text-sm font-semibold text-green-400">{file.name}</p>
                        <p className="text-xs mt-1" style={{color:T2}}>{(file.size/1024/1024).toFixed(2)} MB</p>
                        <p className="text-xs mt-2 text-blue-400 underline">{t('replaceFile')}</p>
                      </div>
                    </div>
                  ):(
                    <div className="text-center p-6">
                      <div className="text-5xl mb-3 opacity-80">🛸</div>
                      <p className="text-sm font-medium text-gray-300">
                        {t('dragOrClick')} <span className="text-blue-400 underline">{t('clickToSelect')}</span>
                      </p>
                      <p className="text-xs mt-2 text-gray-600">
                        {t('fileSupport')}
                      </p>
                    </div>
                  )}
                </div>

                {/* Parameters grid */}
                <div className="grid grid-cols-2 gap-4">

                  <div className="rounded-xl p-4 space-y-3"
                       style={{backgroundColor:'#091624',border:'1px solid #1a3350'}}>
                    <p className="text-xs font-bold uppercase tracking-wider" style={{color:'#60a5fa'}}>{t('realWorldSize')}</p>
                    {[[t('width'),scaleW,setScaleW],[t('height'),scaleH,setScaleH]].map(([l,v,s])=>(
                      <label key={l} className="flex items-center justify-between">
                        <span className="text-xs" style={{color:T2}}>{l}</span>
                        <input type="number" min={1} value={v} onChange={e=>s(+e.target.value)}
                               className="w-24 px-2 py-1.5 rounded-lg text-xs text-white outline-none text-right"
                               style={{backgroundColor:'#060f18',border:'1px solid #1a3350'}}/>
                      </label>
                    ))}
                  </div>

                  <div className="rounded-xl p-4 space-y-3"
                       style={{backgroundColor:'#091624',border:'1px solid #1a3350'}}>
                    <p className="text-xs font-bold uppercase tracking-wider" style={{color:'#4ade80'}}>{t('altitudeSetting')}</p>
                    {[[t('minAlt'),elevMin,setElevMin],[t('maxAlt'),elevMax,setElevMax],
                      [t('refAlt'),refElev,setRefElev]].map(([l,v,s])=>(
                      <label key={l} className="flex items-center justify-between">
                        <span className="text-xs" style={{color:T2}}>{l}</span>
                        <input type="number" step={0.5} value={v} onChange={e=>s(+e.target.value)}
                               className="w-24 px-2 py-1.5 rounded-lg text-xs text-white outline-none text-right"
                               style={{backgroundColor:'#060f18',border:'1px solid #1a3350'}}/>
                      </label>
                    ))}
                  </div>

                  <div className="rounded-xl p-4 space-y-3"
                       style={{backgroundColor:'#091624',border:'1px solid #1a3350'}}>
                    <p className="text-xs font-bold uppercase tracking-wider" style={{color:'#facc15'}}>{t('contour')}</p>
                    <label className="flex items-center justify-between">
                      <span className="text-xs" style={{color:T2}}>{t('interval')}</span>
                      <input type="number" min={0.1} step={0.5} value={contourInt}
                             onChange={e=>setContourInt(Math.max(0.1,+e.target.value))}
                             className="w-24 px-2 py-1.5 rounded-lg text-xs text-white outline-none text-right"
                             style={{backgroundColor:'#060f18',border:'1px solid #1a3350'}}/>
                    </label>
                    <p className="text-xs" style={{color:T2}}>{t('majorContour', { n: contourInt*5 })}</p>
                  </div>

                  <div className="rounded-xl p-4 space-y-3"
                       style={{backgroundColor:'#091624',border:'1px solid #1a3350'}}>
                    <p className="text-xs font-bold uppercase tracking-wider" style={{color:'#c084fc'}}>{t('resolution')}</p>
                    <div className="flex justify-between text-xs mb-1">
                      <span style={{color:T2}}>{t('samplingStep')}</span>
                      <span className="text-purple-300">
                        {step===2?t('highQuality'):step===4?t('standard'):step===8?t('fast'):t('stepPx',{n:step})}
                      </span>
                    </div>
                    <input type="range" min={2} max={12} step={2} value={step}
                           onChange={e=>setStep(+e.target.value)} className="w-full accent-purple-500"/>
                    <p className="text-xs" style={{color:T2}}>{t('lowerIsMoreDetailed')}</p>
                  </div>
                </div>

                <button onClick={analyse} disabled={!file||busy}
                        className="w-full py-4 rounded-xl text-sm font-bold text-white transition-all"
                        style={{
                          background:file&&!busy?'linear-gradient(135deg,#0ea5e9,#7c3aed)':'#091624',
                          border:`1px solid ${file?'#0ea5e9':'#1a3350'}`,
                          cursor:!file||busy?'not-allowed':'pointer',
                          boxShadow:file&&!busy?'0 0 24px #0ea5e935':'none',
                        }}>
                  {busy?(
                    <span className="flex items-center justify-center gap-2">
                      <span className="animate-spin inline-block">⏳</span> {t('analyzing')}
                    </span>
                  ):t('startAnalysis')}
                </button>
              </div>
            </div>
          )}

          {/* ─── RESULT TAB ─── */}
          {tab==='result'&&result&&(
            <div className="flex h-full min-h-0">

              {/* Canvas */}
              <div className="flex-1 relative min-h-0" style={{backgroundColor:'#040b11'}}>
                <canvas ref={canvasRef} width={800} height={580}
                        className="w-full h-full" style={{display:'block'}}/>
                <div className="absolute bottom-3 left-3 flex gap-2">
                  <button onClick={()=>setShowPhoto(v=>!v)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium transition"
                          style={{backgroundColor:showPhoto?'#1d4ed8':'rgba(6,16,26,0.9)',
                            border:'1px solid '+(showPhoto?'#3b82f6':'#1a3350'),
                            color:'#e2e8f0',backdropFilter:'blur(4px)'}}>
                    {showPhoto?t('photo'):t('elevMap')}
                  </button>
                  <button onClick={()=>setTab('upload')}
                          className="px-3 py-1.5 rounded-lg text-xs transition"
                          style={{backgroundColor:'rgba(6,16,26,0.9)',border:'1px solid #1a3350',
                            color:T2,backdropFilter:'blur(4px)'}}>
                    {t('reset')}
                  </button>
                </div>
              </div>

              {/* Side panel */}
              <div className="w-[268px] shrink-0 flex flex-col border-l border-[#1a3350] overflow-y-auto"
                   style={{backgroundColor:'#060f18'}}>

                {/* Stats */}
                <div className="p-4 space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">{t('earthworkAnalysis')}</p>
                  {[
                    {lb:t('cut'),v:result.stats.cut,c:'#ef4444',ic:'⛏️'},
                    {lb:t('fill'),v:result.stats.fill,c:'#22c55e',ic:'🚛'},
                    {lb:t('netEarthwork'),v:Math.abs(result.stats.net),c:'#facc15',ic:'⚖️',
                     sub:result.stats.net>=0?t('cutDominant'):t('fillDominant')},
                  ].map(({lb,v,c,ic,sub})=>(
                    <div key={lb} className="rounded-xl p-3"
                         style={{backgroundColor:'#091624',border:`1px solid ${c}25`}}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs">{ic}</span>
                        <span className="text-xs" style={{color:T2}}>{lb}</span>
                      </div>
                      <div className="text-xl font-bold" style={{color:c}}>
                        {v.toLocaleString()} <span className="text-sm font-normal text-gray-500">m³</span>
                      </div>
                      {sub&&<div className="text-xs mt-0.5" style={{color:T2}}>{sub}</div>}
                    </div>
                  ))}
                </div>

                {/* Info */}
                <div className="px-4 pb-3">
                  <div className="rounded-xl p-3" style={{backgroundColor:'#091624',border:'1px solid #1a3350'}}>
                    <p className="text-xs font-semibold text-gray-400 mb-2">{t('surveyInfo')}</p>
                    <div className="space-y-1.5 text-xs">
                      {[[t('area'),`${result.stats.area.toLocaleString()} m²`],
                        [t('grid'),`${result.stats.cols}×${result.stats.rows}`],
                        [t('altitude'),`${elevMin}~${elevMax} m`],
                        [t('refAltLabel'),`${refElev} m`],
                        [t('contourInterval'),`${contourInt} m`]
                      ].map(([k,v])=>(
                        <div key={k} className="flex justify-between">
                          <span style={{color:T2}}>{k}</span>
                          <span className="text-gray-200 font-medium">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Export */}
                <div className="px-4 pb-3">
                  <button onClick={exportPNG}
                          className="w-full py-2 rounded-lg text-xs font-semibold text-white transition"
                          style={{backgroundColor:'#1e3a5f',border:'1px solid #2563eb'}}>
                    {t('savePng')}
                  </button>
                </div>

                {/* BIM Conversion — 선(폴리라인) 전용 */}
                {onConvertToBIM&&(
                  <div className="mx-3 mb-4 rounded-xl p-4 space-y-3"
                       style={{backgroundColor:'#0e0820',border:'1px solid #4c1d95',
                         boxShadow:'0 0 20px #7c3aed15'}}>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg flex items-center justify-center text-base"
                           style={{background:'linear-gradient(135deg,#1e3a5f,#2563eb)',border:'1px solid #3b82f650'}}>
                        📐
                      </div>
                      <div>
                        <p className="text-xs font-bold text-blue-300">{t('bimConvert')}</p>
                        <p className="text-xs" style={{color:T2}}>{t('drawingLineConvert')}</p>
                      </div>
                    </div>

                    {cvDone==='ok'?(
                      <div className="rounded-xl py-3 text-xs font-semibold text-center"
                           style={{backgroundColor:'#0c2a1a',border:'1px solid #22c55e50',color:'#4ade80'}}>
                        {t('projectCreated')}<br/>
                        <span className="font-normal text-green-600 text-xs">{t('redirecting')}</span>
                      </div>
                    ):(
                      <>
                        {cvDone==='err'&&(
                          <div className="text-xs text-red-400 rounded-lg px-3 py-2"
                               style={{backgroundColor:'#2a1010',border:'1px solid #f4433620'}}>
                            {t('conversionFailed')}
                          </div>
                        )}

                        <input type="text" value={cvName} onChange={e=>setCvName(e.target.value)}
                               placeholder={t('projectNamePlaceholder')}
                               className="w-full px-3 py-2 rounded-lg text-xs text-white outline-none"
                               style={{backgroundColor:'#060f18',border:'1px solid #4c1d95'}}/>

                        {/* 엣지 감도 슬라이더 */}
                        <div>
                          <div className="flex justify-between text-xs mb-1.5">
                            <span style={{color:T2}}>{t('edgeSensitivity')}</span>
                            <span className="text-blue-300 font-medium">
                              {t('polylineCount',{count:lineCount})}
                            </span>
                          </div>
                          <input type="range" min={0.05} max={0.45} step={0.05}
                                 value={cvThreshold}
                                 onChange={e=>setCvThreshold(+e.target.value)}
                                 className="w-full accent-blue-500"/>
                          <div className="flex justify-between text-xs mt-1" style={{color:'#475569'}}>
                            <span>{t('moreLines')}</span>
                            <span>{t('fewerLines')}</span>
                          </div>
                        </div>

                        <button onClick={convertBIM} disabled={!cvName.trim()||cvBusy}
                                className="w-full py-2.5 rounded-xl text-xs font-bold text-white transition-all"
                                style={{
                                  background:cvName.trim()&&!cvBusy?'linear-gradient(135deg,#2563eb,#1d4ed8)':'#0e0820',
                                  border:`1px solid ${cvName.trim()?'#3b82f6':'#1e2a3a'}`,
                                  cursor:!cvName.trim()||cvBusy?'not-allowed':'pointer',
                                  boxShadow:cvName.trim()&&!cvBusy?'0 0 16px #3b82f645':'none',
                                }}>
                          {cvBusy?(
                            <span className="flex items-center justify-center gap-2">
                              <span className="animate-spin">⏳</span> {t('converting')}
                            </span>
                          ):t('createBimProject')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

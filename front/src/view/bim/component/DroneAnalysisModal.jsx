import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useT } from '../../../i18n/LanguageContext';

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

// ── Ramer-Douglas-Peucker 선 단순화 ─────────────────────────────────────────
function rdpSimplify(pts,eps){
  if(pts.length<=2)return pts;
  const[x1,y1]=pts[0],[x2,y2]=pts[pts.length-1];
  const dx=x2-x1,dy=y2-y1,d2=dx*dx+dy*dy;
  let maxD=0,maxI=0;
  for(let i=1;i<pts.length-1;i++){
    const[px,py]=pts[i];
    const dist=d2<1e-12?(px-x1)*(px-x1)+(py-y1)*(py-y1)
        :(dy*px-dx*py+x2*y1-y2*x1)**2/d2;
    if(dist>maxD){maxD=dist;maxI=i;}
  }
  if(maxD<=eps*eps)return[pts[0],pts[pts.length-1]];
  return[...rdpSimplify(pts.slice(0,maxI+1),eps).slice(0,-1),
    ...rdpSimplify(pts.slice(maxI),eps)];
}

// ── 외곽 테두리 평탄화 ────────────────────────────────────────────────────────
function padBorder(grid,pad=4){
  const R=grid.length,C=grid[0].length;
  const g=grid.map(r=>new Float32Array(r));
  for(let p=0;p<pad;p++){
    for(let c=0;c<C;c++){g[p][c]=g[pad][c];g[R-1-p][c]=g[R-1-pad][c];}
    for(let r=0;r<R;r++){g[r][p]=g[r][pad];g[r][C-1-p]=g[r][C-1-pad];}
  }
  return g;
}

// ── 내부 BIM 선 추가 헬퍼 ─────────────────────────────────────────────────────
function _appendLine(lines,pts,sx,sy,scaleW,scaleH,color='#93c5fd',lineWidth=1){
  if(pts.length<2)return;
  const wpts=pts.map(([cx,cy])=>[
    +(( cx*sx).toFixed(3)),+((cy*sy).toFixed(3)),0]);
  const first=wpts[0],last=wpts[wpts.length-1];
  lines.push({startX:first[0],startY:first[1],startZ:0,
    endX:last[0],endY:last[1],endZ:0,
    color,lineWidth,
    pointsJson:JSON.stringify(wpts),closed:false,shapeHeight:0});
}

// ── 구역 경계선 추출 ──────────────────────────────────────────────────────────
function buildZoneBoundaryLines(smooth,cols,rows,scaleW,scaleH,nZones=6,rdpEps=1.2){
  const sx=scaleW/cols,sy=scaleH/rows,PAD=4;
  const padded=padBorder(smooth,PAD);
  const lines=[];
  for(let i=1;i<nZones;i++){
    const chains=chainSegments(marchingSquares(padded,i/nZones));
    for(const chain of chains){
      let sub=[];
      const flush=()=>{
        if(sub.length>=5){
          const s=rdpSimplify(sub,rdpEps);
          _appendLine(lines,s,sx,sy,scaleW,scaleH);
        }
        sub=[];
      };
      for(const[x,y]of chain){
        if(x>PAD&&x<cols-PAD&&y>PAD&&y<rows-PAD) sub.push([x,y]);
        else flush();
      }
      flush();
    }
  }
  return lines;
}

// ── 절토/성토 색상 등고선 생성 ───────────────────────────────────────────────
function buildCutFillLines(smooth,cols,rows,scaleW,scaleH,refT,nZones=4,rdpEps=1.2){
  const sx=scaleW/cols,sy=scaleH/rows,PAD=4;
  const padded=padBorder(smooth,PAD);
  const lines=[];

  const addThreshold=(t,color,lw)=>{
    const chains=chainSegments(marchingSquares(padded,t));
    for(const chain of chains){
      let sub=[];
      const flush=()=>{
        if(sub.length>=5){const s=rdpSimplify(sub,rdpEps);_appendLine(lines,s,sx,sy,scaleW,scaleH,color,lw);}
        sub=[];
      };
      for(const[x,y]of chain){
        if(x>PAD&&x<cols-PAD&&y>PAD&&y<rows-PAD)sub.push([x,y]);
        else flush();
      }
      flush();
    }
  };

  addThreshold(refT,'#facc15',3);

  for(let i=1;i<=nZones;i++){
    const t=refT+(1-refT)*i/(nZones+1);
    if(t<0.99)addThreshold(t,'#ef4444',1.5);
  }

  for(let i=1;i<=nZones;i++){
    const t=refT*(1-i/(nZones+1));
    if(t>0.01)addThreshold(t,'#22c55e',1.5);
  }

  return lines;
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DroneAnalysisModal({onClose,onConvertToBIM,onProjectSelect}){
  const t = useT('drone');

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
  const[cvZones,setCvZones]=useState(6);
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
  },[t]);

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
  },[imgUrl,step,elevMin,elevMax,refElev,contourInt,scaleW,scaleH,t]);

  // canvas render
  useEffect(()=>{
    if(tab!=='result'||!result||!canvasRef.current)return;
    const{contours,refChains,smooth,shade,cols,rows,img,refT}=result;
    const cv=canvasRef.current,cw=cv.width,ch=cv.height;
    const ctx=cv.getContext('2d');
    ctx.clearRect(0,0,cw,ch);
    const sx=cw/cols,sy=ch/rows;

    const isMobile = window.innerWidth < 640;
    const scale = isMobile ? 1.6 : 1.0;

    if(showPhoto&&img){
      ctx.globalAlpha=0.55;ctx.drawImage(img,0,0,cw,ch);ctx.globalAlpha=1;
    } else {
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

    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
      const t=smooth[r][c];
      if(t>refT+0.01){ctx.fillStyle=isMobile?'rgba(239,68,68,0.22)':'rgba(239,68,68,0.15)';ctx.fillRect(c*sx,r*sy,sx+1,sy+1);}
      else if(t<refT-0.01){ctx.fillStyle=isMobile?'rgba(34,197,94,0.18)':'rgba(34,197,94,0.1)';ctx.fillRect(c*sx,r*sy,sx+1,sy+1);}
    }

    ctx.save();ctx.globalAlpha=0.5;
    for(const{chains,t,major}of contours){
      if(major)continue;
      ctx.strokeStyle=elevHex(t);ctx.lineWidth=0.7 * scale;
      for(const ch of chains)drawChain(ctx,ch,sx,sy);
    }ctx.restore();

    ctx.save();ctx.globalAlpha=0.92;
    for(const{chains,t,major,elev}of contours){
      if(!major)continue;
      ctx.strokeStyle=elevHex(t);ctx.lineWidth=2.0 * scale;
      for(const ch of chains)drawChain(ctx,ch,sx,sy);
      if(chains[0]?.length > 4){
        const mid=chains[0][chains[0].length>>1];
        ctx.save();ctx.globalAlpha=1;
        ctx.font=`bold ${Math.round(10 * scale)}px monospace`;
        ctx.fillStyle='#fff';ctx.shadowColor='#000';ctx.shadowBlur=4;
        ctx.fillText(`${elev.toFixed(0)}m`,mid[0]*sx+3,mid[1]*sy-3);
        ctx.restore();
      }
    }ctx.restore();

    ctx.save();ctx.strokeStyle='#facc15';ctx.lineWidth=2.4 * scale;
    ctx.setLineDash([isMobile?14:10, isMobile?7:5]);ctx.globalAlpha=0.95;
    for(const ch of refChains)drawChain(ctx,ch,sx,sy);
    ctx.restore();

    ctx.save();
    const bh=ch*0.45,by=(ch-bh)/2,bx=cw-(isMobile?20:14);
    const grad=ctx.createLinearGradient(0,by+bh,0,by);
    STOPS.forEach(([t,[r,g,b]])=>grad.addColorStop(t,`rgb(${r},${g},${b})`));
    ctx.fillStyle=grad;ctx.fillRect(bx,by,isMobile?14:10,bh);
    ctx.strokeStyle='rgba(255,255,255,0.3)';ctx.lineWidth=1;ctx.strokeRect(bx,by,isMobile?14:10,bh);
    ctx.font=`bold ${Math.round(9 * scale)}px monospace`;ctx.fillStyle='#e2e8f0';ctx.textAlign='right';
    ctx.shadowColor='#000';ctx.shadowBlur=4;
    ctx.fillText(`${elevMax}m`,bx-4,by+5);ctx.fillText(`${elevMin}m`,bx-4,by+bh+5);
    ctx.restore();

    const bm=Math.pow(10,Math.floor(Math.log10(scaleW/4)));
    const bp=(bm/scaleW)*cw;
    ctx.save();ctx.fillStyle='#fff';
    ctx.fillRect(16,ch-20,bp,5 * scale);ctx.fillRect(16,ch-(23+3*scale),2,8*scale);ctx.fillRect(16+bp,ch-(23+3*scale),2,8*scale);
    ctx.font=`bold ${Math.round(11 * scale)}px monospace`;ctx.fillStyle='#e2e8f0';
    ctx.shadowColor='#000';ctx.shadowBlur=4;ctx.fillText(`${bm}m`,16,ch-(25+5*scale));
    ctx.restore();

    ctx.save();ctx.translate(cw-(isMobile?35:26),isMobile?45:30);
    ctx.beginPath();ctx.moveTo(0,-15*scale);ctx.lineTo(5*scale,8*scale);ctx.lineTo(0,3*scale);ctx.lineTo(-5*scale,8*scale);ctx.closePath();
    ctx.fillStyle='#60a5fa';ctx.fill();
    ctx.font=`bold ${Math.round(12 * scale)}px sans-serif`;ctx.fillStyle='#93c5fd';ctx.textAlign='center';
    ctx.shadowColor='#000';ctx.shadowBlur=4;ctx.fillText('N',0,-18*scale);
    ctx.restore();

    ctx.save();
    ctx.font=`bold ${Math.round(10 * scale)}px sans-serif`;

    const cutLegend = t('cutLegend');
    const fillLegend = t('fillLegend');
    const refLineTxt = t('refLine', { n: refElev });

    const w1 = ctx.measureText(cutLegend).width;
    const w2 = ctx.measureText(fillLegend).width;
    const w3 = ctx.measureText(refLineTxt).width;
    const maxTextWidth = Math.max(w1, w2, w3);

    const padding = 12 * scale;
    const itemGap = isMobile ? 22 : 18;
    const lw = maxTextWidth + (isMobile ? 40 : 34) * scale + padding * 2;
    const lh = padding * 2 + itemGap * 2 + (isMobile ? 14 : 10);

    ctx.fillStyle = 'rgba(8,17,26,0.92)';
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5 * scale;
    ctx.beginPath();
    if(ctx.roundRect) ctx.roundRect(10, 10, lw, lh, 6); else ctx.rect(10, 10, lw, lh);
    ctx.fill(); ctx.stroke();

    const startY = 14 + padding;
    ctx.fillStyle = 'rgba(239,68,68,0.95)';
    ctx.fillRect(10 + padding, startY, 14 * scale, 10 * scale);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(cutLegend, 10 + padding + 18 * scale, startY + 9 * scale);

    ctx.fillStyle = 'rgba(34,197,94,0.95)';
    ctx.fillRect(10 + padding, startY + itemGap, 14 * scale, 10 * scale);
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(fillLegend, 10 + padding + 18 * scale, startY + itemGap + 9 * scale);

    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 2.5 * scale; ctx.setLineDash([5,3]);
    ctx.beginPath();
    ctx.moveTo(10 + padding, startY + itemGap * 2 + 5 * scale);
    ctx.lineTo(10 + padding + 14 * scale, startY + itemGap * 2 + 5 * scale);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#facc15';
    ctx.fillText(refLineTxt, 10 + padding + 18 * scale, startY + itemGap * 2 + 9 * scale);
    ctx.restore();

  },[result,tab,showPhoto,scaleW,scaleH,refElev,elevMin,elevMax,t]);

  const exportPNG=useCallback(()=>{
    canvasRef.current?.toBlob(b=>{
      const a=document.createElement('a');a.href=URL.createObjectURL(b);
      a.download=`topo_${Date.now()}.png`;a.click();
    },'image/png');
  },[]);

  const convertBIM=useCallback(()=>{
    if(!result||!onConvertToBIM||!cvName.trim())return;
    const{smooth,cols,rows,refT}=result;
    setCvBusy(true);setCvDone(null);

    const drawingLines=buildZoneBoundaryLines(smooth,cols,rows,scaleW,scaleH,cvZones);
    const cutFillLines=buildCutFillLines(smooth,cols,rows,scaleW,scaleH,refT);

    onConvertToBIM('DRONE',cvName.trim(),[],[],[...drawingLines,...cutFillLines],proj=>{
      setCvBusy(false);
      if(proj){setCvDone('ok');setTimeout(()=>{if(onProjectSelect)onProjectSelect(proj);},1200);}
      else setCvDone('err');
    });
  },[result,onConvertToBIM,onProjectSelect,cvName,cvZones,scaleW,scaleH]);

  const lineCount=useMemo(()=>{
    if(!result)return 0;
    const{smooth,cols,rows}=result;
    const PAD=4;
    const padded=padBorder(smooth,PAD);
    let count=0;
    for(let i=1;i<cvZones;i++){
      const chains=chainSegments(marchingSquares(padded,i/cvZones));
      for(const chain of chains){
        let sub=0;
        for(const[x,y]of chain){
          if(x>PAD&&x<cols-PAD&&y>PAD&&y<rows-PAD)sub++;
          else{if(sub>=5)count++;sub=0;}
        }
        if(sub>=5)count++;
      }
    }
    return count;
  },[result,cvZones]);

  const showLineWarning = lineCount > 400;
  const T2='#8896a4';

  return(
      <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4"
           style={{backgroundColor:'rgba(0,0,0,0.82)',backdropFilter:'blur(6px)'}}>

        {/* ─── [모바일 최대화 가이드 튜닝] 모바일일 때는 h-screen / rounded-none으로 타이트하게 뷰포트 밀착 ─── */}
        <div className="relative w-full max-w-5xl h-screen sm:h-[90vh] flex flex-col rounded-none sm:rounded-2xl overflow-hidden"
             style={{backgroundColor:'#06101a',border:'1px solid #1a3350',boxShadow:'0 25px 80px rgba(0,0,0,0.7)'}}>

          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 shrink-0"
               style={{background:'linear-gradient(90deg,#071420,#0a1e34)',borderBottom:'1px solid #1a3350'}}>
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center text-lg sm:text-xl flex-shrink-0"
                   style={{background:'linear-gradient(135deg,#0d2a1a,#0a3520)',border:'1px solid #22c55e50'}}>
                🛸
              </div>
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm font-bold text-white tracking-wide truncate">{t('title')}</h3>
                <p className="text-xs mt-0.5 hidden sm:block truncate" style={{color:T2}}>{t('subtitle')}</p>
              </div>
            </div>
            <button onClick={onClose}
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition flex-shrink-0">
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div className="flex shrink-0" style={{backgroundColor:'#07121e',borderBottom:'1px solid #1a3350'}}>
            {[['upload','📤',t('uploadTab')],['result','📊',t('resultTab')]].map(([id,ic,lb])=>(
                <button key={id} onClick={()=>result&&setTab(id)}
                        disabled={id==='result'&&!result}
                        className="flex items-center gap-1.5 px-4 sm:px-6 py-3 text-xs font-semibold transition"
                        style={{color:tab===id?'#60a5fa':T2,
                          borderBottom:tab===id?'2px solid #60a5fa':'2px solid transparent',
                          opacity:id==='result'&&!result?0.3:1,
                          cursor:id==='result'&&!result?'not-allowed':'pointer'}}>
                  <span>{ic}</span><span>{lb}</span>
                </button>
            ))}
            {result&&(
                <div className="ml-auto flex items-center pr-3 sm:pr-5 gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0"/>
                  <span className="text-xs text-green-400 hidden sm:inline">
                {t('analysisComplete', { rows: result.stats.rows, cols: result.stats.cols })}
              </span>
                  <span className="text-xs text-green-400 sm:hidden">✓</span>
                </div>
            )}
          </div>

          <canvas ref={hidRef} className="hidden"/>

          <div className="flex-1 relative min-h-0 w-full overflow-hidden">

            {/* ─── UPLOAD TAB ─── */}
            {tab==='upload'&&(
                <div className="absolute inset-0 overflow-y-auto modal-scroll p-4 sm:p-6"
                     style={{ WebkitOverflowScrolling: 'touch', touchAction: 'pan-y' }}>
                  <div className="max-w-2xl mx-auto space-y-4 sm:space-y-5">

                    <div onDragOver={e=>{e.preventDefault();setDrag(true);}}
                         onDragLeave={()=>setDrag(false)}
                         onDrop={e=>{e.preventDefault();setDrag(false);loadFile(e.dataTransfer.files[0]);}}
                         style={{
                           position:'relative',
                           border:`2px dashed ${drag?'#60a5fa':file?'#22c55e':'#1a3350'}`,
                           backgroundColor:drag?'#0c1e30':'#07121e',
                           borderRadius:16, minHeight:148,
                           boxShadow:drag?'0 0 24px #60a5fa25':'none',
                           overflow:'hidden',
                         }}>

                      <input ref={fileRef} type="file" accept="image/*"
                             onChange={e=>loadFile(e.target.files[0])}
                             style={{
                               position:'absolute', inset:0,
                               width:'100%', height:'100%',
                               opacity:0, cursor:'pointer', zIndex:10,
                               touchAction:'manipulation',
                             }}/>

                      {file?(
                          <div className="flex items-center gap-4 p-5 w-full" style={{position:'relative',zIndex:1}}>
                            {imgUrl&&<img src={imgUrl} alt="" className="w-16 h-16 sm:w-20 sm:h-20 object-cover rounded-xl flex-shrink-0"
                                          style={{border:'2px solid #22c55e50'}}/>}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-green-400 truncate">{file.name}</p>
                              <p className="text-xs mt-1" style={{color:T2}}>{(file.size/1024/1024).toFixed(2)} MB</p>
                              <p className="text-xs mt-2 text-blue-400">{t('replaceFile')}</p>
                            </div>
                          </div>
                      ):(
                          <div className="flex flex-col items-center justify-center text-center p-6 w-full"
                               style={{position:'relative',zIndex:1,minHeight:148,pointerEvents:'none'}}>
                            <div className="text-4xl mb-3 opacity-80">📂</div>
                            <p className="text-sm font-medium text-gray-300 hidden sm:block">
                              {t('dragOrClick')} <span className="text-blue-400 underline">{t('clickToSelect')}</span>
                            </p>
                            <p className="text-xs mt-2 text-gray-600">{t('fileSupport')}</p>
                          </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="rounded-xl p-4 space-y-3"
                           style={{backgroundColor:'#091624',border:'1px solid #1a3350'}}>
                        <p className="text-xs font-bold uppercase tracking-wider" style={{color:'#60a5fa'}}>{t('realWorldSize')}</p>
                        {[[t('width'),scaleW,setScaleW],[t('height'),scaleH,setScaleH]].map(([l,v,s])=>(
                            <label key={l} className="flex items-center justify-between">
                              <span className="text-xs" style={{color:T2}}>{l}</span>
                              <input type="number" inputMode="decimal" min={1} value={v} onChange={e=>s(+e.target.value)}
                                     className="w-24 px-2 py-2 rounded-lg text-xs text-white outline-none text-right"
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
                              <input type="number" inputMode="decimal" step={0.5} value={v} onChange={e=>s(+e.target.value)}
                                     className="w-24 px-2 py-2 rounded-lg text-xs text-white outline-none text-right"
                                     style={{backgroundColor:'#060f18',border:'1px solid #1a3350'}}/>
                            </label>
                        ))}
                      </div>

                      <div className="rounded-xl p-4 space-y-3"
                           style={{backgroundColor:'#091624',border:'1px solid #1a3350'}}>
                        <p className="text-xs font-bold uppercase tracking-wider" style={{color:'#facc15'}}>{t('contour')}</p>
                        <label className="flex items-center justify-between">
                          <span className="text-xs" style={{color:T2}}>{t('interval')}</span>
                          <input type="number" inputMode="decimal" min={0.1} step={0.5} value={contourInt}
                                 onChange={e=>setContourInt(Math.max(0.1,+e.target.value))}
                                 className="w-24 px-2 py-2 rounded-lg text-xs text-white outline-none text-right"
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
                               onChange={e=>setStep(+e.target.value)} className="w-full accent-purple-500"
                               style={{touchAction:'none'}}/>
                        <p className="text-xs" style={{color:T2}}>{t('lowerIsMoreDetailed')}</p>
                      </div>
                    </div>

                    <button onClick={analyse} disabled={!file||busy}
                            className="w-full py-4 sm:py-4 rounded-xl text-sm font-bold text-white transition-all"
                            style={{
                              minHeight:52,
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
                <div className="absolute inset-0 flex flex-col sm:flex-row h-full w-full overflow-hidden">

                  {/* 좌측 도면 영역 (모바일 격자 분배 비율 상향: 45vh -> 52vh로 상향해 확장) */}
                  <div className="relative w-full h-[52vh] sm:h-full sm:flex-1 bg-[#040b11] min-h-0 flex flex-col">
                    <div className="flex-1 relative min-h-0 w-full">
                      <canvas ref={canvasRef} width={800} height={580}
                              className="w-full h-full object-contain" style={{display:'block'}}/>
                    </div>

                    {/* 사진 / 재설정 버튼 바 */}
                    <div className="p-3 bg-[#060f18] sm:bg-transparent border-b border-[#1a3350] sm:border-0 flex gap-2 z-20 shrink-0 sm:absolute sm:bottom-3 sm:left-3">
                      <button onClick={()=>setShowPhoto(v=>!v)}
                              className="px-4 py-2 sm:px-3 sm:py-1.5 rounded-lg text-xs font-medium transition flex-1 sm:flex-none text-center"
                              style={{backgroundColor:showPhoto?'#1d4ed8':'rgba(6,16,26,0.9)',
                                border:'1px solid '+(showPhoto?'#3b82f6':'#1a3350'),
                                color:'#e2e8f0',backdropFilter:'blur(4px)'}}>
                        {showPhoto?t('photo'):t('elevMap')}
                      </button>
                      <button onClick={()=>setTab('upload')}
                              className="px-4 py-2 sm:px-3 sm:py-1.5 rounded-lg text-xs transition flex-1 sm:flex-none text-center"
                              style={{backgroundColor:'rgba(6,16,26,0.9)',border:'1px solid #1a3350',
                                color:T2,backdropFilter:'blur(4px)'}}>
                        {t('reset')}
                      </button>
                    </div>
                  </div>

                  {/* 우측 사이드 스크롤 패널 (모바일에서 남은 뷰포트를 완전히 스크롤 처리) */}
                  <div className="w-full h-[38vh] sm:h-full sm:w-[268px] shrink-0 flex flex-col sm:border-l border-t sm:border-t-0 border-[#1a3350] overflow-y-auto modal-scroll"
                       style={{
                         backgroundColor:'#060f18',
                         WebkitOverflowScrolling: 'touch',
                         touchAction: 'pan-y'
                       }}>

                    {/* Stats */}
                    <div className="p-4 space-y-2 shrink-0">
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
                    <div className="px-4 pb-3 shrink-0">
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
                    <div className="px-4 pb-3 shrink-0">
                      <button onClick={exportPNG}
                              className="w-full py-2 rounded-lg text-xs font-semibold text-white transition hover:bg-blue-700"
                              style={{backgroundColor:'#1e3a5f',border:'1px solid #2563eb'}}>
                        {t('savePng')}
                      </button>
                    </div>

                    {/* BIM Conversion */}
                    {onConvertToBIM&&(
                        <div className="mx-3 mb-6 rounded-xl p-4 space-y-3 shrink-0"
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

                                <div>
                                  <div className="flex justify-between text-xs mb-1.5">
                                    <span style={{color:T2}}>{t('edgeSensitivity')}</span>
                                    <span className="font-medium"
                                          style={{color: lineCount === 0 ? '#6b7280' : showLineWarning ? '#f59e0b' : '#93c5fd'}}>
                              {lineCount === 0
                                  ? t('noLines')
                                  : t('polylineCount', {count: lineCount})}
                            </span>
                                  </div>
                                  <input type="range" min={4} max={12} step={1}
                                         value={cvZones}
                                         onChange={e=>setCvZones(+e.target.value)}
                                         className="w-full accent-blue-500"/>
                                  <div className="flex justify-between text-xs mt-1" style={{color:'#475569'}}>
                                    <span>{t('noLinesLabel')}</span>
                                    <span>{t('moreLines')}</span>
                                  </div>
                                  {showLineWarning && lineCount > 0 && (
                                      <div className="flex items-start gap-1.5 mt-2 rounded-lg px-2.5 py-2 text-xs"
                                           style={{backgroundColor:'#2a1a08',border:'1px solid #92400e',color:'#fbbf24'}}>
                                        <span className="shrink-0 mt-0.5">⚠️</span>
                                        <span>{t('manyLinesWarning', {count: lineCount})}</span>
                                      </div>
                                  )}
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
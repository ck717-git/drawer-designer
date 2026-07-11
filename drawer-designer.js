/**
 * drawer-designer.js v4 — 抽屉收纳隔板可视化设计器
 * 多边形抽屉轮廓、侧边属性面板、斜切角度、下料表
 */
(function () {
  'use strict';

  /* ===== DOM ===== */
  var $ = function(id) { return document.getElementById(id); };
  var inputW=$('inputW'), inputD=$('inputD'), inputH=$('inputH');
  var btnGenerate=$('btnGenerate'), btnReset=$('btnReset');
  var btnAddH=$('btnAddHDivider'), btnAddV=$('btnAddVDivider'), btnAddFree=$('btnAddFreeDivider');
  var btnUndo=$('btnUndo'), btnClearAll=$('btnClearAll');
  var btnExportLayout=$('btnExportLayout'), btnExportCut=$('btnExportCut');
  var btnSidebarDelete=$('btnSidebarDelete');
  var canvasHint=$('canvasHint'), canvasWrapper=$('canvasWrapper');
  var canvas=$('mainCanvas'), ctx=canvas.getContext('2d');
  var cuttingSection=$('cuttingSection'), cuttingBody=$('cuttingBody');
  var sidebarProps=$('sidebarProps'), sidebarPropsBody=$('sidebarPropsBody');

  /* ===== 状态 ===== */
  var W=60, D=40, H=20;
  var scale=5, padding=40;
  var drawer = { vertices: [] };
  var dividers = []; // {x1,y1,x2,y2, mode, thickness, depth, id}
  var undoStack=[], selected=null, dragging=null;
  var initialized=false, nextId=1;
  var deleteBtn=null;
  var ENDPOINT_R=5, HIT_R=10;
  var spEls={}; // sidebar props cached elements

  /* ===== 工具函数 ===== */
  function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
  function round1(v){return Math.round(v*10)/10;}
  function dist(x1,y1,x2,y2){return Math.sqrt((x1-x2)*(x1-x2)+(y1-y2)*(y1-y2));}
  function deepClone(o){return JSON.parse(JSON.stringify(o));}
  function makeDiv(x1,y1,x2,y2,mode){
    return {x1:x1,y1:y1,x2:x2,y2:y2,mode:mode||'full',thickness:1.8,depth:H,id:nextId++};
  }
  function divLength(d){return round1(dist(d.x1,d.y1,d.x2,d.y2));}
  function thickToLW(t){ return Math.max(2, Math.round(t * 4)); }

  /* ===== 坐标转换 ===== */
  function c2px(v){return padding+v*scale;}
  function c2py(v){return padding+v*scale;}
  function p2cx(v){return(v-padding)/scale;}
  function p2cy(v){return(v-padding)/scale;}

  /* ===== 多边形工具 ===== */
  // 点是否在多边形内 (ray casting)
  function pointInPoly(px,py,poly){
    var inside=false;
    for(var i=0,j=poly.length-1;i<poly.length;j=i++){
      var xi=poly[i].x,yi=poly[i].y,xj=poly[j].x,yj=poly[j].y;
      if(((yi>py)!==(yj>py))&&(px<(xj-xi)*(py-yi)/(yj-yi)+xi)) inside=!inside;
    }
    return inside;
  }
  // 约束点在多边形内（如不在则找最近边上的点）
  function constrainToPoly(x,y){
    if(pointInPoly(x,y,drawer.vertices)) return {x:x,y:y};
    var best=null, bestD=Infinity;
    var v=drawer.vertices;
    for(var i=0;i<v.length;i++){
      var j=(i+1)%v.length;
      var cp=closestOnSeg(x,y,v[i].x,v[i].y,v[j].x,v[j].y);
      var dd=dist(x,y,cp.x,cp.y);
      if(dd<bestD){bestD=dd;best=cp;}
    }
    return best||{x:x,y:y};
  }
  function closestOnSeg(px,py,ax,ay,bx,by){
    var dx=bx-ax,dy=by-ay,len2=dx*dx+dy*dy;
    if(len2===0)return{x:ax,y:ay};
    var t=clamp(((px-ax)*dx+(py-ay)*dy)/len2,0,1);
    return {x:ax+t*dx,y:ay+t*dy};
  }
  // 找点所在的多边形边
  function findEdgeForPoint(poly,px,py){
    var bestI=-1,bestD=Infinity;
    for(var i=0;i<poly.length;i++){
      var j=(i+1)%poly.length;
      var cp=closestOnSeg(px,py,poly[i].x,poly[i].y,poly[j].x,poly[j].y);
      var dd=dist(px,py,cp.x,cp.y);
      if(dd<bestD){bestD=dd;bestI=i;}
    }
    return bestI;
  }
  // 计算斜切角度（使用抽屉轮廓多边形）
  function calcMiter(divider, endType){
    var ex=endType==='start'?divider.x1:divider.x2;
    var ey=endType==='start'?divider.y1:divider.y2;
    var ox=endType==='start'?divider.x2:divider.x1;
    var oy=endType==='start'?divider.y2:divider.y1;
    var poly=drawer.vertices;
    var ei=findEdgeForPoint(poly,ex,ey);
    if(ei<0) return {miter:false,angle:0};
    var v=poly;
    var e1x=v[ei].x,e1y=v[ei].y,e2x=v[(ei+1)%v.length].x,e2y=v[(ei+1)%v.length].y;
    // 边方向
    var edgeAng=Math.atan2(e2y-e1y,e2x-e1x);
    // 隔板方向（从端点指向内部）
    var divAng=Math.atan2(oy-ey,ox-ex);
    // 两方向夹角
    var angle=Math.abs(divAng-edgeAng);
    while(angle>Math.PI) angle=2*Math.PI-angle;
    if(angle>Math.PI/2) angle=Math.PI-angle;
    // angle: 0=平行, PI/2=垂直
    var deg=Math.round(angle*180/Math.PI);
    if(Math.abs(deg-90)<=2) return {miter:false,angle:0};
    return {miter:true,angle:Math.abs(90-deg)};
  }
  /* ===== 画布初始化 ===== */
  function initCanvas(){
    var maxW=canvasWrapper.clientWidth-32;
    var availW=maxW-2*padding;
    scale=Math.floor(availW/W);
    if(scale<2)scale=2; if(scale>10)scale=10;
    var cw=2*padding+W*scale, ch=2*padding+D*scale;
    var dpr=window.devicePixelRatio||1;
    canvas.width=cw*dpr; canvas.height=ch*dpr;
    canvas.style.width=cw+'px'; canvas.style.height=ch+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }

  /* ===== 撤销 ===== */
  function saveUndo(){
    undoStack.push({drawer:deepClone(drawer),dividers:deepClone(dividers),W:W,D:D,H:H});
    if(undoStack.length>50)undoStack.shift();
  }
  function doUndo(){
    if(!undoStack.length)return;
    var s=undoStack.pop(); drawer=s.drawer; dividers=s.dividers; W=s.W; D=s.D; H=s.H||20;
    inputW.value=W; inputD.value=D; inputH.value=H;
    selected=null; removeOverlay(); render(); updateUI();
  }

  /* ===== 渲染 ===== */
  function render(){
    var cw=parseFloat(canvas.style.width), ch=parseFloat(canvas.style.height);
    ctx.clearRect(0,0,cw,ch);
    ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,cw,ch);
    drawDrawer();
    for(var i=0;i<dividers.length;i++) drawDivider(dividers[i],i);
    updateDeleteBtnPos();
  }

  function drawDrawer(){
    var v=drawer.vertices;
    if(v.length<3)return;
    ctx.beginPath();
    ctx.moveTo(c2px(v[0].x),c2py(v[0].y));
    for(var i=1;i<v.length;i++) ctx.lineTo(c2px(v[i].x),c2py(v[i].y));
    ctx.closePath();
    ctx.fillStyle='#fafafa'; ctx.fill();
    ctx.strokeStyle='#000000'; ctx.lineWidth=2; ctx.stroke();
    if(selected&&selected.type==='drawer'){
      for(var i=0;i<v.length;i++){
        ctx.beginPath();
        ctx.arc(c2px(v[i].x),c2py(v[i].y),ENDPOINT_R,0,Math.PI*2);
        ctx.fillStyle='#fff'; ctx.fill();
        ctx.strokeStyle='#000'; ctx.lineWidth=2; ctx.stroke();
      }
    }
    ctx.fillStyle='#333'; ctx.font='bold 11px sans-serif';
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.fillText(W+'cm',padding+W*scale/2,padding-16);
    ctx.fillText(W+'cm',padding+W*scale/2,padding+D*scale+18);
    ctx.save(); ctx.translate(padding-18,padding+D*scale/2); ctx.rotate(-Math.PI/2);
    ctx.fillText(D+'cm',0,0); ctx.restore();
    ctx.save(); ctx.translate(padding+W*scale+18,padding+D*scale/2); ctx.rotate(Math.PI/2);
    ctx.fillText(D+'cm',0,0); ctx.restore();
  }

  function drawDivider(d,idx){
    var isSel=selected&&selected.type==='divider'&&selected.index===idx;
    ctx.beginPath();
    ctx.moveTo(c2px(d.x1),c2py(d.y1));
    ctx.lineTo(c2px(d.x2),c2py(d.y2));
    ctx.strokeStyle=isSel?'#0d6efd':'#dc3545';
    ctx.lineWidth=thickToLW(d.thickness);
    ctx.setLineDash(d.mode==='partial'?[6,4]:[]);
    ctx.stroke(); ctx.setLineDash([]);
    if(isSel){
      [[d.x1,d.y1],[d.x2,d.y2]].forEach(function(p){
        ctx.beginPath();
        ctx.arc(c2px(p[0]),c2py(p[1]),ENDPOINT_R,0,Math.PI*2);
        ctx.fillStyle='#fff'; ctx.fill();
        ctx.strokeStyle='#0d6efd'; ctx.lineWidth=2; ctx.stroke();
      });
      var mx=(c2px(d.x1)+c2px(d.x2))/2, my=(c2py(d.y1)+c2py(d.y2))/2;
      ctx.fillStyle='#0d6efd'; ctx.font='bold 11px sans-serif';
      ctx.textAlign='center'; ctx.textBaseline='bottom';
      ctx.fillText(divLength(d)+'cm',mx,my-10);
    }
  }

  /* ===== 命中检测 ===== */
  function hitTest(mx,my){
    if(selected&&selected.type==='drawer'){
      for(var i=0;i<drawer.vertices.length;i++){
        var v=drawer.vertices[i];
        if(dist(mx,my,c2px(v.x),c2py(v.y))<=HIT_R+2) return {type:'drawer',index:i};
      }
    }
    if(selected&&selected.type==='divider'){
      var d=dividers[selected.index];
      if(d&&dist(mx,my,c2px(d.x1),c2py(d.y1))<=HIT_R) return {type:'divider',index:selected.index,part:'start'};
      if(d&&dist(mx,my,c2px(d.x2),c2py(d.y2))<=HIT_R) return {type:'divider',index:selected.index,part:'end'};
    }
    for(var i=dividers.length-1;i>=0;i--){
      var d=dividers[i];
      var dd=pointToSegDist(mx,my,c2px(d.x1),c2py(d.y1),c2px(d.x2),c2py(d.y2));
      if(dd<=Math.max(HIT_R,thickToLW(d.thickness)/2+4)) return {type:'divider',index:i,part:'body'};
    }
    var v=drawer.vertices;
    for(var i=0;i<v.length;i++){
      var j=(i+1)%v.length;
      if(pointToSegDist(mx,my,c2px(v[i].x),c2py(v[i].y),c2px(v[j].x),c2py(v[j].y))<=HIT_R+2)
        return {type:'drawer',index:-1};
    }
    return null;
  }
  function pointToSegDist(px,py,x1,y1,x2,y2){
    var dx=x2-x1,dy=y2-y1,len2=dx*dx+dy*dy;
    if(len2===0)return dist(px,py,x1,y1);
    var t=clamp(((px-x1)*dx+(py-y1)*dy)/len2,0,1);
    return dist(px,py,x1+t*dx,y1+t*dy);
  }

  /* ===== 鼠标坐标 ===== */
  function getPos(e){
    var r=canvas.getBoundingClientRect();
    var sx=parseFloat(canvas.style.width)/r.width;
    var sy=parseFloat(canvas.style.height)/r.height;
    var cx=e.touches?e.touches[0].clientX:e.clientX;
    var cy=e.touches?e.touches[0].clientY:e.clientY;
    return {x:(cx-r.left)*sx, y:(cy-r.top)*sy};
  }

  /* ===== 覆盖层（仅删除按钮在画布上） ===== */
  function removeOverlay(){
    if(deleteBtn){deleteBtn.remove();deleteBtn=null;}
    hideSidebarProps();
  }
  function updateDeleteBtnPos(){
    if(!deleteBtn||!selected||selected.type!=='divider')return;
    var d=dividers[selected.index]; if(!d)return;
    var cr=canvas.getBoundingClientRect(), wr=canvasWrapper.getBoundingClientRect();
    var sx2=cr.width/parseFloat(canvas.style.width);
    var mx=(c2px(d.x1)+c2px(d.x2))/2, my=(c2py(d.y1)+c2py(d.y2))/2;
    deleteBtn.style.left=(mx*sx2+cr.left-wr.left+15)+'px';
    deleteBtn.style.top=(my*sx2+cr.top-wr.top-12)+'px';
  }
  function createDeleteBtn(){
    if(deleteBtn)deleteBtn.remove();
    deleteBtn=document.createElement('button');
    deleteBtn.className='delete-btn-canvas'; deleteBtn.innerHTML='&times;';
    deleteBtn.title='删除';
    deleteBtn.addEventListener('click',function(e){e.stopPropagation();deleteSelected();});
    canvasWrapper.appendChild(deleteBtn);
  }

  /* ===== 侧边属性面板 ===== */
  function showSidebarProps(){
    if(!selected||selected.type!=='divider'){hideSidebarProps();return;}
    var d=dividers[selected.index]; if(!d){hideSidebarProps();return;}
    sidebarProps.style.display='';
    var len=divLength(d);
    var ml=d.mode==='full'?'贯通':'局部';
    sidebarPropsBody.innerHTML=
      '<div class="sp-group"><div class="sp-group-title">模式与长度</div>'+
        '<div class="sp-row"><span class="sp-mode-badge '+d.mode+'" id="spBadge">'+ml+'</span>'+
        '<button class="sp-toggle-btn" id="spToggle">'+(d.mode==='full'?'切局部':'切贯通')+'</button></div>'+
        '<div class="sp-row"><label>长度</label><input type="number" id="spLen" min="0.1" max="300" step="0.1" value="'+len.toFixed(1)+'"><span class="sp-val">cm</span></div>'+
      '</div>'+
      '<div class="sp-group"><div class="sp-group-title">起点坐标 (cm)</div>'+
        '<div class="sp-row"><label>X</label><input type="number" id="spX1" step="0.1" value="'+d.x1.toFixed(1)+'"></div>'+
        '<div class="sp-row"><label>Y</label><input type="number" id="spY1" step="0.1" value="'+d.y1.toFixed(1)+'"></div>'+
      '</div>'+
      '<div class="sp-group"><div class="sp-group-title">终点坐标 (cm)</div>'+
        '<div class="sp-row"><label>X</label><input type="number" id="spX2" step="0.1" value="'+d.x2.toFixed(1)+'"></div>'+
        '<div class="sp-row"><label>Y</label><input type="number" id="spY2" step="0.1" value="'+d.y2.toFixed(1)+'"></div>'+
      '</div>'+
      '<div class="sp-group"><div class="sp-group-title">板材参数</div>'+
        '<div class="sp-row"><label>厚度</label><input type="number" id="spThick" min="0.3" max="5" step="0.1" value="'+d.thickness.toFixed(1)+'"><span class="sp-val">cm</span></div>'+
        '<div class="sp-row"><label>深度(宽)</label><input type="number" id="spDepth" min="1" max="300" step="0.1" value="'+d.depth.toFixed(1)+'"><span class="sp-val">cm</span></div>'+
      '</div>';
    spEls={
      badge:$('spBadge'),toggle:$('spToggle'),len:$('spLen'),
      x1:$('spX1'),y1:$('spY1'),x2:$('spX2'),y2:$('spY2'),
      thick:$('spThick'),depth:$('spDepth')
    };
    spEls.toggle.addEventListener('click',function(e){e.stopPropagation();toggleMode();});
    bindSp(spEls.len,function(v){setLength(parseFloat(v));});
    bindSp(spEls.x1,function(v){saveUndo();d.x1=round1(parseFloat(v));render();updateUI();});
    bindSp(spEls.y1,function(v){saveUndo();d.y1=round1(parseFloat(v));render();updateUI();});
    bindSp(spEls.x2,function(v){saveUndo();d.x2=round1(parseFloat(v));render();updateUI();});
    bindSp(spEls.y2,function(v){saveUndo();d.y2=round1(parseFloat(v));render();updateUI();});
    bindSp(spEls.thick,function(v){saveUndo();d.thickness=clamp(parseFloat(v),0.3,5);render();});
    bindSp(spEls.depth,function(v){d.depth=clamp(parseFloat(v),1,300);updateUI();});
  }
  function syncSidebarValues(){
    if(!spEls.len||!selected||selected.type!=='divider')return;
    var d=dividers[selected.index]; if(!d)return;
    if(document.activeElement!==spEls.len) spEls.len.value=divLength(d).toFixed(1);
    if(document.activeElement!==spEls.x1) spEls.x1.value=d.x1.toFixed(1);
    if(document.activeElement!==spEls.y1) spEls.y1.value=d.y1.toFixed(1);
    if(document.activeElement!==spEls.x2) spEls.x2.value=d.x2.toFixed(1);
    if(document.activeElement!==spEls.y2) spEls.y2.value=d.y2.toFixed(1);
  }
  function hideSidebarProps(){
    sidebarProps.style.display='none';
    sidebarPropsBody.innerHTML='';
    spEls={};
  }
  function bindSp(el,fn){
    if(!el)return;
    el.addEventListener('change',function(){fn(this.value);});
    el.addEventListener('click',function(e){e.stopPropagation();});
    el.addEventListener('mousedown',function(e){e.stopPropagation();});
  }

  function toggleMode(){
    if(!selected||selected.type!=='divider')return;
    saveUndo();
    var d=dividers[selected.index]; if(!d)return;
    if(d.mode==='full'){
      d._ps=d.x1;d._pe=d.x2;d._py1=d.y1;d._py2=d.y2;
      var cx2=(d.x1+d.x2)/2,cy2=(d.y1+d.y2)/2;
      var ang=Math.atan2(d.y2-d.y1,d.x2-d.x1);
      var hl=divLength(d)*0.3;
      d.x1=round1(cx2-Math.cos(ang)*hl); d.y1=round1(cy2-Math.sin(ang)*hl);
      d.x2=round1(cx2+Math.cos(ang)*hl); d.y2=round1(cy2+Math.sin(ang)*hl);
      d.mode='partial';
    } else {
      d.x1=d._ps!==undefined?d._ps:0; d.y1=d._py1!==undefined?d._py1:0;
      d.x2=d._pe!==undefined?d._pe:W; d.y2=d._py2!==undefined?d._py2:D;
      d.mode='full';
    }
    if(spEls.badge){spEls.badge.textContent=d.mode==='full'?'贯通':'局部';spEls.badge.className='sp-mode-badge '+d.mode;}
    if(spEls.toggle) spEls.toggle.textContent=d.mode==='full'?'切局部':'切贯通';
    render(); updateUI();
  }
  function setLength(newLen){
    if(!selected||selected.type!=='divider')return;
    saveUndo();
    var d=dividers[selected.index]; if(!d)return;
    newLen=clamp(round1(parseFloat(newLen)),0.1,300);
    var cx2=(d.x1+d.x2)/2,cy2=(d.y1+d.y2)/2;
    var ang=Math.atan2(d.y2-d.y1,d.x2-d.x1);
    var hl=newLen/2;
    d.x1=round1(cx2-Math.cos(ang)*hl); d.y1=round1(cy2-Math.sin(ang)*hl);
    d.x2=round1(cx2+Math.cos(ang)*hl); d.y2=round1(cy2+Math.sin(ang)*hl);
    render(); updateUI();
  }
  function deleteSelected(){
    if(!selected)return;
    saveUndo();
    if(selected.type==='divider') dividers.splice(selected.index,1);
    selected=null; removeOverlay(); render(); updateUI();
  }

  /* ===== 拖拽事件 ===== */
  function onDown(e){
    if(!initialized)return;
    e.preventDefault();
    var pos=getPos(e);
    var hit=hitTest(pos.x,pos.y);
    if(hit){
      selected=hit;
      saveUndo();
      if(hit.type==='divider'){
        var d=dividers[hit.index];
        if(hit.part==='start') dragging={type:'divider',index:hit.index,part:'start'};
        else if(hit.part==='end') dragging={type:'divider',index:hit.index,part:'end'};
        else dragging={type:'divider',index:hit.index,part:'body',ox:d.x1,oy:d.y1,ox2:d.x2,oy2:d.y2,dx:pos.x,dy:pos.y};
      } else if(hit.type==='drawer'&&hit.index>=0){
        var v=drawer.vertices[hit.index];
        dragging={type:'drawer',index:hit.index,ox:v.x,oy:v.y};
      } else {
        dragging={type:'drawer',index:-1};
      }
      createDeleteBtn();
      if(hit.type==='divider') showSidebarProps();
      render();
    } else {
      selected=null; removeOverlay(); render();
    }
  }

  function onMove(e){
    if(!dragging||!initialized)return;
    e.preventDefault();
    var pos=getPos(e);
    var cmx=p2cx(pos.x), cmy=p2cy(pos.y);

    if(dragging.type==='divider'){
      var d=dividers[dragging.index]; if(!d)return;
      if(dragging.part==='body'){
        var ddx=p2cx(pos.x)-p2cx(dragging.dx);
        var ddy=p2cy(pos.y)-p2cy(dragging.dy);
        var nx1=round1(dragging.ox+ddx),ny1=round1(dragging.oy+ddy);
        var nx2=round1(dragging.ox2+ddx),ny2=round1(dragging.oy2+ddy);
        // 约束两端都在多边形内
        var c1=constrainToPoly(nx1,ny1), c2=constrainToPoly(nx2,ny2);
        d.x1=c1.x;d.y1=c1.y;d.x2=c2.x;d.y2=c2.y;
      } else if(dragging.part==='start'){
        var c=constrainToPoly(cmx,cmy);
        d.x1=round1(c.x);d.y1=round1(c.y);
      } else {
        var c=constrainToPoly(cmx,cmy);
        d.x2=round1(c.x);d.y2=round1(c.y);
      }
    } else if(dragging.type==='drawer'&&dragging.index>=0){
      var v=drawer.vertices[dragging.index];
      v.x=round1(clamp(cmx,0,W)); v.y=round1(clamp(cmy,0,D));
      var xs=drawer.vertices.map(function(p){return p.x;});
      var ys=drawer.vertices.map(function(p){return p.y;});
      W=round1(Math.max.apply(null,xs)-Math.min.apply(null,xs));
      D=round1(Math.max.apply(null,ys)-Math.min.apply(null,ys));
      if(W<1)W=1;if(D<1)D=1;
      inputW.value=W;inputD.value=D;
    }
    render(); updateUI();
  }
  function onUp(){dragging=null;}

  canvas.addEventListener('mousedown',onDown);
  canvas.addEventListener('mousemove',onMove);
  window.addEventListener('mouseup',onUp);
  canvas.addEventListener('touchstart',onDown,{passive:false});
  canvas.addEventListener('touchmove',onMove,{passive:false});
  window.addEventListener('touchend',onUp);

  /* ===== 键盘 ===== */
  document.addEventListener('keydown',function(e){
    if(e.key==='Delete'&&selected)deleteSelected();
    if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();doUndo();}
  });

  /* ===== 按钮事件 ===== */
  btnSidebarDelete.addEventListener('click',function(){deleteSelected();});
  btnGenerate.addEventListener('click',function(){
    W=clamp(parseFloat(inputW.value)||60,1,200);
    D=clamp(parseFloat(inputD.value)||40,1,200);
    H=clamp(parseFloat(inputH.value)||20,1,200);
    inputW.value=W;inputD.value=D;inputH.value=H;
    drawer.vertices=[{x:0,y:0},{x:W,y:0},{x:W,y:D},{x:0,y:D}];
    dividers=[];undoStack=[];selected=null;
    removeOverlay();initialized=true;
    canvasHint.style.display='none';
    initCanvas();render();updateUI();
  });
  btnReset.addEventListener('click',function(){
    inputW.value=60;inputD.value=40;inputH.value=20;
    W=60;D=40;H=20;dividers=[];undoStack=[];selected=null;
    removeOverlay();initialized=false;
    canvasHint.style.display='';
    cuttingSection.style.display='none';
    ctx.clearRect(0,0,parseFloat(canvas.style.width)||400,parseFloat(canvas.style.height)||300);
  });
  btnAddH.addEventListener('click',function(){
    if(!initialized)return;saveUndo();
    var pos=round1(D/2);
    dividers.push(makeDiv(0,pos,W,pos,'full'));
    selected=null;removeOverlay();render();updateUI();
  });
  btnAddV.addEventListener('click',function(){
    if(!initialized)return;saveUndo();
    var pos=round1(W/2);
    dividers.push(makeDiv(pos,0,pos,D,'full'));
    selected=null;removeOverlay();render();updateUI();
  });
  btnAddFree.addEventListener('click',function(){
    if(!initialized)return;saveUndo();
    var cx2=W/2,cy2=D/2;
    dividers.push(makeDiv(round1(cx2-5),round1(cy2-5),round1(cx2+5),round1(cy2+5),'partial'));
    selected=null;removeOverlay();render();updateUI();
  });
  document.querySelectorAll('.btn-equal').forEach(function(btn){
    btn.addEventListener('click',function(){
      if(!initialized)return;saveUndo();
      var dir=btn.getAttribute('data-dir'),count=parseInt(btn.getAttribute('data-count'));
      if(dir==='h'){
        dividers=dividers.filter(function(d){return !(d.mode==='full'&&Math.abs(d.y1-d.y2)<0.1);});
        for(var i=1;i<count;i++) dividers.push(makeDiv(0,round1(D/count*i),W,round1(D/count*i),'full'));
      } else {
        dividers=dividers.filter(function(d){return !(d.mode==='full'&&Math.abs(d.x1-d.x2)<0.1);});
        for(var j=1;j<count;j++) dividers.push(makeDiv(round1(W/count*j),0,round1(W/count*j),D,'full'));
      }
      selected=null;removeOverlay();render();updateUI();
    });
  });
  btnUndo.addEventListener('click',doUndo);
  btnClearAll.addEventListener('click',function(){
    if(!initialized)return;saveUndo();
    dividers=[];selected=null;removeOverlay();render();updateUI();
  });

  function updateUI(){
    updateCuttingTable();
    if(selected&&selected.type==='divider') syncSidebarValues();
  }

  /* ===== 下料表（含斜切信息） ===== */
  function updateCuttingTable(){
    if(!dividers.length){cuttingSection.style.display='none';cuttingBody.innerHTML='';return;}
    cuttingSection.style.display='';
    var groups={};
    dividers.forEach(function(d){
      var len=divLength(d),w=round1(d.depth),t=round1(d.thickness);
      // 计算斜切（使用抽屉轮廓）
      var m1=calcMiter(d,'start'),m2=calcMiter(d,'end');
      var miterStr='';
      if(m1.miter||m2.miter){
        var parts=[];
        if(m1.miter)parts.push('起'+m1.angle+'°');
        if(m2.miter)parts.push('终'+m2.angle+'°');
        miterStr=parts.join(', ');
      } else {
        miterStr='无';
      }
      var key=len+'_'+w+'_'+t+'_'+miterStr;
      if(!groups[key])groups[key]={len:len,width:w,thick:t,count:0,type:d.mode==='full'?'贯通':'局部',miter:miterStr};
      groups[key].count++;
    });
    cuttingBody.innerHTML='';
    var idx=1;
    Object.keys(groups).sort().forEach(function(k){
      var g=groups[k];
      var tr=document.createElement('tr');
      tr.innerHTML='<td>'+idx+'</td><td>'+g.type+'</td><td>'+g.len.toFixed(1)+'</td><td>'+g.width.toFixed(1)+'</td><td>'+g.thick.toFixed(1)+'</td><td>'+g.miter+'</td><td>'+g.count+'</td>';
      cuttingBody.appendChild(tr);
      idx++;
    });
  }

  /* ===== 导出 ===== */
  function renderToCanvas(targetCtx,targetCanvas){
    var cw2=parseFloat(canvas.style.width),ch2=parseFloat(canvas.style.height);
    var dpr=2;
    targetCanvas.width=cw2*dpr;targetCanvas.height=ch2*dpr;
    targetCtx.scale(dpr,dpr);
    var oCtx=ctx,oCanvas=canvas,oSel=selected;
    selected=null;ctx=targetCtx;canvas=targetCanvas;
    render();
    ctx=oCtx;canvas=oCanvas;selected=oSel;
  }
  btnExportLayout.addEventListener('click',function(){
    if(!initialized)return;
    var tc=document.createElement('canvas'),tctx=tc.getContext('2d');
    renderToCanvas(tctx,tc);
    var a=document.createElement('a');
    a.download='抽屉布局_'+W+'x'+D+'cm.png';
    a.href=tc.toDataURL('image/png');a.click();
  });
  btnExportCut.addEventListener('click',function(){
    if(!initialized)return;
    var tc=document.createElement('canvas');
    var cellW=220,cellH=110,cols=3;
    var rows=Math.ceil(dividers.length/cols);
    var cw3=cols*cellW+40,ch3=rows*cellH+80;
    tc.width=cw3*2;tc.height=ch3*2;
    var tctx=tc.getContext('2d');
    tctx.scale(2,2);
    tctx.fillStyle='#fff';tctx.fillRect(0,0,cw3,ch3);
    tctx.fillStyle='#000';tctx.font='bold 14px sans-serif';
    tctx.fillText('隔板下料尺寸图',20,25);
    tctx.font='11px sans-serif';
    tctx.fillText('抽屉: '+W+' x '+D+' cm',20,45);
    dividers.forEach(function(d,i){
      var col=i%cols,row=Math.floor(i/cols);
      var ox=20+col*cellW,oy=55+row*cellH;
      var len=divLength(d);
      var sc=Math.min((cellW-30)/Math.max(len,10),(cellH-35)/Math.max(d.depth*0.5,5));
      var lw2=len*sc,th2=Math.max(d.thickness*sc*3,2);
      tctx.fillStyle='#dc3545';
      tctx.fillRect(ox,oy+10,lw2,th2);
      tctx.strokeStyle='#000';tctx.lineWidth=0.5;
      tctx.strokeRect(ox,oy+10,lw2,th2);
      tctx.fillStyle='#000';tctx.font='10px sans-serif';
      tctx.fillText('#'+(i+1)+' '+d.mode,ox,oy+8);
      // 斜切（使用抽屉轮廓）
      var m1=calcMiter(d,'start'),m2=calcMiter(d,'end');
      var mStr='';
      if(m1.miter||m2.miter){
        var p=[];if(m1.miter)p.push('起'+m1.angle+'°');if(m2.miter)p.push('终'+m2.angle+'°');
        mStr=p.join(' ');
      }
      tctx.fillText('L:'+len.toFixed(1)+' W:'+d.depth.toFixed(1)+' T:'+d.thickness.toFixed(1)+(mStr?' ['+mStr+']':''),ox,oy+cellH-8);
    });
    var a=document.createElement('a');
    a.download='隔板下料_'+W+'x'+D+'cm.png';
    a.href=tc.toDataURL('image/png');a.click();
  });

  /* ===== resize ===== */
  var rt;
  window.addEventListener('resize',function(){
    clearTimeout(rt);
    rt=setTimeout(function(){if(initialized){initCanvas();render();}},200);
  });
})();

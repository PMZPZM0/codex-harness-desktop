/**
 * screenshot/overlay-page.ts —— 截图**覆盖层页面**（HTML/CSS/JS 单字符串模板）。
 *
 * 从 electron/screenshot.ts（659 行）切出（P2 批次 6）：原 `overlayHtml()` 是纯函数（只读两个入参），
 * 却是全文件最大的一块（约 287 行），把「页面产物」和「截图服务」混在一个文件里。
 * ⛔ 页面内容**逐字节原样搬运**，一个字都没动。
 */
import type { OverlayRect } from "../screenshot";

export function buildOverlayHtml(guideDataUri: string, initialRect: OverlayRect | null): string {
  const initial = initialRect ? JSON.stringify(initialRect) : "null";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;user-select:none;-webkit-user-select:none;background:#000}
  body{cursor:crosshair}body.editing{cursor:default}
  #shot{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none}
  #ink{position:fixed;left:0;top:0;display:none}
  #ink.draw{pointer-events:auto}
  #dim{position:fixed;inset:0;background:rgba(0,0,0,.45);pointer-events:none}
  #sel{position:fixed;display:none;border:1px solid #6aa6ff;box-sizing:border-box;box-shadow:0 0 0 9999px rgba(0,0,0,.45);pointer-events:none}
  #hint{position:fixed;left:50%;top:14px;transform:translateX(-50%);padding:6px 12px;border-radius:8px;
    background:rgba(20,20,22,.86);color:#eaeaea;font:12px/1.5 -apple-system,"Segoe UI",sans-serif;
    border:1px solid rgba(255,255,255,.14);white-space:nowrap}
  #size{position:fixed;display:none;padding:3px 7px;border-radius:6px;background:rgba(20,20,22,.9);
    color:#fff;font:11px/1.4 Consolas,monospace;border:1px solid rgba(255,255,255,.16);pointer-events:none}
  #bar{position:fixed;display:none;align-items:center;gap:4px;padding:5px 7px;border-radius:10px;
    background:rgba(28,28,32,.94);border:1px solid rgba(255,255,255,.16);box-shadow:0 8px 28px rgba(0,0,0,.4);z-index:10}
  #bar button{width:30px;height:28px;border:none;border-radius:6px;background:transparent;color:#e4e4e4;
    font:14px/1 "Segoe UI Symbol","Segoe UI",sans-serif;cursor:pointer;padding:0}
  #bar button:hover{background:rgba(255,255,255,.14)}
  #bar button.on{background:#2f6fe4;color:#fff}
  #bar .sep{width:1px;height:18px;background:rgba(255,255,255,.2);margin:0 3px}
  #bar .dot{width:15px;height:15px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0}
  #bar .dot.on{border-color:#fff}
  #txt{position:fixed;display:none;border:1px dashed #6aa6ff;background:rgba(255,255,255,.06);
    color:#e24b4a;font:16px/1.4 "Segoe UI",sans-serif;outline:none;padding:2px 4px;min-width:80px;z-index:9}
  </style></head><body>
  <img id="shot" src="${guideDataUri}" alt="">
  <canvas id="ink"></canvas>
  <div id="dim"></div><div id="sel"></div><div id="size"></div>
  <input id="txt" placeholder="输入文字，回车确认">
  <div id="hint">拖动选择截图区域 · 全屏截图直接回车 · Esc / 右键取消</div>
  <div id="bar">
    <button data-tool="pen" title="画笔">✏</button>
    <button data-tool="rect" title="矩形">▭</button>
    <button data-tool="ellipse" title="椭圆">◯</button>
    <button data-tool="arrow" title="箭头">➤</button>
    <button data-tool="text" title="文字">T</button>
    <button data-tool="mosaic" title="马赛克">▒</button>
    <span class="sep"></span>
    <button class="dot on" data-color="#e24b4a" style="background:#e24b4a" title="红色"></button>
    <button class="dot" data-color="#f5b800" style="background:#f5b800" title="黄色"></button>
    <button class="dot" data-color="#2f6fe4" style="background:#2f6fe4" title="蓝色"></button>
    <button class="dot" data-color="#111111" style="background:#111111" title="黑色"></button>
    <button class="dot" data-color="#ffffff" style="background:#ffffff" title="白色"></button>
    <span class="sep"></span>
    <button id="undo" title="撤销">↺</button>
    <button id="reselect" title="重新选区">↺框</button>
    <span class="sep"></span>
    <button id="ok" title="确认（Enter）" style="color:#7ddf87;font-size:16px">✔</button>
    <button id="no" title="取消（Esc）" style="color:#f08a8a;font-size:16px">✕</button>
  </div>
  <script>
  var sel=document.getElementById('sel'),dim=document.getElementById('dim'),
      sizeTag=document.getElementById('size'),hint=document.getElementById('hint'),
      ink=document.getElementById('ink'),bar=document.getElementById('bar'),
      txt=document.getElementById('txt'),shot=document.getElementById('shot');
  var sx=0,sy=0,ex=0,ey=0,dragging=false,mode='select';
  // ---- 物理分辨率：ink 与冻结帧同尺寸，绘制坐标 = clientXY × scale ----
  var iw=0,ih=0,scale=1;
  function setupInk(){
    iw=shot.naturalWidth||innerWidth; ih=shot.naturalHeight||innerHeight;
    scale=iw/innerWidth;
    ink.width=iw; ink.height=ih;
    ink.style.width=innerWidth+'px'; ink.style.height=innerHeight+'px';
  }
  function rect(){var x=Math.min(sx,ex),y=Math.min(sy,ey),
    w=Math.abs(ex-sx),h=Math.abs(ey-sy);return{x:x,y:y,width:w,height:h}}
  function paintSel(){var r=rect();sel.style.display='block';dim.style.display='none';
    sel.style.left=r.x+'px';sel.style.top=r.y+'px';sel.style.width=r.width+'px';sel.style.height=r.height+'px';
    sizeTag.style.display='block';sizeTag.textContent=Math.round(r.width)+' × '+Math.round(r.height);
    var tx=r.x+r.width+10,ty=r.y+r.height+10;
    if(tx+90>innerWidth)tx=r.x+r.width-92;
    if(ty+26>innerHeight)ty=r.y-30;
    sizeTag.style.left=Math.max(4,tx)+'px';sizeTag.style.top=Math.max(4,ty)+'px';}
  function placeBar(){
    var r=rect(),bw=bar.offsetWidth||320,bh=bar.offsetHeight||40;
    var bx=r.x+r.width-bw,by=r.y+r.height+10;
    if(bx<6)bx=r.x;
    if(by+bh>innerHeight-6)by=r.y+r.height-bh-8;
    if(by<6)by=Math.max(6,r.y-bh-8);
    bar.style.left=Math.max(6,bx)+'px';bar.style.top=Math.max(6,by)+'px';
  }
  // ---- 工具条 ----
  var tool='',color='#e24b4a';
  var tools=bar.querySelectorAll('[data-tool]');
  for(var i=0;i<tools.length;i++){tools[i].addEventListener('click',function(){pickTool(this.getAttribute('data-tool'))});}
  var dots=bar.querySelectorAll('.dot');
  for(var j=0;j<dots.length;j++){dots[j].addEventListener('click',function(){
    color=this.getAttribute('data-color');
    for(var k=0;k<dots.length;k++)dots[k].classList.remove('on');
    this.classList.add('on');
    if(tool==='text')armText();
  });}
  function pickTool(t){
    commitText();
    tool=(tool===t)?'':t;
    for(var k=0;k<tools.length;k++)tools[k].classList.toggle('on',tools[k].getAttribute('data-tool')===tool);
    ink.className=tool?'draw':'';
    document.body.classList.toggle('editing',!tool);
    if(tool==='text')armText();
  }
  // ---- 撤销栈（离屏 canvas 快照，深 12）----
  var stack=[];
  function snapshot(){
    var c=document.createElement('canvas');c.width=iw;c.height=ih;
    c.getContext('2d').drawImage(ink,0,0);
    stack.push(c); if(stack.length>12)stack.shift();
  }
  function undo(){
    commitText();
    var c=stack.pop();
    var ctx=ink.getContext('2d');
    ctx.save();ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,iw,ih);
    if(c)ctx.drawImage(c,0,0);
    ctx.restore();
  }
  document.getElementById('undo').addEventListener('click',undo);
  document.getElementById('reselect').addEventListener('click',function(){backToSelect()});
  document.getElementById('ok').addEventListener('click',finish);
  document.getElementById('no').addEventListener('click',function(){window.shotOverlay&&window.shotOverlay.cancel()});
  // ---- 编辑态进入/退出 ----
  function enterEdit(r){
    mode='edit';setupInk();
    ink.style.display='block';
    sel.style.display='block';
    sel.style.left=r.x+'px';sel.style.top=r.y+'px';sel.style.width=r.width+'px';sel.style.height=r.height+'px';
    sizeTag.style.display='block';sizeTag.textContent=Math.round(r.width)+' × '+Math.round(r.height);
    hint.style.display='none';
    bar.style.display='flex';placeBar();
    document.body.classList.add('editing');
  }
  function backToSelect(){
    commitText();
    mode='select';tool='';
    for(var k=0;k<tools.length;k++)tools[k].classList.remove('on');
    var ctx=ink.getContext('2d');ctx.clearRect(0,0,iw,ih);stack=[];
    ink.style.display='none';ink.className='';
    bar.style.display='none';
    sel.style.display='none';sizeTag.style.display='none';
    hint.style.display='block';document.body.classList.remove('editing');
  }
  // ---- 绘制（物理像素；只在选区内落笔）----
  var drawing=false,px0=0,py0=0,prev=null,mosaicLast=null;
  function phys(e){return{x:Math.round(e.clientX*scale),y:Math.round(e.clientY*scale)}}
  function inSel(p){var r=rect();return p.x>=r.x*scale&&p.x<=(r.x+r.width)*scale&&p.y>=r.y*scale&&p.y<=(r.y+r.height)*scale}
  var low=null;
  function lowRes(){
    if(low)return low;
    low=document.createElement('canvas');low.width=Math.max(1,Math.round(iw/14));low.height=Math.max(1,Math.round(ih/14));
    var lc=low.getContext('2d');lc.imageSmoothingEnabled=true;lc.drawImage(shot,0,0,low.width,low.height);
    return low;
  }
  function stampMosaic(p){
    var ctx=ink.getContext('2d'),rad=Math.round(7*scale),g=Math.round(5*scale);
    var sx0=Math.max(0,p.x-g),sy0=Math.max(0,p.y-g),sw=Math.min(iw-sx0,g*2),sh=Math.min(ih-sy0,g*2);
    if(sw<=0||sh<=0)return;
    var l=lowRes();
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(l,sx0/14,sy0/14,sw/14,sh/14,sx0,sy0,sw,sh);
    ctx.imageSmoothingEnabled=true;
  }
  function strokeStyle(ctx){
    ctx.strokeStyle=color;ctx.fillStyle=color;
    ctx.lineWidth=Math.max(2,Math.round(3*scale));
    ctx.lineCap='round';ctx.lineJoin='round';
  }
  function drawArrow(ctx,x0,y0,x1,y1){
    var head=Math.max(10,Math.round(14*scale));
    var ang=Math.atan2(y1-y0,x1-x0);
    ctx.beginPath();ctx.moveTo(x0,y0);ctx.lineTo(x1,y1);ctx.stroke();
    ctx.beginPath();ctx.moveTo(x1,y1);
    ctx.lineTo(x1-head*Math.cos(ang-0.45),y1-head*Math.sin(ang-0.45));
    ctx.lineTo(x1-head*Math.cos(ang+0.45),y1-head*Math.sin(ang+0.45));
    ctx.closePath();ctx.fill();
  }
  // ---- 文字 ----
  var textArmed=false;
  function armText(){ textArmed=true; }
  function commitText(){
    if(txt.style.display!=='block')return;
    var value=txt.value;var px=Number(txt.getAttribute('data-px')||0),py=Number(txt.getAttribute('data-py')||0);
    txt.style.display='none';txt.value='';
    if(!value)return;
    var ctx=ink.getContext('2d');
    ctx.fillStyle=color;
    ctx.font=Math.round(17*scale)+'px "Segoe UI","Microsoft YaHei",sans-serif';
    ctx.textBaseline='top';
    ctx.fillText(value,px,py);
  }
  txt.addEventListener('keydown',function(e){
    if(e.key==='Enter'){e.stopPropagation();commitText();}
    else if(e.key==='Escape'){e.stopPropagation();txt.style.display='none';txt.value='';}
  });
  // ---- 全局鼠标/键盘 ----
  window.addEventListener('mousedown',function(e){
    if(e.button===2){window.shotOverlay&&window.shotOverlay.cancel();return}
    if(e.button!==0)return;
    if(mode==='select'){dragging=true;sx=ex=e.clientX;sy=ey=e.clientY;hint.style.display='none';paintSel();return}
    // edit 态：工具条/输入框上的点击不当作画布事件
    if(bar.contains(e.target)||txt===e.target)return;
    if(!tool){
      // 未选工具时点选区外 = 重新框选（与微信截图一致；选区内点击无操作）
      var cx=e.clientX,cy=e.clientY,cr=rect();
      if(cx<cr.x||cy<cr.y||cx>(cr.x+cr.width)||cy>(cr.y+cr.height))backToSelect();
      return;
    }
    var p=phys(e); if(!inSel(p))return;
    commitText();
    if(tool==='text'){
      txt.style.display='block';
      txt.style.left=e.clientX+'px';txt.style.top=e.clientY+'px';
      txt.style.color=color;
      txt.setAttribute('data-px',p.x);txt.setAttribute('data-py',p.y-Math.round(10*scale));
      setTimeout(function(){txt.focus()},0);
      return;
    }
    snapshot();drawing=true;px0=p.x;py0=p.y;mosaicLast=null;
    var ctx=ink.getContext('2d');
    if(tool==='rect'||tool==='ellipse'||tool==='arrow'){prev=document.createElement('canvas');prev.width=iw;prev.height=ih;prev.getContext('2d').drawImage(ink,0,0);}
    if(tool==='pen'){strokeStyle(ctx);ctx.beginPath();ctx.moveTo(p.x,p.y);}
    if(tool==='mosaic'){stampMosaic(p);mosaicLast=p;}
  },{capture:true});
  window.addEventListener('mousemove',function(e){
    if(mode==='select'){if(!dragging)return;ex=e.clientX;ey=e.clientY;paintSel();return}
    if(!drawing)return;
    var p=phys(e); if(!inSel(p))return;
    var ctx=ink.getContext('2d');
    if(tool==='pen'){ctx.lineTo(p.x,p.y);ctx.stroke();}
    else if(tool==='mosaic'){
      // 采样插值：快速拖动也铺满（两点间距 > 步长时补点）
      var step=Math.round(5*scale);
      var dx=p.x-mosaicLast.x,dy=p.y-mosaicLast.y,dist=Math.sqrt(dx*dx+dy*dy);
      var n=Math.max(1,Math.floor(dist/step));
      for(var i=1;i<=n;i++){stampMosaic({x:mosaicLast.x+dx*i/n,y:mosaicLast.y+dy*i/n});}
      mosaicLast=p;
    }
    else if(prev){
      ctx.save();ctx.setTransform(1,0,0,1,0,0);
      ctx.clearRect(0,0,iw,ih);ctx.drawImage(prev,0,0);
      strokeStyle(ctx);
      if(tool==='rect'){ctx.strokeRect(Math.min(px0,p.x),Math.min(py0,p.y),Math.abs(p.x-px0),Math.abs(p.y-py0));}
      else if(tool==='ellipse'){ctx.beginPath();ctx.ellipse((px0+p.x)/2,(py0+p.y)/2,Math.abs(p.x-px0)/2,Math.abs(p.y-py0)/2,0,0,Math.PI*2);ctx.stroke();}
      else if(tool==='arrow'){drawArrow(ctx,px0,py0,p.x,p.y);}
      ctx.restore();
    }
  },{capture:true});
  window.addEventListener('mouseup',function(e){
    if(mode==='select'){ if(!dragging)return; dragging=false;
      var r=rect(); if(r.width<8||r.height<8){sel.style.display='none';sizeTag.style.display='none';hint.style.display='block';return}
      enterEdit(r); return; }
    if(drawing){drawing=false;prev=null;}
  },{capture:true});
  window.addEventListener('dblclick',function(){ if(mode==='edit')finish(); },{capture:true});
  window.addEventListener('contextmenu',function(e){e.preventDefault();},{capture:true});
  window.addEventListener('keydown',function(e){
    if(e.target===txt)return;
    if(e.key==='Escape'){window.shotOverlay&&window.shotOverlay.cancel();}
    else if(e.key==='Enter'&&mode==='edit'){finish();}
    else if((e.ctrlKey||e.metaKey)&&(e.key==='z'||e.key==='Z')&&mode==='edit'){undo();}
  },{capture:true});
  // ---- 确认：合成「底图选区 + 标注层」物理分辨率 PNG 回传 ----
  function finish(){
    if(!window.shotOverlay)return;
    commitText();
    var r=rect();
    if(r.width<8||r.height<8){window.shotOverlay.cancel();return}
    var sc=scale||1;
    var px=Math.max(0,Math.min(Math.round(r.x*sc),iw-1)),py=Math.max(0,Math.min(Math.round(r.y*sc),ih-1));
    var pw=Math.max(1,Math.min(Math.round(r.width*sc),iw-px)),ph=Math.max(1,Math.min(Math.round(r.height*sc),ih-py));
    var out=document.createElement('canvas');out.width=pw;out.height=ph;
    var ctx=out.getContext('2d');
    ctx.drawImage(shot,px,py,pw,ph,0,0,pw,ph);
    ctx.drawImage(ink,px,py,pw,ph,0,0,pw,ph);
    window.shotOverlay.done({x:r.x,y:r.y,width:r.width,height:r.height},out.toDataURL('image/png'));
  }
  // ---- 启动：initialRect 非空 = 全屏模式，直接全选进编辑态 ----
  function boot(){
    setupInk();
    var init=${initial};
    if(init){sx=init.x;sy=init.y;ex=init.x+init.width;ey=init.y+init.height;enterEdit(rect());}
  }
  if(shot.complete)boot();else shot.addEventListener('load',boot);
  </script></body></html>`;
}

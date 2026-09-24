/**
 * 截图能力（harness 自持）。
 *
 * 两种模式（用户 09-24 要求「两个都要」，各自可绑快捷键）：
 *   · full   —— 隐藏窗口后截整块屏幕（截图菜单里「隐藏窗口截图」的语义）
 *   · region —— 隐藏窗口 → 抓一帧冻结画面 → 铺满该显示器的框选覆盖层 → 按选区裁剪
 *
 * 为什么框选用「冻结帧」而不是「透明覆盖层」：
 *   透明覆盖层的做法要在用户拖框时**实时**看到下面的真实桌面，这要求覆盖层不遮挡内容
 *   （即真的透明 + 下面是别的窗口），在 Windows/macOS 上的合成行为不一致（拖框时会出现
 *   半透明重影、任务栏闪烁、mac 全屏空间异常）。冻结帧是业界通行做法：先把屏幕**拍下来**
 *   当背景铺上，用户对着这张图拖框，坐标可直接用于裁剪，且不会因为别的窗口刷新导致选区错位。
 *
 * 落盘：`userData/screenshots/shot-YYYYMMDD-HHmmss.png`（可在设置页改目录）。
 *
 * ⛔ 本模块只导出纯逻辑 + 注册入口，不 import main.ts（避免模块顶层求值顺序踩 app.setPath 的坑）。
 */

import { BrowserWindow, desktopCapturer, ipcMain, screen, shell, systemPreferences, nativeImage, type Display } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { sanitizeAccelerator } from "./accelerator";

export type ShotMode = "full" | "region";

export type ShotHotkey = { enabled: boolean; accelerator: string };

export type ScreenshotSettings = {
  full: ShotHotkey;
  region: ShotHotkey;
  /** 截图前是否先把自己的窗口藏起来（默认 true = 「隐藏窗口截图」） */
  hideWindow: boolean;
  /** 保存目录；空串 = userData/screenshots（默认） */
  saveDir: string;
};

export type ShotResult =
  | { ok: true; path: string; width: number; height: number; mode: ShotMode }
  | { ok: false; canceled?: boolean; error?: string };

/** 默认快捷键：两个模式默认都开（用户要的就是「有快捷键」），键位尽量避开浏览器常用组合。
 *  ⛔ Ctrl+Shift+S / Ctrl+Shift+A 在浏览器里都有用途（另存为 / 搜索标签页），系统级抢占用户会骂。
 *     所以默认都带 Alt。注册失败（被占用）时不会静默：设置页会显示冲突提示。
 *  hideWindow 默认**不隐藏**（09-24 用户：「万一用户需要截图应用界面呢」）——要纯桌面截图
 *  再去设置页勾「截图前隐藏本应用窗口」。⚠️ 只对没存过设置的用户生效；设置文件里已显式
 *  存了 hideWindow 的（动过设置页就会落盘）保持原值，需去设置页自行取消勾选。 */
export const DEFAULT_SCREENSHOT_SETTINGS: ScreenshotSettings = {
  full: { enabled: true, accelerator: "CommandOrControl+Shift+Alt+A" },
  region: { enabled: false, accelerator: "CommandOrControl+Shift+Alt+S" },
  hideWindow: false,
  saveDir: "",
};

function settingsFile(userData: string): string {
  return path.join(userData, "screenshot-settings.json");
}

export function normalizeScreenshotSettings(raw: any): ScreenshotSettings {
  const d = DEFAULT_SCREENSHOT_SETTINGS;
  const readToggle = (key: ShotMode): ShotHotkey => {
    const value = raw?.[key];
    return {
      // 显式 false 才算关；缺字段用默认
      enabled: value?.enabled === undefined ? d[key].enabled : Boolean(value.enabled),
      accelerator: sanitizeAccelerator(value?.accelerator, d[key].accelerator),
    };
  };
  return {
    full: readToggle("full"),
    region: readToggle("region"),
    hideWindow: raw?.hideWindow === undefined ? d.hideWindow : Boolean(raw.hideWindow),
    saveDir: typeof raw?.saveDir === "string" ? raw.saveDir.trim() : "",
  };
}

export async function readScreenshotSettings(userData: string): Promise<ScreenshotSettings> {
  try {
    return normalizeScreenshotSettings(JSON.parse(await fs.readFile(settingsFile(userData), "utf8")));
  } catch (error: any) {
    if (error?.code !== "ENOENT") console.error("[screenshot] 设置读取失败，用默认值：", error?.message ?? error);
    return { ...DEFAULT_SCREENSHOT_SETTINGS };
  }
}

export async function writeScreenshotSettings(userData: string, patch: Partial<ScreenshotSettings>): Promise<ScreenshotSettings> {
  const current = await readScreenshotSettings(userData);
  const next = normalizeScreenshotSettings({ ...current, ...patch });
  await fs.mkdir(userData, { recursive: true });
  const target = settingsFile(userData);
  const tmp = `${target}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tmp, target);
  return next;
}

/* ── 抓屏 ────────────────────────────────────────────────────────── */

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** mac 上没给「屏幕录制」权限时 getSources 会返回黑帧/空表 —— 提前判掉，给一句能照做的话。 */
export function screenCaptureBlockedReason(): string | null {
  if (process.platform !== "darwin") return null;
  try {
    const status = systemPreferences.getMediaAccessStatus("screen");
    if (status === "denied" || status === "restricted") {
      return "macOS 未授权「屏幕录制」：系统设置 → 隐私与安全性 → 屏幕录制，勾选本应用后重开应用";
    }
  } catch { /* 老版本 Electron / 平台不支持时忽略 */ }
  return null;
}

/** 抓指定显示器的**物理像素**整帧。 */
async function grabDisplay(display: Display): Promise<Electron.NativeImage> {
  const scale = display.scaleFactor || 1;
  const width = Math.max(1, Math.round(display.bounds.width * scale));
  const height = Math.max(1, Math.round(display.bounds.height * scale));
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
  if (!sources.length) throw new Error("没有可用的屏幕源（可能被系统权限拦截）");
  // 优先按 display_id 配对；Windows 上某些驱动不给 display_id，退回「按显示器序号」配对。
  const byId = sources.find((source) => source.display_id && String(source.display_id) === String(display.id));
  const displays = screen.getAllDisplays();
  const index = displays.findIndex((item) => item.id === display.id);
  const picked = byId ?? sources[index >= 0 && index < sources.length ? index : 0] ?? sources[0];
  return picked.thumbnail;
}

function displayForCursor(): Display {
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  } catch {
    return screen.getPrimaryDisplay();
  }
}

async function saveShot(userData: string, image: Electron.NativeImage, saveDir: string): Promise<string> {
  const dir = saveDir.trim() || path.join(userData, "screenshots");
  await fs.mkdir(dir, { recursive: true });
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `shot-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
  const file = path.join(dir, name);
  await fs.writeFile(file, image.toPNG());
  return file;
}

/* ── 框选 + 标注编辑覆盖层 ────────────────────────────────────────── */

type OverlayRect = { x: number; y: number; width: number; height: number };

/**
 * 覆盖层页面 = 拖框选区 + 选区内标注编辑（09-24 用户：截图完不能只是消失，要有编辑功能）。
 *
 * 交互流（与微信/QQ 截图同款）：
 *   ① select 态：拖框建选区（initialRect 非空 = 直接进编辑态，用于全屏模式默认全选）
 *   ② edit   态：选区下方出工具条 —— 画笔/矩形/椭圆/箭头/文字/马赛克 × 5 色 × 撤销，
 *      ✓ 确认（把「底图选区 + 标注层」合成 PNG 回传）/ ↺ 重选 / ✕ 取消
 *
 * ⛔ 分辨率：ink 画布与冻结帧同为**物理像素**（绘制坐标 × scaleFactor），
 *    回传的 PNG 是物理分辨率 —— 不能拿 CSS 像素截图回传（高分屏会糊一半）。
 * ⛔ 内层脚本**不用反引号**（整段嵌在 TS 模板串里），字符串一律单引号拼接。
 */
function overlayHtml(guideDataUri: string, initialRect: OverlayRect | null): string {
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

/** 覆盖层回传：选区 + 合成标注后的 PNG dataURL（确认时才回传；取消 = null）。 */
export type OverlayResult = { rect: OverlayRect; image: string } | null;

/** 打开框选/编辑覆盖层并等结果（取消/超时/关窗 = null）。 */
function pickEdited(display: Display, frame: Electron.NativeImage, initialRect: OverlayRect | null): Promise<OverlayResult> {
  return new Promise((resolve) => {
    const bounds = display.bounds;
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    // ⛔ 编辑器底图必须**物理分辨率**（标注合成后回传的就是它）：不能 resize 到逻辑尺寸，
    //    否则高分屏上确认出的图糊一半。JPEG 92：视觉无损级别，base64 后 1~3MB 可内联。
    let guide = "";
    try {
      guide = `data:image/jpeg;base64,${frame.toJPEG(92).toString("base64")}`;
    } catch {
      guide = "";
    }
    const overlay = new BrowserWindow({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width,
      height,
      show: false,
      frame: false,
      transparent: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      backgroundColor: "#000000",
      webPreferences: {
        preload: path.join(__dirname, "overlay-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        devTools: false,
      },
    });
    // 压过任务栏/其它置顶窗口；mac 上还要允许盖住全屏空间
    overlay.setAlwaysOnTop(true, "screen-saver");
    try { overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* 平台不支持 */ }

    let settled = false;
    const finish = (value: OverlayResult | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMainRemove();
      try { if (!overlay.isDestroyed()) overlay.destroy(); } catch { /* 已销毁 */ }
      resolve(value);
    };
    // 结果从覆盖层的 preload 回来；只认**这个窗口**发的消息（别的窗口发同一通道不算）
    const onResult = (event: Electron.IpcMainEvent, payload: unknown) => {
      if (event.sender !== overlay.webContents) return;
      if (!payload || typeof payload !== "object") { finish(null); return; }
      const raw = payload as { rect?: unknown; image?: unknown };
      const r = raw.rect as OverlayRect | undefined;
      const image = typeof raw.image === "string" && raw.image.startsWith("data:image/png;base64,") ? raw.image : "";
      if (!r || typeof r !== "object") { finish(null); return; }
      const clean = {
        x: Math.max(0, Math.round(Number(r.x) || 0)),
        y: Math.max(0, Math.round(Number(r.y) || 0)),
        width: Math.max(0, Math.round(Number(r.width) || 0)),
        height: Math.max(0, Math.round(Number(r.height) || 0)),
      };
      if (clean.width < 8 || clean.height < 8) { finish(null); return; }
      finish({ rect: clean, image });
    };
    const ipcMainRemove = () => { try { ipcMain.removeListener("screenshot:overlay-result", onResult); } catch { /* noop */ } };
    ipcMain.on("screenshot:overlay-result", onResult);

    // 兜底：用户用 Alt+F4 / 系统方式关掉覆盖层 ⇒ 视为取消，不能把 Promise 吊死
    overlay.on("closed", () => finish(null));
    overlay.webContents.on("will-navigate", (event) => event.preventDefault());
    // 2 分钟没人操作就自动放弃，避免一个看不见的置顶窗口卡住
    const timer = setTimeout(() => finish(null), 120_000);

    void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(overlayHtml(guide, initialRect))}`).then(() => {
      if (overlay.isDestroyed()) return;
      overlay.show();
      overlay.focus();
    }).catch(() => finish(null));
  });
}

/* ── 抓图主流程 ──────────────────────────────────────────────────── */

export type CaptureDeps = {
  /** 需要被藏起来的主窗口（没有就不藏） */
  window: BrowserWindow | null;
  userData: string;
};

/**
 * 执行一次截图（两种模式都先进覆盖层编辑器：选区/标注后确认才出图 —— 09-24 用户：
 * 「截图完不能只是消失，要有编辑功能」。全屏模式默认整屏全选，直接回车即得图）。
 * ⛔ 窗口恢复放在 finally：任何一条失败路径（抓屏报错、用户取消、覆盖层崩）都必须把窗口还回来，
 *    否则用户看到的是「应用凭空消失」。
 */
export async function captureScreenshot(deps: CaptureDeps, mode: ShotMode, settings: ScreenshotSettings): Promise<ShotResult> {
  const blocked = screenCaptureBlockedReason();
  if (blocked) return { ok: false, error: blocked };

  const win = deps.window && !deps.window.isDestroyed() ? deps.window : null;
  const wasVisible = Boolean(win?.isVisible());
  const shouldHide = settings.hideWindow && wasVisible;
  const display = displayForCursor();

  try {
    if (shouldHide) {
      win!.hide();
      // 等窗口真的从合成器上消失再抓屏（太快会把自己的窗口拍进去）
      await delay(260);
    }
    const frame = await grabDisplay(display);

    // 编辑覆盖层：region = 先拖框；full = 默认整屏全选（可缩小重选）
    const initial: OverlayRect | null = mode === "full"
      ? { x: 0, y: 0, width: Math.max(8, display.bounds.width), height: Math.max(8, display.bounds.height) }
      : null;
    const picked = await pickEdited(display, frame, initial);
    if (!picked) return { ok: false, canceled: true };

    // 优先用覆盖层合成好的 PNG（含标注，物理分辨率）；异常缺失时退回按选区裁原帧
    let image: Electron.NativeImage | null = null;
    if (picked.image) {
      try {
        const decoded = nativeImage.createFromDataURL(picked.image);
        if (!decoded.isEmpty()) image = decoded;
      } catch { /* 解码失败走裁剪兜底 */ }
    }
    if (!image) {
      const scale = display.scaleFactor || 1;
      const size = frame.getSize();
      const x = Math.min(Math.max(0, Math.round(picked.rect.x * scale)), Math.max(0, size.width - 1));
      const y = Math.min(Math.max(0, Math.round(picked.rect.y * scale)), Math.max(0, size.height - 1));
      const width = Math.max(1, Math.min(Math.round(picked.rect.width * scale), size.width - x));
      const height = Math.max(1, Math.min(Math.round(picked.rect.height * scale), size.height - y));
      image = frame.crop({ x, y, width, height });
    }

    const file = await saveShot(deps.userData, image, settings.saveDir);
    const size = image.getSize();
    return { ok: true, path: file, width: size.width, height: size.height, mode };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error) };
  } finally {
    if (win && !win.isDestroyed()) {
      // 只还原「本来可见」的窗口；原本就最小化的不要替用户弹出来
      if (shouldHide) { try { win.show(); win.focus(); } catch { /* 窗口在关闭中 */ } }
    }
  }
}

/** 在系统文件管理器里定位截图（失败静默——只是便利功能）。 */
export async function revealShot(file: string): Promise<boolean> {
  try { shell.showItemInFolder(file); return true; } catch { return false; }
}

// ── 全局快捷键：两种模式各一条 ─────────────────────────────────────
/** ⛔ 注册策略与语音热键一致：**先注册新键、成功后才注销旧键**。
 *  反过来（先注销再注册）一旦新键被占用，旧键已没了、新键也没注册上 ⇒ 快捷键两头空。 */
export type HotkeyRegistry = {
  registered: Record<ShotMode, string>;
  apply: (mode: ShotMode, accelerator: string, onFire: () => void) => { ok: boolean; error?: string };
  reset: () => void;
};

export function createHotkeyRegistry(globalShortcut: { register: (a: string, cb: () => void) => boolean; unregister: (a: string) => void }): HotkeyRegistry {
  const registered: Record<ShotMode, string> = { full: "", region: "" };
  return {
    registered,
    apply(mode, accelerator, onFire) {
      try {
        if (!accelerator) {
          if (registered[mode]) { globalShortcut.unregister(registered[mode]); registered[mode] = ""; }
          return { ok: true };
        }
        if (accelerator === registered[mode]) return { ok: true };
        // 两个模式不许共用同一个键（后者注册必然失败，且失败原因不直观）
        const other: ShotMode = mode === "full" ? "region" : "full";
        if (registered[other] && registered[other] === accelerator) {
          return { ok: false, error: `「${accelerator}」已被另一种截图模式占用，请换一个组合键` };
        }
        const ok = globalShortcut.register(accelerator, onFire);
        if (!ok) return { ok: false, error: `快捷键「${accelerator}」注册失败（可能被其它程序占用）` };
        if (registered[mode]) globalShortcut.unregister(registered[mode]);
        registered[mode] = accelerator;
        return { ok: true };
      } catch (error: any) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    reset() {
      for (const mode of ["full", "region"] as ShotMode[]) {
        if (registered[mode]) { try { globalShortcut.unregister(registered[mode]); } catch { /* noop */ } registered[mode] = ""; }
      }
    },
  };
}

/** 给「保存目录」用的默认值（设置页展示当前实际目录）。 */
export function defaultShotDir(userData: string): string {
  return path.join(userData, "screenshots");
}

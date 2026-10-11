/**
 * 550C 启动动画驱动 —— **逐字移植**自 dsh-550c-boot@0.3.3（MIT），仅加 export。
 *
 *   上游：https://github.com/yannicksong0106/dsh-550c-boot
 *   动画与 HTML 原稿：Voidpoket（https://github.com/Voidpoket）
 *   工程与移植：Ziyang Song（https://github.com/yannicksong0106）
 *   许可证：MIT（见 THIRD_PARTY_NOTICES.md）
 *
 * ⛔ 本文件是**移植代码、行为逐字保留**（只加了 `export`）。要改动画请回上游改再重新生成；
 *    就地手改会让「与上游对账」失效。驱动只依赖传入的 stage（shadow 根宿主）与其中的 id，
 *    不碰宿主文档 —— 与上游 `createShow(stage, options)` 契约一致。
 *
 * ⛔ 驱动用到的 id 分属两个标记：简易档只有 BOOT_MARKUP 的 logo；完整档 = BOOT_MARKUP + APP_MARKUP。
 *    见 ./assets.ts 与 ./BootIntro550c.tsx 的挂载逻辑。
 *
 * ⛔ 这里是 `.mjs`（不受 tsc 检查）+ `show.d.mts`（对外类型面），与 src/lib/*.mjs 同款范式：
 *    移植代码零改动、对外类型仍受约束。行为正确性由验收（构建产物真跑）保证，不靠类型。
 */
		export function createShow(stage, options) {
		  const mode = options.mode === 'full' ? 'full' : 'simple';
		  const CANCELLED = options.cancelled;
		  let cancelled = false;
		  const pending = new Set();
		  let clockTimer = null, fpsTimer = null;

		  /** Cancellable sleep: rejects with CANCELLED once the show is skipped. */
		  function sleep(ms) {
		    return new Promise((resolve, reject) => {
		      if (cancelled) { reject(CANCELLED); return; }
		      const entry = { reject: reject, timer: 0 };
		      entry.timer = setTimeout(() => {
		        pending.delete(entry);
		        if (cancelled) reject(CANCELLED); else resolve();
		      }, ms);
		      pending.add(entry);
		    });
		  }

		  /** Cancellable setTimeout for the fire-and-forget beats (path draw-in …). */
		  function later(fn, ms) {
		    const entry = { reject: null, timer: 0 };
		    entry.timer = setTimeout(() => {
		      pending.delete(entry);
		      if (!cancelled) fn();
		    }, ms);
		    pending.add(entry);
		    return entry.timer;
		  }

		  /** Skip: unwind every awaited step, then stop the intervals the show started. */
		  function cancel() {
		    if (cancelled) return;
		    cancelled = true;
		    for (const entry of pending) {
		      clearTimeout(entry.timer);
		      if (entry.reject !== null) entry.reject(CANCELLED);
		    }
		    pending.clear();
		    try { stopCode(); } catch (error) { /* not started yet */ }
		    try { stopLink(); } catch (error) { /* not started yet */ }
		    if (clockTimer !== null) clearInterval(clockTimer);
		    if (fpsTimer !== null) clearInterval(fpsTimer);
		  }

		  /** Run the show; resolves when it has played out, rejects when skipped. */
		  async function start() {
		    if (booting || launched) return;
		    booting = true;
		    const totalMs = playBoot();
		    await sleep(totalMs + 300);
		    if (mode === 'simple') {
		      // Simple mode: the logo draw-in IS the show. One beat on the finished
		      // mark, then the overlay fades.
		      await sleep(600);
		      return;
		    }
		    const boot = $("#boot");
		    if (boot !== null) {
		      boot.classList.add("fade");
		      await sleep(600);
		      if (boot.parentNode) boot.parentNode.removeChild(boot);
		    }
		    const app = $("#app");
		    if (app !== null) app.classList.add("visible");
		    launched = true;
		    await run();
		  }
		"use strict";
		const $ = s => stage.querySelector(s);
		const mainBody = $("#mainBody");
		const codeBody = $("#codeBody");
		/* sleep() comes from the wrapper: cancellable. */
		let booting = false, launched = false;

		/* ===== 开机动画 ===== */
		function playBoot(){
		  const logo = stage.querySelector('#logo');
		  const bootText = stage.querySelector('#bootText');
		  const paths = Array.from(logo.querySelectorAll('path'));

		  paths.forEach(p => {
		    p.style.opacity = '0.08';
		    p.style.clipPath = 'inset(0 0 0 0)';
		    p.style.webkitClipPath = 'inset(0 0 0 0)';
		  });

		  const sorted = paths.map(p => ({el: p, x: p.getBBox().x})).sort((a, b) => a.x - b.x);

		  sorted.forEach((item, i) => {
		    const delay = 250 + i * 300;
		    later(() => {
		      const p = item.el;
		      p.style.clipPath = 'inset(0 100% 0 0)';
		      p.style.webkitClipPath = 'inset(0 100% 0 0)';
		      requestAnimationFrame(() => {
		        requestAnimationFrame(() => {
		          p.style.transition = 'clip-path .6s cubic-bezier(.4,0,.2,1), opacity .35s ease';
		          p.style.opacity = '1';
		          p.style.clipPath = 'inset(0 0 0 0)';
		          p.style.webkitClipPath = 'inset(0 0 0 0)';
		        });
		      });
		    }, delay);
		  });

		  later(() => bootText.classList.add('show'), 2400);
		  const totalMs = 250 + sorted.length * 300 + 400;
		  later(() => logo.classList.add('finished'), totalMs);
		  return totalMs + 600;
		}

		/* ===== 主终端日志 ===== */
		function mainLine(text, cls = ""){
		  const el = document.createElement("div");
		  el.className = "ln " + cls;
		  el.textContent = text;
		  mainBody.appendChild(el);
		  mainBody.scrollTop = mainBody.scrollHeight;
		  return el;
		}
		async function type(text, cls = "", speed = 1){
		  const el = mainLine("", cls);
		  for (let i = 0; i < text.length; i += 3){
		    el.textContent += text.slice(i, i + 3);
		    mainBody.scrollTop = mainBody.scrollHeight;
		    await sleep(speed);
		  }
		  await sleep(4);
		}

		/* ===== 代码流 ===== */
		const CODE = [
		  "// ── PX4 SecureBoot v1.14 ──────────────",
		  "#include <px4_platform_common/px4_config.h>",
		  "#include <px4_platform/crypto/sha256.h>",
		  "#include <mavlink/v2.0/common/mavlink.h>",
		  "",
		  "static const u32 fw_magic = 0x50583431;",
		  "static const u8  root_ca[] = CA_550C_ROOT;",
		  "",
		  "void px4_secure_boot(void){",
		  "    u32 sig = read_reg(BOOT_SIG);",
		  "    if (sig != fw_magic) panic(\"FW_SIG_MISMATCH\");",
		  "    if (verify_signature(IMAG_BASE, IMAG_SIZE, root_ca))",
		  "        jump_kernel();",
		  "    else { set_rollback_slot(SLOT_A); reboot(); }",
		  "}",
		  "",
		  "// ── NuttX RTOS scheduler ──────────────",
		  "void nx_start(void){",
		  "    for (int i = 0; i < CONFIG_MAX_TASKS; i++)",
		  "        g_task[i].state = TSTATE_TASK_INACTIVE;",
		  "    wd_start(&g_wdog, 2000);",
		  "}",
		  "",
		  "// ── PX4 flight control ─────────────────",
		  "void flight_controller(void *arg){",
		  "    while (1) {",
		  "        vehicle_attitude_s att;",
		  "        orb_copy(ORB_ID(vehicle_attitude), att_sub, &att);",
		  "        vehicle_local_position_s pos;",
		  "        orb_copy(ORB_ID(vehicle_local_position), pos_sub, &pos);",
		  "        control_allocator(att, pos);",
		  "        if (safety_check(&pos) != PX4_OK) {",
		  "            set_flight_mode(VEHICLE_MODE_LOITER); continue;",
		  "        }",
		  "        px4_usleep(5000);",
		  "    }",
		  "}",
		  "",
		  "// ── Geofence / NFZ ────────────────────",
		  "static const struct geofence g_nfz[] = {",
		  "    { .lat = 31.2304, .lon = 121.4737, .radius = 2000.0, .type = GF_HARD },",
		  "    { .lat = 39.9042, .lon = 116.4074, .radius = 5000.0, .type = GF_HARD },",
		  "    { .lat = 22.5431, .lon = 114.0579, .radius = 3000.0, .type = GF_HARD },",
		  "};",
		  "",
		  "// ── Security / ARM lockout ─────────────",
		  "void security_init(void){",
		  "    revoke_ca(EXTERNAL_CA_ID);",
		  "    install_ca(CA_550C, CA_550C_LEN);",
		  "    lock_payload(PAYLOAD_DISARM_ONLY);",
		  "    mavlink_signing_enable(MAVLINK_SIGNING_FLAG_SIGN_OUTGOING);",
		  "}",
		  "",
		  "void image_verify(void){",
		  "    sha256_ctx c;",
		  "    sha256_init(&c);",
		  "    sha256_update(&c, IMAG_BASE, IMAG_SIZE);",
		  "    if (!sha256_match(&c, g_expected_hash)) panic(\"HASH_FAIL\");",
		  "}",
		  "/* ── end of PX4 image ── */"
		];
		let codeTimer = null, codeI = 0;
		function pushCodeLine(){
		  const raw = CODE[codeI++ % CODE.length];
		  const el = document.createElement("div");
		  el.className = "cln";
		  if (/^\s*\/\//.test(raw) || /^\s*\/\*/.test(raw)) el.classList.add("cm");
		  el.textContent = raw || " ";
		  codeBody.appendChild(el);
		  while (codeBody.childElementCount > 200) codeBody.removeChild(codeBody.firstChild);
		  codeBody.scrollTop = codeBody.scrollHeight;
		}
		function startCode(ms = 40){ codeTimer = setInterval(pushCodeLine, ms); }
		function setCodeSpeed(ms){ if (!codeTimer) return; clearInterval(codeTimer); codeTimer = setInterval(pushCodeLine, ms); }
		function stopCode(){ if (codeTimer) clearInterval(codeTimer); codeTimer = null; }

		let linkTimer = null;
		function startLink(){
		  const rsrp = $("#h-rsrp"), sinr = $("#h-sinr"), bler = $("#h-bler"), krot = $("#h-krot");
		  linkTimer = setInterval(() => {
		    rsrp.textContent = (-85 - Math.round(Math.random()*8)) + " dBm";
		    sinr.textContent = (18 + Math.random()*8).toFixed(1) + " dB";
		    bler.textContent = (Math.random()*0.8).toFixed(2) + " %";
		    krot.textContent = (180 + Math.round(Math.random()*40)) + " ms";
		  }, 340);
		}
		function stopLink(){ if (linkTimer) clearInterval(linkTimer); }
		function startClock(){ clockTimer = setInterval(() => { const d = new Date(); $("#h-time").textContent = String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")+":"+String(d.getSeconds()).padStart(2,"0"); }, 1000); }
		function startFps(){ fpsTimer = setInterval(() => { $("#b-fps").textContent = (58 + Math.round(Math.random()*4)); }, 700); }

		/* ===== 无人机图标 ===== */
		const NODE_COUNT = 47;
		const UAV_SVG = `<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="14" cy="16" r="11" stroke="currentColor" stroke-width="2.2" fill="none"/><circle cx="50" cy="16" r="11" stroke="currentColor" stroke-width="2.2" fill="none"/><circle cx="14" cy="48" r="11" stroke="currentColor" stroke-width="2.2" fill="none"/><circle cx="50" cy="48" r="11" stroke="currentColor" stroke-width="2.2" fill="none"/><line x1="8" y1="16" x2="20" y2="16" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="11" y1="10" x2="17" y2="22" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="17" y1="10" x2="11" y2="22" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="44" y1="16" x2="56" y2="16" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="47" y1="10" x2="53" y2="22" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="53" y1="10" x2="47" y2="22" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="8" y1="48" x2="20" y2="48" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="11" y1="42" x2="17" y2="54" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="17" y1="42" x2="11" y2="54" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="44" y1="48" x2="56" y2="48" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="47" y1="42" x2="53" y2="54" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="53" y1="42" x2="47" y2="54" stroke="currentColor" stroke-width="1.2" opacity="0.5"/><line x1="20" y1="16" x2="44" y2="16" stroke="currentColor" stroke-width="1.8" opacity="0.7"/><line x1="20" y1="48" x2="44" y2="48" stroke="currentColor" stroke-width="1.8" opacity="0.7"/><ellipse cx="32" cy="32" rx="9" ry="16" stroke="currentColor" stroke-width="2" fill="none"/><line x1="32" y1="16" x2="32" y2="48" stroke="currentColor" stroke-width="1" opacity="0.4"/><circle cx="32" cy="19" r="2" fill="currentColor"/><path d="M 32 12 L 28.5 17 L 35.5 17 Z" fill="currentColor" opacity="0.9"/></svg>`;
		const nodeGrid = $("#nodeGrid");
		const nodeIcons = [];
		function buildNodes(){
		  nodeGrid.innerHTML = ""; nodeIcons.length = 0;
		  for (let i = 0; i < NODE_COUNT; i++){
		    const d = document.createElement("div"); d.className = "uav";
		    const svgWrap = document.createElement("div"); svgWrap.innerHTML = UAV_SVG; svgWrap.style.color = "#e05030";
		    const id = document.createElement("div"); id.className = "id"; id.textContent = "U" + String(i+1).padStart(2,"0");
		    const st = document.createElement("div"); st.className = "st"; st.textContent = "LOST";
		    d.appendChild(svgWrap); d.appendChild(id); d.appendChild(st); nodeGrid.appendChild(d);
		    nodeIcons.push({ el:d, colorEl:svgWrap, st });
		  }
		}
		function setIcon(i, cls, text, color){
		  const ic = nodeIcons[i]; if (!ic) return;
		  ic.el.className = "uav " + cls; ic.colorEl.style.color = color; ic.st.textContent = text;
		}
		function setProgress(p, nodeLabel){
		  p = Math.max(0, Math.min(100, p));
		  $("#b-fill").style.width = p + "%";
		  $("#b-pct").textContent = Math.round(p) + "%";
		  if (nodeLabel) $("#b-node").textContent = nodeLabel;
		}

		/* ===== 窗口系统 ===== */
		const activeWindows = [];
		let zCounter = 500;
		function openWindow(opt){
		  return new Promise(resolve => {
		    const el = document.createElement("div");
		    el.className = "win-popup " + (opt.kind || "");
		    zCounter++;
		    const pos = computePosition(opt.pos, opt.widthHint || 700);
		    el.style.left = pos.x + "px"; el.style.top = pos.y + "px"; el.style.zIndex = zCounter;
		    const title = document.createElement("div");
		    title.className = "wp-title";
		    title.innerHTML = `<span class="wp-ico">${opt.icon||"▣"}</span><span class="wp-name">${opt.name||"WINDOW"}</span><span class="wp-controls"><span class="wp-btn" data-act="min">─</span><span class="wp-btn" data-act="max">□</span><span class="wp-btn" data-act="close">✕</span></span>`;
		    el.appendChild(title);
		    if (opt.kind === "danger"){ const s = document.createElement("div"); s.className = "wp-alert-strip"; el.appendChild(s); }
		    const body = document.createElement("div"); body.className = "wp-body"; body.innerHTML = opt.content || ""; el.appendChild(body);
		    const status = document.createElement("div"); status.className = "wp-status";
		    status.innerHTML = `<span>${opt.status||"READY"}</span><span class="spacer"></span><span class="wp-clock">${nowStr()}</span>`;
		    el.appendChild(status);
		    stage.appendChild(el); activeWindows.push(el);
		    const clockEl = status.querySelector(".wp-clock");
		    const clockTimer = setInterval(() => { if (clockEl) clockEl.textContent = nowStr(); }, 1000);
		    title.querySelector('[data-act="close"]').addEventListener("click", () => closeSelf());
		    requestAnimationFrame(() => el.classList.add("show"));
		    if (typeof opt.onMount === "function") opt.onMount(el, body, status);
		    let closed = false;
		    function closeSelf(){
		      if (closed) return; closed = true;
		      clearInterval(clockTimer);
		      el.classList.remove("show"); el.classList.add("closing");
		      later(() => {
		        el.remove();
		        const i = activeWindows.indexOf(el);
		        if (i >= 0) activeWindows.splice(i, 1);
		        resolve();
		      }, 200);
		    }
		    if (!opt.sticky && opt.duration != null) later(closeSelf, opt.duration);
		    el._close = closeSelf;
		  });
		}
		function computePosition(pos, width){
		  const W = innerWidth, H = innerHeight;
		  const margin = 20, topbarH = 44, botbarH = 44;
		  let x, y;
		  if (pos && typeof pos === "object"){ x = pos.x; y = pos.y; }
		  else if (pos === "center"){ x = W/2 - width/2; y = H/2 - 140; }
		  else if (pos === "tr"){ x = W - width - margin; y = topbarH; }
		  else if (pos === "tl"){ x = margin; y = topbarH; }
		  else if (pos === "br"){ x = W - width - margin; y = H - botbarH - 320; }
		  else if (pos === "l"){ x = margin + randOffset(20); y = H/2 - 180 + randOffset(50); }
		  else {
		    x = margin + Math.random() * Math.max(0, W - width - margin*2);
		    y = topbarH + Math.random() * Math.max(0, H - topbarH - botbarH - 340);
		  }
		  x = Math.max(margin, Math.min(W - width - margin, x));
		  y = Math.max(topbarH, Math.min(H - botbarH - 180, y));
		  return { x, y };
		}
		function randOffset(m){ return Math.round((Math.random() - .5) * m); }
		function nowStr(){
		  const d = new Date();
		  return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")+":"+String(d.getSeconds()).padStart(2,"0");
		}
		function kvRows(pairs){
		  return pairs.map(([k,v,c]) => `<div class="wp-row"><span class="k">${k}</span><span class="v ${c||""}">${v}</span></div>`).join("");
		}
		function miniLog(lines, cls = ""){
		  return `<div class="wp-log ${cls}">${lines.map(l => `<div class="ll ${l.c||""}">${l.t||l}</div>`).join("")}</div>`;
		}

		/* ===== 主流程 ===== */
		async function phaseBoot(){
		  $("#b-stage").textContent = "BOOT";
		  await type("[550C] 核心在线。", "sys");
		  await type("[550C] 量子单元温度 4.2K，经典控制单元就绪。", "sys");
		  await sleep(30);
		  await type("[550C] 检测到无人机集群失控。", "sys");
		  await type("[550C] 链路污染：是。", "sys");
		  await type("[550C] 非法根证书：存在。", "sys");
		  await type("[550C] 任务队列：异常。", "sys");
		  await type("[550C] 安全围栏：被绕过。", "sys");
		  mainLine("");
		  await type("[550C] 等待技术人员授权。", "warn");
		  await sleep(80);
		}

		async function phaseAuth(){
		  $("#b-stage").textContent = "AUTH";
		  await type("> 550C，授权接入 UAV-BS-07 基站。", "cmd", 3);
		  await sleep(60);
		  openWindow({
		    name:"ACCESS AUTHORIZATION", icon:"▲", kind:"normal", pos:"tr", duration:1600, status:"AWAITING CONFIRM",
		    content:`${kvRows([["OPERATOR","TECHNICIAN-01","ok"],["CLEARANCE","LEVEL-5 / ROOT","ok"],["TARGET","UAV-BS-07","warn"],["MODE","OVERRIDE · FORCE","warn"],["SESSION","0x"+Math.random().toString(16).slice(2,8).toUpperCase()]])}<div class="wp-div"></div><div class="wp-note">授权将授予 550C 对 UAV-BS-07 基站及所属无人机集群的完全控制权限。</div><div class="wp-btns"><button class="wp-btn-b">DENY</button><button class="wp-btn-b primary">GRANT</button></div>`
		  });
		  await type("[550C] 授权确认。技术人员身份校验通过。", "sys");
		  await type("[550C] 目标锁定：UAV-BS-07。", "sys");
		  await type("[550C] 接入开始。", "sys");
		  mainLine("");
		}

		async function phaseLink(){
		  $("#b-stage").textContent = "LINK";
		  await type("[550C-INFER] 信号捕获：n78 / n79 双频段。", "inf");
		  await type("[550C-INFER] 小区标识：PCI 207，TAC 4172，Cell ID 0x5A3F。", "inf");
		  await type("[550C-INFER] 链路加密：AES-256-GCM (NEA2)，密钥轮换 200ms。", "inf");
		  await type("[550C-INFER] 完整性保护：NIA2 (AES-CMAC)。", "inf");
		  await type("[550C-INFER] 心跳周期：20ms，HARQ 16 processes。", "inf");
		  mainLine("");
		  openWindow({
		    name:"LINK MONITOR", icon:"◇", kind:"info", pos:"tl", duration:1800, status:"TRACKING",
		    content:`${kvRows([["CELL","PCI 207 / 0x5A3F","ok"],["RRC","CONNECTED","ok"],["CIPHER","NEA2 · AES-256-GCM","ok"],["INTEGRITY","NIA2 · CMAC","ok"],["RTT","2.4 ms"]])}<div class="wp-div"></div><div style="font-size:10px;letter-spacing:.2em;color:var(--text-faint);margin-bottom:6px;">RSRP TRACE</div><div class="wp-wave" id="linkWave"></div>`,
		    onMount: (el, body) => {
		      const wave = body.querySelector("#linkWave"); if (!wave) return;
		      for (let i = 0; i < 48; i++) wave.appendChild(document.createElement("i"));
		      const bars = wave.querySelectorAll("i");
		      const t = setInterval(() => { if (!wave.isConnected){ clearInterval(t); return; } bars.forEach(b => b.style.height = (15 + Math.random()*85) + "%"); }, 90);
		    }
		  });
		  await type("[550C-INFER] 任务队列同步异常，检测到：", "inf");
		  await type("    MAV_CMD_DO_FLIGHTTERMINATION (185) 注入", "sub");
		  await type("    MAV_CMD_NAV_LAND 篡改", "sub");
		  await type("    外部根证书覆盖", "sub");
		  await type("    集群锁死预置", "sub");
		  mainLine("");
		  openWindow({
		    name:"SIGNAL POLLUTION", icon:"!", kind:"danger", pos:"l", duration:1900, status:"THREAT DETECTED",
		    content:`${kvRows([["FLIGHTTERMINATION","185 · INJECTED","bad"],["NAV_LAND","TAMPERED","bad"],["ROOT CA","EXTERNAL OVERRIDE","bad"],["CLUSTER LOCK","PRESET","bad"]])}<div class="wp-div"></div><div style="font-size:10px;letter-spacing:.2em;color:var(--text-faint);margin-bottom:6px;">INTERCEPT LOG</div>${miniLog([{t:"[03:41:22] RX ← 0xDEAD  cmd=185 param=1"},{t:"[03:41:22] RX ← 0xDEAD  NAV_LAND coord=(31.23,121.47)",c:"warn"},{t:"[03:41:23] RX ← 0xDEAD  ROOT_CA inject",c:"bad"},{t:"[03:41:23] RX ← 0xDEAD  CLUSTER_LOCK preset",c:"bad"},{t:"[03:41:24] ERR — unauthorized ca detected",c:"bad"}])}<div class="wp-note">基站调度层已被失控方部分接管。建议立即执行覆写。</div><div class="wp-btns"><button class="wp-btn-b primary">ACKNOWLEDGE</button></div>`
		  });
		  await type("[550C-INFER] 判断：基站调度层已被失控方部分接管。", "inf");
		  await type("[550C-INFER] 时间窗口：T-00:03:41。", "inf");
		  mainLine("");
		}

		async function phaseTunnel(){
		  $("#b-stage").textContent = "TUNNEL";
		  await type("[550C] 建立备用核心网隧道。", "sys");
		  await type("[550C] 源：550C-QUANTUM-0。", "sys");
		  await type("[550C] 目标：BBU 维护口 (F1AP / NGAP)。", "sys");
		  await type("[550C] 隧道建立成功。进入基带处理层。", "sys");
		  mainLine("");
		  await type("[550C-INFER] 鉴权中心根证书异常。签发者未知。", "inf");
		  await type("[550C-INFER] 标准鉴权 5G-AKA 响应签名不匹配。", "inf");
		  await type("[FAIL] 鉴权失败 (Authentication Reject)。", "bad");
		  await sleep(50);
		  openWindow({
		    name:"AUTH BYPASS INJECTION", icon:"▶", kind:"danger", pos:"br", sticky:true, status:"BYPASS · ACTIVE",
		    content:`${kvRows([["AKA","REJECTED","bad"],["BYPASS","ENABLED","warn"],["ROOT CA","550C-ROOT · STAGED","warn"],["PERMISSION","DISPATCH WRITE","ok"]])}<div class="wp-div"></div><div style="font-size:10px;letter-spacing:.2em;color:var(--text-faint);margin-bottom:6px;">INJECTION PROGRESS</div><div class="wp-prog"><div class="f" id="injBar"></div></div><div style="font-size:12px;color:var(--text-dim);" id="injTxt">0%</div><div style="margin-top:10px;font-size:11.5px;color:var(--text-dim);">写入 550C 临时根证书至调度核心……</div>`,
		    onMount: (el, body) => {
		      const bar = body.querySelector("#injBar"); const txt = body.querySelector("#injTxt");
		      let p = 0;
		      const t = setInterval(() => {
		        if (!bar || !bar.isConnected){ clearInterval(t); return; }
		        p += Math.random() * 16; if (p >= 100){ p = 100; clearInterval(t); }
		        bar.style.width = p + "%"; txt.textContent = Math.round(p) + "%";
		      }, 130);
		    }
		  });
		  await type("[550C-INFER] 切换旁路注入。写入 550C 临时根证书。", "inf");
		  await type("[550C] 鉴权旁路成功。获得调度核心写权限。", "sys");
		  mainLine("");
		}

		async function phaseIsolate(){
		  $("#b-stage").textContent = "ISOLATE";
		  await type("[550C] 关闭上行核心网网关 (N3 / N6)。", "sys");
		  await type("[550C] 切断外部非法指令通道。", "sys");
		  await type("[550C] 广播 550C 临时根证书至所有无人机节点。", "sys");
		  $("#h-up").textContent = "SEVERED";
		  $("#b-net").textContent = "ISOLATED";
		  await type("[WARN] 检测到外部重连尝试…… 已拒绝。", "warn");
		  await sleep(40);
		  $("#h-ca").textContent = "550C-ROOT";
		  $("#h-ca").classList.remove("warn"); $("#h-ca").classList.add("ok");
		  await type("[550C-INFER] 基站进入 550C 接管模式。", "inf");
		  mainLine("");
		  await type("[550C] 飞控模式强制切换：LOITER。", "sys");
		  await type("[550C] 载荷控制锁死，仅保留降落必要权限。", "sys");
		  await type("[550C] 解除非法自毁预置，保留安全自毁逻辑。", "sys");
		  mainLine("");
		}

		async function phaseRewrite(){
		  $("#b-stage").textContent = "REWRITE";
		  buildNodes();
		  setCodeSpeed(20);
		  openWindow({
		    name:"OVERRIDE CONTROLLER", icon:"◆", kind:"normal",
		    pos:{x:Math.round(innerWidth*.05), y:Math.round(innerHeight*.14)},
		    sticky:true, status:"REWRITING · 47 NODES",
		    content:`${kvRows([["TARGET","UAV-BS-07"],["NODES","47","warn"],["STRATEGY","FULL ERASE + WRITE"],["ROLLBACK","SLOT_A / SLOT_B"],["AUTH","550C-ROOT","ok"]])}<div class="wp-div"></div><div class="wp-meter"><span class="big" id="ctrCount">00</span><span class="unit">/ 47 NODES</span></div><div class="wp-prog"><div class="f" id="ctrBar"></div></div>`,
		    onMount: (el, body) => {
		      el._updateCounter = (n) => {
		        const c = body.querySelector("#ctrCount"); const b = body.querySelector("#ctrBar");
		        if (c) c.textContent = String(n).padStart(2, "0");
		        if (b) b.style.width = (n/47*100) + "%";
		      };
		    }
		  });
		  await type("[550C] 开始逐节点覆写。", "sys");
		  mainLine("");
		  let anomaly07 = false, anomaly23 = false;
		  for (let i = 0; i < NODE_COUNT; i++){
		    const id = String(i + 1).padStart(2, "0");
		    setIcon(i, "writing", "WRITE", "#ffc043");
		    setProgress(((i + 0.3) / NODE_COUNT) * 100, `${id} / ${NODE_COUNT}`);
		    const cw = activeWindows.find(w => w.querySelector(".wp-name")?.textContent === "OVERRIDE CONTROLLER");
		    if (cw && cw._updateCounter) cw._updateCounter(i + 1);
		    await sleep(8);
		    if (i === 6 && !anomaly07){
		      anomaly07 = true;
		      setIcon(i, "writing", "RESIST", "#e05030");
		      await type("[WARN] 节点 07 反抗，检测到恶意喂狗。", "warn");
		      openWindow({
		        name:"ANOMALY · UAV-07", icon:"⚠", kind:"danger",
		        pos:{x:innerWidth-720, y:140}, duration:1400, status:"HANDLER ACTIVE",
		        content:`${kvRows([["NODE","UAV-07","bad"],["FAULT","WATCHDOG SPOOFING","bad"],["VECTOR","ILLEGAL FEED","bad"],["ACTION","ROLLBACK · SLOT_A","warn"]])}<div class="wp-div"></div>${miniLog([{t:"[14:22:07] wdg: illegal feed detected",c:"warn"},{t:"[14:22:07] wdg: owner mismatch (expected=550C)",c:"bad"},{t:"[14:22:07] inject: force reset",c:"hl"},{t:"[14:22:08] rollback -> SLOT_A"}])}<div class="wp-note">检测到恶意喂狗。已强制回滚至 SLOT_A 并重新覆写。</div>`
		      });
		      await type("[550C] 重置看门狗，强制回滚至 SLOT_A，重新覆写。", "sys");
		      await sleep(80);
		    }
		    if (i === 22 && !anomaly23){
		      anomaly23 = true;
		      setIcon(i, "writing", "CERT FAIL", "#e05030");
		      await type("[WARN] 节点 23 证书校验失败 (NIA2 完整性校验不通过)。", "warn");
		      openWindow({
		        name:"ANOMALY · UAV-23", icon:"⚠", kind:"danger",
		        pos:{x:30, y:innerHeight-420}, duration:1400, status:"HANDLER ACTIVE",
		        content:`${kvRows([["NODE","UAV-23","bad"],["FAULT","CERT VERIFY FAIL","bad"],["CHECK","NIA2 · CMAC","bad"],["ACTION","ROLLBACK · SLOT_B","warn"]])}<div class="wp-div"></div>${miniLog([{t:"[14:22:12] cert: verify sign fail",c:"bad"},{t:"[14:22:12] cert: expected CMAC = 0x3fa8..",c:"warn"},{t:"[14:22:12] cert: got CMAC = 0x91c2..",c:"bad"},{t:"[14:22:12] rollback -> SLOT_B",c:"hl"}])}<div class="wp-note">证书校验失败。已回滚出厂安全固件至 SLOT_B 并重新注入 550C 根证书。</div>`
		      });
		      await type("[550C] 回滚出厂安全固件至 SLOT_B，重新注入 550C 根证书。", "sys");
		      await sleep(80);
		    }
		    setIcon(i, "done", "ONLINE", "#b8c840");
		    setProgress(((i + 1) / NODE_COUNT) * 100, `${id} / ${NODE_COUNT}`);
		    if ((i + 1) % 12 === 0) await type(`[550C] 已完成 ${i + 1} / ${NODE_COUNT} 节点覆写。`, "ok", 1);
		    await sleep(10);
		  }
		  mainLine("");
		  await type("[550C] 全部节点覆写完成。", "ok");
		  await sleep(50);
		  const cw = activeWindows.find(w => w.querySelector(".wp-name")?.textContent === "OVERRIDE CONTROLLER");
		  if (cw && cw._close) cw._close();
		  openWindow({
		    name:"OVERRIDE SUMMARY", icon:"✓", kind:"normal", pos:"center", duration:1500, status:"COMPLETE",
		    content:`<div class="wp-meter"><span class="big">47</span><span class="unit">/ 47 NODES SUCCESS</span></div><div class="wp-div"></div>${kvRows([["TOTAL","47","ok"],["SUCCESS","47","ok"],["ROLLBACK","2","warn"],["ELAPSED","T-00:01:28"]])}<div class="wp-note">所有节点固件覆写完成，已切换至 550C 安全飞控。</div><div class="wp-btns"><button class="wp-btn-b">VIEW LOG</button><button class="wp-btn-b primary">PROCEED</button></div>`
		  });
		}

		async function phaseVerify(){
		  $("#b-stage").textContent = "VERIFY";
		  setCodeSpeed(40);
		  await type("[550C] 逐节点 SHA-256 校验。", "sys");
		  await type("  HASH 3f9a…c210  ✔", "ok", 1);
		  await type("  HASH 88be…41d7  ✔", "ok", 1);
		  await type("  HASH 0c72…9af3  ✔", "ok", 1);
		  await type("  HASH e5d1…77b0  ✔", "ok", 1);
		  await type("  HASH a4c8…2d19  ✔", "ok", 1);
		  await type("[550C] 哈希匹配。", "sys");
		  mainLine("");
		  await type("[550C] 集群状态稳定。", "sys");
		}

		async function phaseArm(){
		  $("#b-stage").textContent = "DISARM";
		  mainLine("");
		  await type("[550C] ⚠ 执行紧急动力关闭程序。", "warn");
		  await sleep(40);
		  openWindow({
		    name:"EMERGENCY DISARM", icon:"⏻", kind:"danger", pos:"center", duration:1700, status:"CONFIRMATION REQUIRED",
		    content:`<div class="wp-meter"><span class="big" style="color:var(--red-b)">47</span><span class="unit">MOTORS WILL BE DISARMED</span></div><div class="wp-div"></div>${kvRows([["COMMAND","MAV_CMD_ARM_DISARM (400)"],["PARAM1","0 · DISARM","bad"],["PARAM2","0 · NORMAL"],["TARGET","ALL NODES · 47","warn"]])}<div class="wp-note">紧急关车将切断所有无人机电机动力。此操作不可逆。</div><div class="wp-btns"><button class="wp-btn-b">ABORT</button><button class="wp-btn-b primary">CONFIRM</button></div>`
		  });
		  await type("[550C] 发送 MAV_CMD_COMPONENT_ARM_DISARM (400) 至所有节点。", "warn");
		  await type("[550C] 参数：param1=0 (DISARM), param2=0 (Normal)。", "warn");
		  await sleep(60);
		  await type("[550C] 等待 COMMAND_ACK 确认……", "warn");
		  await sleep(80);
		  await type("[550C] 节点 01-47：COMMAND_ACK.result = MAV_RESULT_ACCEPTED。", "ok");
		  await type("[550C] 所有电机已 disarm。", "ok");
		  await type("[550C] 动力系统紧急关闭完成。", "ok");
		  await type("[550C] 所有无人机进入安全锁定状态。", "ok");
		  mainLine("");
		  await type("[550C] 基站日志写入完成。", "sys");
		  await type("[550C] 操作者：技术人员。", "sys");
		  await type("[550C] 授权：550C。", "sys");
		  await type("[550C] 结果：成功。", "sys");
		  mainLine("");
		}

		async function phaseFinish(){
		  stopCode(); stopLink();
		  setProgress(100, "47 / 47");
		  $("#b-stage").textContent = "COMPLETE";
		  $("#h-up").textContent = "550C-CTRL";
		  $("#h-up").classList.remove("warn"); $("#h-up").classList.add("ok");
		  $("#b-net").textContent = "550C";
		  await type("[550C] 系统标识更新。", "sys", 4);
		  await sleep(80);
		  for (let i = 3; i >= 0; i--){ mainLine(`[T-00:00:0${i}]`, "t"); await sleep(160); }
		  activeWindows.forEach(w => { if (w._close) w._close(); });
		  await sleep(200);
		  $("#final").classList.add("show");
		  await sleep(900);
		}

		async function run(){
		  const sid = "0x" + Math.random().toString(16).slice(2,10).toUpperCase();
		  $("#h-session").textContent = sid;
		  setProgress(0, "00 / 47");
		  startClock(); startFps(); startLink(); startCode(45); buildNodes();
		  await phaseBoot();
		  await phaseAuth();
		  await phaseLink();
		  await phaseTunnel();
		  await phaseIsolate();
		  await phaseRewrite();
		  await phaseVerify();
		  await phaseArm();
		  await phaseFinish();
		}
		  return { start: start, cancel: cancel };
		}

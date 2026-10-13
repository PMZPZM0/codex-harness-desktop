/**
 * 更新体系的两项**真实**验证（不是读代码推断，是建目录、造归档、真跑）：
 *   甲 · 快照与回滚（update-safety）：更新失败 ⇒ 组件回到更新前的确定状态，不留半成品
 *   乙 · tar 归档解包（update-tar）：路径穿越/符号链接类恶意条目必须被挡下
 *
 * 为什么单独立这个脚本而不用静态守卫：这两块是「出错代价最高、最需要实证」的部分 ——
 *   · 回滚失败 = 用户技能/插件停在半更新状态，比更新失败本身更糟；
 *   · 解包拦截失败 = 归档可以把文件写到任意位置（这是 tar 史上真实出过 CVE 的一类）。
 *   ⛔ 守卫只能证明「代码里写了检查」，这里证明「检查真的生效」。
 *
 * ⛔ 在**编译产物** dist-electron/ 上验证（与用户实例跑的是同一份代码）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) { pass += 1; console.log("  ✓ " + label); }
  else { fail += 1; console.log("  ✗ " + label); }
};

const distSafety = new URL("../dist-electron/update-safety.js", import.meta.url);
const distTar = new URL("../dist-electron/update-tar.js", import.meta.url);
if (!fs.existsSync(distSafety)) {
  console.error("找不到编译产物 dist-electron/ —— 请先 npm run build:electron");
  process.exit(1);
}
const { dirFingerprint, withRollback } = await import(distSafety.href);
const { extractTarGz } = await import(distTar.href);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uq-"));
const userData = path.join(tmp, "userData");

console.log("【甲 · 快照与回滚】");
{
  const target = path.join(tmp, "skill-demo");
  fs.mkdirSync(path.join(target, "sub"), { recursive: true });
  fs.writeFileSync(path.join(target, "SKILL.md"), "body v1");
  fs.writeFileSync(path.join(target, "sub", "helper.txt"), "helper v1");
  const fp1 = await dirFingerprint(target);

  fs.writeFileSync(path.join(target, "SKILL.md"), "touched");
  const fp2 = await dirFingerprint(target);
  ok(fp1 !== fp2, "内容改写 ⇒ 指纹变化（幂等判据有效）");
  fs.writeFileSync(path.join(target, "SKILL.md"), "body v1");
  ok((await dirFingerprint(target)) === fp1, "内容改回 ⇒ 指纹复原（目录名/时间不进指纹）");

  let threw = "";
  try {
    await withRollback({
      targetDir: target, userData, id: "market-skill/demo",
      run: async () => {
        // 模拟「装到一半失败」：覆盖主文件 + 删掉子目录，然后抛错
        fs.writeFileSync(path.join(target, "SKILL.md"), "half-written");
        fs.rmSync(path.join(target, "sub"), { recursive: true, force: true });
        throw new Error("网络中断（模拟）");
      },
    });
  } catch (error) { threw = String(error?.message ?? error); }
  ok(/网络中断/.test(threw), "失败如实抛出原始错误（不吞堆栈信息）");
  ok(/已自动回滚/.test(threw), "错误文案明确告知用户「已自动回滚」");
  ok((await dirFingerprint(target)) === fp1, "目标目录恢复到更新前状态（不留半更新）");
  ok(fs.existsSync(path.join(target, "sub", "helper.txt")), "过程中被删的子目录一并恢复");

  const done = await withRollback({
    targetDir: target, userData, id: "market-skill/demo",
    run: async () => { fs.writeFileSync(path.join(target, "SKILL.md"), "upgraded"); return "ok"; },
  });
  ok(done.value === "ok" && done.rolledBack === false, "成功路径正常返回值、不触发回滚");

  // ⛔ 拿不到回滚点 ⇒ 拒绝动手（用「父路径是文件」制造必然失败，跨平台可复现）
  const badRoot = path.join(tmp, "not-a-dir");
  fs.writeFileSync(badRoot, "x");
  let blocked = "";
  try {
    await withRollback({ targetDir: target, userData: badRoot, id: "x", run: async () => "should not run" });
  } catch (error) { blocked = String(error?.message ?? error); }
  ok(/已放弃本次更新/.test(blocked), "⛔ 建不了回滚点 ⇒ 拒绝动手（不会留下无法回退的更新）");
}

console.log("【乙 · 归档解包安全】");
{
  /** 手工拼一个最小 ustar 块（覆盖 name / size / typeflag / checksum 四个必要字段即可）。 */
  const tarEntry = (name, content, typeflag = "0") => {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write("000644 \0", 100, 8, "utf8");
    header.write("000000 \0", 108, 8, "utf8");
    header.write("000000 \0", 116, 8, "utf8");
    header.write((content.length.toString(8) + "\0").padStart(12, "0"), 124, 12, "utf8");
    header.write("00000000000\0", 136, 12, "utf8");
    header.write("        ", 148, 8, "utf8");
    header.write(typeflag, 156, 1, "utf8");
    header.write("ustar\0" + "00", 257, 8, "utf8");
    // 校验和字段（显式算一次，避免某些实现依赖它）
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write((sum.toString(8).padStart(6, "0") + "\0 "), 148, 8, "utf8");
    const body = Buffer.alloc(Math.ceil(content.length / 512) * 512);
    Buffer.from(content, "utf8").copy(body);
    return Buffer.concat([header, body]);
  };

  const evil = Buffer.concat([
    tarEntry("plugin-dir/plugin.yaml", "version: 9.9.9\n"),
    tarEntry("plugin-dir/skills/a/SKILL.md", "---\nname: a\n---\nok\n"),
    tarEntry("../../../../Windows/Temp/pwned.txt", "pwned"),        // 路径穿越
    tarEntry("/absolute/outside.txt", "pwned"),                      // 绝对路径
    tarEntry("plugin-dir/link.sh", "evil", "2"),                     // 符号链接
  ]);
  const archive = zlib.gzipSync(evil);
  const dest = path.join(tmp, "unpack");
  const result = await extractTarGz(archive, dest);

  ok(result.files === 2, `普通文件照常解出（${result.files} 个）`);
  ok(fs.existsSync(path.join(dest, "plugin-dir", "plugin.yaml")), "归档内的合法路径已落盘");
  ok(fs.existsSync(path.join(dest, "plugin-dir", "skills", "a", "SKILL.md")), "嵌套目录结构保留");
  ok(!fs.existsSync(path.join(tmp, "Windows", "Temp", "pwned.txt")), "⛔ 路径穿越条目被拦下（没写到目标目录外）");
  ok(result.skipped >= 3, `危险/不受支持的条目被跳过并**回传给调用方**（${result.skipped} 条，不静默丢弃）`);
  ok(result.skippedNames.every((name) => typeof name === "string" && name.length > 0), "被跳过的条目都带名字（事后可查）");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("");
console.log(fail === 0 ? `更新体系实证：全部通过（${pass}/${pass}）` : `更新体系实证：${fail} 项未通过（共 ${pass + fail} 项）`);
process.exit(fail === 0 ? 0 : 1);

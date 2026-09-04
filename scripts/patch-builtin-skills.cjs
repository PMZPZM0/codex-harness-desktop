// 内置技能接线补丁
const fs = require("fs");
let s = fs.readFileSync("electron/main.ts", "utf8");

// 1) import（挂在 toolchain import 行后面）
const impAnchor = 'import { bundledNode, cloakCacheDir, cloakOpenHelper, nuphusBinary, npmGlobalRoot, toolchainEnv, toolsRoot } from "./toolchain";';
if (!s.includes(impAnchor)) { console.log("IMP ANCHOR MISSING"); process.exit(1); }
if (!s.includes("ensureBuiltinSkills")) s = s.replace(impAnchor, impAnchor + '\nimport { ensureBuiltinSkills } from "./builtin-skills";');

// 2) 启动时写入
const readyAnchor = "app.whenReady().then(async () => {\n  await fs.mkdir(codexHome, { recursive: true });";
if (!s.includes(readyAnchor)) { console.log("READY ANCHOR MISSING"); process.exit(1); }
if (!s.includes("await ensureBuiltinSkills(")) s = s.replace(readyAnchor, readyAnchor + "\n  await ensureBuiltinSkills(userSkillsDir);");

fs.writeFileSync("electron/main.ts", s);
console.log("builtin skills wired:", s.includes("ensureBuiltinSkills"));

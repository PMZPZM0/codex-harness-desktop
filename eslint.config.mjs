/**
 * 最小 eslint（2026-09-24，评估报告 P1-6）：当前只承载「分层红线」——
 * 把守卫【130】的结构规则变成编辑器内可见的红。质量保障主力仍是
 * scripts/guards/ + tsc + check-bag-types（本项目自研闸门），lint 渐进启用。
 *
 * 运行：npm run lint
 * ⛔ 未接入 npm run check / verify：全仓首次启用必然海量噪音，按域逐步放行后再收紧。
 */
// @ts-check
import { readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)));

/** 域目录 = src/features/ 下的直接子目录（shared 除外——它是基座）。动态枚举，新增域自动覆盖。 */
const domains = readdirSync(join(ROOT, "src", "features"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "shared")
  .map((e) => e.name);

/** 其它域 = 可被 no-restricted-imports 点名的域（app-view 是组装层，消费它的 types/barrel 属现行设计）。 */
const otherDomains = domains.filter((d) => d !== "app-view");

export default [
  { plugins: { "react-hooks": reactHooks } },
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "dist-electron/**",
      "archive/**",
      "release*/**",
      "resources/**",
      "build/**",
      "scripts/archive/**",
      "docs/**",
      ".workbuddy/**",
      ".e2e-profile/**",
    ],
  },
  {
    files: ["src/**/*.{ts,tsx,mts}", "electron/**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", parser: tsParser },
    rules: {
      // 与 tsc 职责重叠的不设；这里只放 tsc 管不了/项目当前真正在意的最小集
      "no-const-assign": "error",
    },
  },
  // 规则①（基座 → 域）：基座文件里禁 import 任何域
  {
    files: ["src/lib/**/*.{ts,tsx,mts}", "src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/features/shared/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: domains.flatMap((d) => [
            {
              group: [`**/features/${d}`, `**/features/${d}/**`],
              message: `分层红线【130】：基座不得 import 域「${d}」。基座只被域消费；需要反向能力请上移到 features/shared/ 或经 props 注入。`,
            },
          ]),
        },
      ],
    },
  },
  // 规则②（域 → 域禁深链）：域文件里禁 import 其它域的内部文件（barrel 除外）
  ...domains.map((d) => ({
    files: [`src/features/${d}/**/*.{ts,tsx}`],
    ignores: [`src/features/${d}/index.ts`],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: otherDomains
            .filter((other) => other !== d)
            .flatMap((other) => [
              {
                group: [`**/features/${other}/*`, `**/features/${other}/*/**`],
                message: `分层红线【130】：禁止深链域「${other}」内部文件，只允许走其 barrel（../${other}）。`,
              },
            ]),
        },
      ],
    },
  })),
];

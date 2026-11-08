import test from "node:test";
import assert from "node:assert/strict";
import { effortLabels } from "../src/lib/effort-labels.ts";
import { EFFORT_ORDER, effortLevelsForModel, matchModelSpec, setExternalSpecs } from "../src/lib/model-specs.ts";

/** 11-08 审查：规格表里有 max 档（DeepSeek / GPT-6.1 等），标签表缺它 ⇒ 菜单显示英文「max」。 */
test("effortLabels 覆盖 EFFORT_ORDER 每一档", () => {
  for (const level of EFFORT_ORDER) {
    assert.ok(effortLabels[level], `缺档位标签：${level}`);
  }
});

/** 11-08 审查：外部规则（userData/model-specs.json）只给 contextWindow 时，
 *  原来会把 efforts 覆盖成 [] ⇒ 档位静默回落到「低中高」三档。必须沿用内置档位。 */
test("外部规则只给 contextWindow 时不砍档位；明确给了 efforts 才覆盖", () => {
  try {
    setExternalSpecs([{ match: "^gpt-6\\.1-sol$", contextWindow: 200_000 }]);
    const spec = matchModelSpec("gpt-6.1-sol");
    assert.equal(spec.contextWindow, 200_000);
    assert.deepEqual(effortLevelsForModel("gpt-6.1-sol"), ["low", "medium", "high", "xhigh", "max"]);

    setExternalSpecs([{ match: "^gpt-6\\.1-sol$", contextWindow: 200_000, efforts: ["low", "high"] }]);
    assert.deepEqual(effortLevelsForModel("gpt-6.1-sol"), ["low", "high"]);
  } finally {
    setExternalSpecs([]);
  }
});

/** 外部规则命中内置没有的模型时，仍按外部规则整份生效（保持原行为）。 */
test("外部规则命中未知模型时整份生效", () => {
  try {
    setExternalSpecs([{ match: "^my-private-model$", contextWindow: 64_000, efforts: ["low"] }]);
    const spec = matchModelSpec("my-private-model");
    assert.equal(spec.contextWindow, 64_000);
    assert.deepEqual(spec.efforts, ["low"]);
  } finally {
    setExternalSpecs([]);
  }
});

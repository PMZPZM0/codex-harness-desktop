/**
 * expert-teams 的「team-default」部分（09-22 从同目录 expert-teams.ts 按顶层声明分出，纯搬迁、零改写）。
 * ⛔ 逻辑与原地逐字一致，只补了顶部 import 与 `export`。
 */
import type { ExpertTeamConfig } from "./01-team-types";
import { softwareDevTeam } from ".//08-software-dev-team";
import { tradingAnalysisTeam } from ".//09-trading-analysis-team";
import { contentCreationTeam } from ".//10-content-creation-team";
import { dataAnalysisTeam } from ".//11-data-analysis-team";
import { marketingGrowthTeam } from ".//12-marketing-growth-team";
import { productDesignTeam } from ".//13-product-design-team";
export function buildDefaultExpertTeams(): ExpertTeamConfig[] {  const now = new Date().toISOString();
  const mk = (partial: any): ExpertTeamConfig => ({ ...partial, createdAt: now, updatedAt: now, enabled: true });

  return [
    softwareDevTeam(mk),
    tradingAnalysisTeam(mk),
    contentCreationTeam(mk),
    dataAnalysisTeam(mk),
    marketingGrowthTeam(mk),
    productDesignTeam(mk),
  ];
}

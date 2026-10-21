export type ProvisionState = "ok" | "skipped" | "failed" | "needs-action";

export type ProvisionStep = { id: string; state: ProvisionState; detail: string };

export type CloudProvisionReport = {
  ok: boolean;
  code: string;
  steps: ProvisionStep[];
  models: { ok: boolean; count: number; error: string } | null;
  kb: { ok: boolean; state: ProvisionState; detail: string } | null;
  memory: { ok: boolean; state: ProvisionState; detail: string } | null;
  activated: boolean;
  activeModel: string;
};

export function emptyProvisionReport(): CloudProvisionReport;

export function provisionCloud(
  api: any,
  options?: { activate?: boolean; onlyIfEmpty?: boolean; restartIfActive?: boolean },
): Promise<CloudProvisionReport>;

export function provisionSummary(report: CloudProvisionReport | null): string;

/** 工作伙伴群模板（本地 localStorage；纯变换可跑真值表）。 */
export declare const TEMPLATES_KEY: string;
export declare const MAX_TEMPLATES: number;
export type TeamTemplate = {
  id: string;
  name: string;
  members: Array<{ id: string; kind: string; name: string; targetKind: string; targetKey: string; targetProfession: string }>;
  memory: string;
  rules: string;
  workspace: string;
  savedAt: number;
};
export declare function templateFromGroup(group: unknown): TeamTemplate;
export declare function templateToCreateInput(t: unknown): { name: string; memory: string; rules: string; workspace: string; members: Array<Record<string, unknown>> };
export declare function listTemplates(): TeamTemplate[];
export declare function saveTemplate(tpl: unknown): TeamTemplate[];
export declare function removeTemplate(name: unknown): TeamTemplate[];

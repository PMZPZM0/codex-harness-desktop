export type TeamPhaseTask = {
  memberId?: string;
  query?: string;
};

export function dedupeTeamPhaseTasks(tasks: unknown): TeamPhaseTask[];

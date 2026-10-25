export type UserPersona = { id: string; label: string; occupation: string; userContext: string; tools: string[] };
export declare const USER_PERSONAS: UserPersona[];
export declare function userPersonaFields(personaId: string): { occupation: string; userContext: string } | null;

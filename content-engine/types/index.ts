export interface Idea {
  id: string;
  title: string;
  hook: string;
  script_outline: string;
  caption: string;
  cta: string;
  affiliate_angle: string;
}

export type ColumnId = 'Ideas' | 'Scripted' | 'Filmed' | 'Posted' | 'Monetized';

export type KanbanBoard = Record<ColumnId, Idea[]>;

export const COLUMNS: ColumnId[] = ['Ideas', 'Scripted', 'Filmed', 'Posted', 'Monetized'];

export interface GenerateRequest {
  topic: string;
  audience: string;
  tone: string;
  goal: string;
}

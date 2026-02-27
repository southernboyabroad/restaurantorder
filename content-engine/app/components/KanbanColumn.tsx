'use client';

import { Droppable } from '@hello-pangea/dnd';
import IdeaCard from './IdeaCard';
import type { Idea, ColumnId } from '@/types';

const COLUMN_COLORS: Record<ColumnId, string> = {
  Ideas: 'bg-indigo-50 border-indigo-100',
  Scripted: 'bg-amber-50 border-amber-100',
  Filmed: 'bg-teal-50 border-teal-100',
  Posted: 'bg-blue-50 border-blue-100',
  Monetized: 'bg-green-50 border-green-100',
};

const HEADER_COLORS: Record<ColumnId, string> = {
  Ideas: 'text-indigo-600',
  Scripted: 'text-amber-600',
  Filmed: 'text-teal-600',
  Posted: 'text-blue-600',
  Monetized: 'text-green-600',
};

interface KanbanColumnProps {
  columnId: ColumnId;
  ideas: Idea[];
  onRemove: (id: string) => void;
}

export default function KanbanColumn({ columnId, ideas, onRemove }: KanbanColumnProps) {
  return (
    <div className={`flex flex-col rounded-2xl border ${COLUMN_COLORS[columnId]} min-h-[300px] min-w-[200px] flex-1`}>
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <span className={`text-sm font-semibold ${HEADER_COLORS[columnId]}`}>{columnId}</span>
        <span className="text-xs text-gray-400 font-medium">{ideas.length}</span>
      </div>

      <Droppable droppableId={columnId}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 flex flex-col gap-2 px-3 pb-3 pt-1 rounded-b-2xl transition-colors
              ${snapshot.isDraggingOver ? 'bg-white/60' : ''}
            `}
          >
            {ideas.map((idea, index) => (
              <IdeaCard key={idea.id} idea={idea} index={index} onRemove={onRemove} />
            ))}
            {provided.placeholder}

            {ideas.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-xs text-gray-300 text-center py-4">Drop here</p>
              </div>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}

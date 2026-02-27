'use client';

import { Draggable } from '@hello-pangea/dnd';
import type { Idea } from '@/types';

interface IdeaCardProps {
  idea: Idea;
  index: number;
  onRemove: (id: string) => void;
}

export default function IdeaCard({ idea, index, onRemove }: IdeaCardProps) {
  return (
    <Draggable draggableId={idea.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`bg-white rounded-xl border border-gray-100 p-3 shadow-sm select-none transition
            ${snapshot.isDragging ? 'shadow-md ring-2 ring-indigo-300 rotate-1' : 'hover:shadow-md'}
          `}
        >
          <p className="text-sm font-semibold text-gray-900 mb-1 leading-snug">{idea.title}</p>
          <p className="text-xs text-gray-500 line-clamp-2">{idea.hook}</p>

          <button
            onClick={() => onRemove(idea.id)}
            aria-label="Remove card"
            className="mt-2 text-xs text-gray-300 hover:text-red-400 transition float-right"
          >
            ✕
          </button>
        </div>
      )}
    </Draggable>
  );
}

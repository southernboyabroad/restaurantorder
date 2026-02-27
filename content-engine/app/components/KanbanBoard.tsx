'use client';

import { useEffect, useState, useCallback } from 'react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import KanbanColumn from './KanbanColumn';
import type { Idea, ColumnId, KanbanBoard as KanbanBoardType } from '@/types';
import { COLUMNS } from '@/types';

const STORAGE_KEY = '3aday-kanban';

function emptyBoard(): KanbanBoardType {
  return { Ideas: [], Scripted: [], Filmed: [], Posted: [], Monetized: [] };
}

function loadBoard(): KanbanBoardType {
  if (typeof window === 'undefined') return emptyBoard();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyBoard();
    return JSON.parse(raw) as KanbanBoardType;
  } catch {
    return emptyBoard();
  }
}

function saveBoard(board: KanbanBoardType) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
  } catch {
    // localStorage unavailable — silently skip
  }
}

interface KanbanBoardProps {
  pendingIdea: Idea | null;
  onIdeaConsumed: (id: string) => void;
}

export default function KanbanBoard({ pendingIdea, onIdeaConsumed }: KanbanBoardProps) {
  const [board, setBoard] = useState<KanbanBoardType>(emptyBoard);

  // Hydrate from localStorage after mount
  useEffect(() => {
    setBoard(loadBoard());
  }, []);

  // Persist whenever board changes
  useEffect(() => {
    saveBoard(board);
  }, [board]);

  // Receive new ideas from the results panel
  useEffect(() => {
    if (!pendingIdea) return;
    setBoard((prev) => {
      // Prevent duplicates
      const alreadyIn = COLUMNS.some((col) => prev[col].some((i) => i.id === pendingIdea.id));
      if (alreadyIn) return prev;
      return { ...prev, Ideas: [...prev.Ideas, pendingIdea] };
    });
    onIdeaConsumed(pendingIdea.id);
  }, [pendingIdea, onIdeaConsumed]);

  const handleDragEnd = useCallback((result: DropResult) => {
    const { source, destination } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;

    const srcCol = source.droppableId as ColumnId;
    const dstCol = destination.droppableId as ColumnId;

    setBoard((prev) => {
      const srcItems = [...prev[srcCol]];
      const [moved] = srcItems.splice(source.index, 1);

      if (srcCol === dstCol) {
        srcItems.splice(destination.index, 0, moved);
        return { ...prev, [srcCol]: srcItems };
      }

      const dstItems = [...prev[dstCol]];
      dstItems.splice(destination.index, 0, moved);
      return { ...prev, [srcCol]: srcItems, [dstCol]: dstItems };
    });
  }, []);

  const handleRemove = useCallback((id: string) => {
    setBoard((prev) => {
      const next = { ...prev } as KanbanBoardType;
      for (const col of COLUMNS) {
        next[col] = prev[col].filter((i) => i.id !== id);
      }
      return next;
    });
  }, []);

  const totalCards = COLUMNS.reduce((sum, col) => sum + board[col].length, 0);

  return (
    <section>
      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="text-lg font-semibold text-gray-800">Content Board</h2>
        <span className="text-sm text-gray-400">{totalCards} card{totalCards !== 1 ? 's' : ''}</span>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {COLUMNS.map((col) => (
            <KanbanColumn
              key={col}
              columnId={col}
              ideas={board[col]}
              onRemove={handleRemove}
            />
          ))}
        </div>
      </DragDropContext>
    </section>
  );
}

'use client';

import type { Idea } from '@/types';

interface ResultsDisplayProps {
  ideas: Idea[];
  onAddToBoard: (idea: Idea) => void;
  addedIds: Set<string>;
}

export default function ResultsDisplay({ ideas, onAddToBoard, addedIds }: ResultsDisplayProps) {
  if (ideas.length === 0) return null;

  return (
    <section>
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Generated Ideas</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {ideas.map((idea) => {
          const added = addedIds.has(idea.id);
          return (
            <div
              key={idea.id}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col gap-3"
            >
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-indigo-500">Title</span>
                <p className="mt-0.5 text-sm font-semibold text-gray-900">{idea.title}</p>
              </div>

              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-pink-500">Hook</span>
                <p className="mt-0.5 text-sm text-gray-700">{idea.hook}</p>
              </div>

              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-amber-500">Script Outline</span>
                <p className="mt-0.5 text-sm text-gray-700 whitespace-pre-line">{idea.script_outline}</p>
              </div>

              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-teal-500">Caption</span>
                <p className="mt-0.5 text-sm text-gray-700">{idea.caption}</p>
              </div>

              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-purple-500">CTA</span>
                <p className="mt-0.5 text-sm text-gray-700">{idea.cta}</p>
              </div>

              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-green-500">Affiliate Angle</span>
                <p className="mt-0.5 text-sm text-gray-700">{idea.affiliate_angle}</p>
              </div>

              <button
                onClick={() => onAddToBoard(idea)}
                disabled={added}
                className="mt-auto w-full py-2 rounded-lg text-sm font-medium transition
                  bg-indigo-50 text-indigo-700 hover:bg-indigo-100
                  disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {added ? 'Added to Board ✓' : 'Add to Board'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}

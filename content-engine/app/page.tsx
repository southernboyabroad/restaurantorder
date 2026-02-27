'use client';

import { useState, useCallback } from 'react';
import IdeaForm from './components/IdeaForm';
import ResultsDisplay from './components/ResultsDisplay';
import KanbanBoard from './components/KanbanBoard';
import type { Idea, GenerateRequest } from '@/types';

export default function Home() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [pendingIdea, setPendingIdea] = useState<Idea | null>(null);

  async function handleGenerate(data: GenerateRequest) {
    setLoading(true);
    setError(null);
    setIdeas([]);
    setAddedIds(new Set());

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? 'Something went wrong. Please try again.');
        return;
      }

      setIdeas(json.ideas as Idea[]);
    } catch {
      setError('Network error — please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleAddToBoard(idea: Idea) {
    setPendingIdea(idea);
  }

  const handleIdeaConsumed = useCallback((id: string) => {
    setAddedIds((prev) => new Set(prev).add(id));
    setPendingIdea(null);
  }, []);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-10 flex flex-col gap-10">

        {/* Header */}
        <header>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
            3-A-Day Content Engine
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Generate 3 TikTok ideas, build your scripts, and track every video from idea to monetized.
          </p>
        </header>

        {/* Idea Generation Form */}
        <IdeaForm onSubmit={handleGenerate} loading={loading} />

        {/* Error */}
        {error && (
          <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 h-64 animate-pulse">
                <div className="h-3 bg-gray-100 rounded w-1/3 mb-3" />
                <div className="h-4 bg-gray-100 rounded w-2/3 mb-6" />
                <div className="h-3 bg-gray-100 rounded w-1/4 mb-2" />
                <div className="h-4 bg-gray-100 rounded w-full mb-4" />
                <div className="h-3 bg-gray-100 rounded w-1/4 mb-2" />
                <div className="h-4 bg-gray-100 rounded w-5/6" />
              </div>
            ))}
          </div>
        )}

        {/* Results */}
        {!loading && ideas.length > 0 && (
          <ResultsDisplay ideas={ideas} onAddToBoard={handleAddToBoard} addedIds={addedIds} />
        )}

        {/* Kanban board — always visible */}
        <KanbanBoard pendingIdea={pendingIdea} onIdeaConsumed={handleIdeaConsumed} />
      </div>
    </main>
  );
}

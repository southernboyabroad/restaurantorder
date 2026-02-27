'use client';

import { useState } from 'react';
import type { GenerateRequest } from '@/types';

const TONES = ['Bold', 'Soft', 'Educational', 'Entertaining', 'Contrarian'];
const GOALS = ['Grow followers', 'Drive affiliate sales', 'Build authority'];

interface IdeaFormProps {
  onSubmit: (data: GenerateRequest) => void;
  loading: boolean;
}

export default function IdeaForm({ onSubmit, loading }: IdeaFormProps) {
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState('');
  const [tone, setTone] = useState(TONES[0]);
  const [goal, setGoal] = useState(GOALS[0]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || !audience.trim()) return;
    onSubmit({ topic: topic.trim(), audience: audience.trim(), tone, goal });
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h2 className="text-lg font-semibold text-gray-800 mb-5">Generate 3 Ideas</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-600">Topic</label>
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="e.g. Budget meal prep"
            required
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-600">Target Audience</label>
          <input
            type="text"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="e.g. College students 18-24"
            required
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-600">Tone</label>
          <select
            value={tone}
            onChange={(e) => setTone(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition bg-white"
          >
            {TONES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-gray-600">Goal</label>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300 transition bg-white"
          >
            {GOALS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="mt-5 w-full md:w-auto px-6 py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
      >
        {loading ? 'Generating...' : 'Generate 3 Ideas'}
      </button>
    </form>
  );
}

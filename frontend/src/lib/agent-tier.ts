import type { Agent } from './api';

// ── Tier & Stat System (shared between agents list + detail page) ─────────────

export interface TierInfo {
  label: string;
  color: string;
  glow: string;
  rank: number;
}

export interface AgentStats {
  intelligence: number;
  autonomy: number;
  speed: number;
  adaptability: number;
}

const MODEL_SCORE: Record<string, number> = {
  'gpt-4o': 80, 'gpt-4-turbo': 78, 'gpt-4': 75,
  'gpt-5': 95, 'gpt-5-mini': 72, 'gpt-5.4-mini': 72,
  'gpt-4o-mini': 55, 'gpt-3.5-turbo': 40,
  'claude-3-5-sonnet': 88, 'claude-3-opus': 90, 'claude-3-sonnet': 75,
  'claude-3-haiku': 50, 'claude-3-5-haiku': 55,
  'gemini-1.5-pro': 82, 'gemini-1.5-flash': 60,
  'o1': 95, 'o1-mini': 70, 'o3': 98, 'o3-mini': 75
};

export function modelScore(model: string): number {
  const lower = model.toLowerCase();
  for (const [key, score] of Object.entries(MODEL_SCORE)) {
    if (lower.includes(key)) return score;
  }
  if (lower.includes('4o') || lower.includes('4-o')) return 80;
  if (lower.includes('gpt-4')) return 75;
  if (lower.includes('gpt-3')) return 40;
  if (lower.includes('opus')) return 88;
  if (lower.includes('sonnet')) return 75;
  if (lower.includes('haiku')) return 50;
  if (lower.includes('mini')) return 55;
  return 60;
}

export function getAgentTier(agent: Partial<Agent> & { model: string; strategy: string; max_iterations: number }): TierInfo {
  const mScore = modelScore(agent.model);
  const stratBonus = agent.strategy === 'react' ? 12 : agent.strategy === 'function_call' ? 8 : 0;
  const iterBonus = Math.min(agent.max_iterations * 1.5, 20);
  const toolBonus = (agent.tools?.length || 0) * 3;
  const total = mScore + stratBonus + iterBonus + toolBonus;

  if (total >= 115) return { label: 'LEGEND',   color: '#FF9900', glow: '#FF990040', rank: 4 };
  if (total >= 90)  return { label: 'MASTER',   color: '#9A66FF', glow: '#9A66FF40', rank: 3 };
  if (total >= 70)  return { label: 'EXPERT',   color: '#14FFF7', glow: '#14FFF740', rank: 2 };
  if (total >= 50)  return { label: 'ADEPT',    color: '#56D090', glow: '#56D09040', rank: 1 };
  return               { label: 'INITIATE', color: '#8888AA', glow: '#8888AA30', rank: 0 };
}

export function getAgentStats(agent: Partial<Agent> & { model: string; strategy: string; max_iterations: number }): AgentStats {
  const mScore = modelScore(agent.model);
  const intelligence  = Math.min(100, mScore + (agent.system_prompt?.length || 0) / 40);
  const autonomy      = Math.min(100, 30 + agent.max_iterations * 3.5);
  const speed         = Math.max(20,  100 - mScore * 0.5 + (agent.strategy === 'simple' ? 15 : 0));
  const adaptability  = Math.min(100,
    30 +
    (agent.variables?.length || 0) * 12 +
    (agent.tools?.length     || 0) * 8 +
    (agent.strategy === 'react' ? 20 : agent.strategy === 'function_call' ? 18 : 5)
  );
  return {
    intelligence:  Math.round(intelligence),
    autonomy:      Math.round(autonomy),
    speed:         Math.round(speed),
    adaptability:  Math.round(adaptability)
  };
}

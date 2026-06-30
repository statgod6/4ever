/**
 * Classifies a user message into a context scope to determine
 * which data sources to load for context building.
 *
 * This will be absorbed into the Memory OS ContextBuilder in a later task.
 */

export type ContextScope =
  | 'general'
  | 'planner'
  | 'life_review'
  | 'memory_recall'
  | 'relationship'
  | 'messaging'
  | 'knowledge'
  | 'persona';

const PLANNER_KEYWORDS = [
  'plan', 'schedule', 'task', 'todo', 'calendar', 'deadline',
  'agenda', 'meeting', 'appointment', 'remind', 'action item',
  'what should i do', 'what\'s next', 'today', 'tomorrow',
];

const LIFE_REVIEW_KEYWORDS = [
  'how am i doing', 'life review', 'wellbeing', 'well-being',
  'mood', 'energy', 'happiness', 'satisfaction', 'balance',
  'life wheel', 'dimensions', 'burnout', 'stress', 'check-in',
];

const MEMORY_KEYWORDS = [
  'remember', 'recall', 'forget', 'memory', 'last time',
  'previously', 'before', 'history', 'what did i', 'when did i',
  'do you remember', 'search memory', 'past',
];

const RELATIONSHIP_KEYWORDS = [
  'relationship', 'partner', 'friend', 'family', 'colleague',
  'boss', 'mom', 'dad', 'parent', 'sibling', 'wife', 'husband',
  'boyfriend', 'girlfriend', 'tension', 'conflict', 'trust',
  'love language', 'drift', 'ritual', 'anniversary', 'birthday',
];

const MESSAGING_KEYWORDS = [
  'message', 'chat', 'send', 'inbox', 'unread', 'connection',
  'tri-chat', 'mediator', 'shared note', 'direct message',
];

const KNOWLEDGE_KEYWORDS = [
  'document', 'paper', 'pdf', 'research', 'knowledge worker',
  'analyze', 'summarize document', 'upload',
];

const PERSONA_KEYWORDS = [
  'persona', 'analysis', 'devil\'s advocate', 'entrepreneur',
  'think about', 'perspective', 'analyze me',
];

export function classifyContextScope(message: string): ContextScope {
  const lower = message.toLowerCase();

  const scores: Record<ContextScope, number> = {
    planner: 0,
    life_review: 0,
    memory_recall: 0,
    relationship: 0,
    messaging: 0,
    knowledge: 0,
    persona: 0,
    general: 0,
  };

  for (const kw of PLANNER_KEYWORDS) if (lower.includes(kw)) scores.planner++;
  for (const kw of LIFE_REVIEW_KEYWORDS) if (lower.includes(kw)) scores.life_review++;
  for (const kw of MEMORY_KEYWORDS) if (lower.includes(kw)) scores.memory_recall++;
  for (const kw of RELATIONSHIP_KEYWORDS) if (lower.includes(kw)) scores.relationship++;
  for (const kw of MESSAGING_KEYWORDS) if (lower.includes(kw)) scores.messaging++;
  for (const kw of KNOWLEDGE_KEYWORDS) if (lower.includes(kw)) scores.knowledge++;
  for (const kw of PERSONA_KEYWORDS) if (lower.includes(kw)) scores.persona++;

  // Find highest scoring scope
  let best: ContextScope = 'general';
  let bestScore = 0;
  for (const [scope, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      best = scope as ContextScope;
    }
  }

  return bestScore >= 1 ? best : 'general';
}

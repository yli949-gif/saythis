export const TRIAGE_SCHEMA = {
  name: 'triage',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      importance: {
        type: 'string', enum: ['skip', 'notable', 'copilot'],
        description: 'skip=small talk/filler; notable=important but no answer needed (show zh gist); copilot=question/task/request directed at the user OR something the user must respond to',
      },
      isQuestionForUser: { type: 'boolean' },
      meaningZh: {
        type: ['string', 'null'],
        description: 'Concise Chinese explanation of what was said/asked (one short sentence). null when importance=skip',
      },
      resolvedQuery: {
        type: ['string', 'null'],
        description: 'Self-contained English restatement of what is being asked, resolving pronouns/ellipsis ("Why?" -> "Why is Idea 12 unstable"). null when importance=skip',
      },
    },
    required: ['importance', 'isQuestionForUser', 'meaningZh', 'resolvedQuery'],
  },
} as const;

export const GEN_SCHEMA = {
  name: 'copilot_response',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      meaningZh: { type: 'string', description: 'Concise Chinese explanation of what they are asking/meaning' },
      sayThis: {
        type: 'string',
        description: 'What the user should say out loud. 1-3 SHORT, simple, natural spoken-English sentences. Never more than 3 sentences.',
      },
      why: { type: ['string', 'null'], description: 'One short sentence of reasoning/context, optional' },
      confidence: {
        type: 'string', enum: ['high', 'medium', 'low'],
        description: 'high=strong evidence in provided sources; medium=partial; low=no reliable evidence (sayThis must then be a safe honest response, no invented facts)',
      },
      sourceIds: {
        type: 'array', items: { type: 'string' },
        description: 'IDs of evidence items (E1, F2, ...) that actually support sayThis. Empty if none used.',
      },
      conflict: { type: ['string', 'null'], description: 'If provided sources disagree, one short sentence stating the conflict; else null' },
      smartQuestion: {
        type: ['object', 'null'],
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['clarification', 'decision', 'validation', 'next_step'] },
          text: { type: 'string', description: 'One short speakable question' },
        },
        required: ['type', 'text'],
        description: 'At most ONE follow-up question, ONLY if an important information gap exists; else null',
      },
    },
    required: ['meaningZh', 'sayThis', 'why', 'confidence', 'sourceIds', 'conflict', 'smartQuestion'],
  },
} as const;

export const MEMORY_SCHEMA = {
  name: 'project_memory',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      projectGoal: { type: ['string', 'null'] },
      myResponsibilities: { $ref: '#/$defs/items' },
      currentTasks: { $ref: '#/$defs/items' },
      decisions: { $ref: '#/$defs/items' },
      completedWork: { $ref: '#/$defs/items' },
      openQuestions: { $ref: '#/$defs/items' },
      keyFacts: { $ref: '#/$defs/items' },
      latestResults: { $ref: '#/$defs/items' },
    },
    required: ['projectGoal', 'myResponsibilities', 'currentTasks', 'decisions', 'completedWork', 'openQuestions', 'keyFacts', 'latestResults'],
    $defs: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', description: 'One concise factual statement' },
            sources: { type: 'array', items: { type: 'string' }, description: 'Relative file paths this fact came from' },
          },
          required: ['text', 'sources'],
        },
      },
    },
  },
} as const;

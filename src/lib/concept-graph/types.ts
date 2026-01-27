export type ConceptNode = {
  id: string;
  label: string;
  masteryLevel: number;
  relatedConcepts: string[];
  source: 'textbook' | 'past-question' | 'prediction';
};

export type ConceptEdge = {
  id: string;
  from: string;
  to: string;
  relationship: 'depends_on' | 'leads_to' | 'commonly_tested_with';
};

export type ConceptNodeStats = {
  examRelevance: number;
  predictionLikelihood?: number;
  practiceAttempts: number;
  practiceCorrect: number;
  lastPracticedAt?: number;
  lastPredictedAt?: number;
};

export type ConceptGraph = {
  nodes: Record<string, ConceptNode>;
  edges: ConceptEdge[];
  nodeStats: Record<string, ConceptNodeStats>;
  notesByNodeId: Record<string, string>;
  tagsByNodeId: Record<string, string[]>;
};


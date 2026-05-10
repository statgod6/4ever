/**
 * Ontology event name constants + payload types.
 * Emitted from existing domain services, consumed by the ontology listener.
 */

export const ONTOLOGY_EVENTS = {
  SELF_INPUT: 'ontology.self.input',
  RELATIONAL_INPUT: 'ontology.relational.input',
  EMOTIONAL_INPUT: 'ontology.emotional.input',
} as const;

export type OntologyDomain = 'self' | 'relational' | 'emotional';

export interface OntologyInputEvent {
  userId: string;
  eventType: string;
  scopeId?: string | null;
  payload?: Record<string, unknown>;
}

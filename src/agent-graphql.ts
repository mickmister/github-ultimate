import { Kind, parse, visit } from 'graphql/language';
import { z } from 'zod';

export const agentScope = { id: z.string().uuid(), installationId: z.number().int().positive(), userId: z.number().int().positive() };
export const agentGraphqlSchema = z.object({ operation: z.literal('agentGraphql'), ...agentScope, query: z.string().min(1).max(32 * 1024), variables: z.record(z.string(), z.json()).default({}) }).strict();
export function readOnlyGraphql(query: string, variables: unknown) {
  if (query.length > 32 * 1024 || JSON.stringify(variables).length > 32 * 1024) throw Error('GraphQL query or variables exceed 32 KiB.');
  const document = parse(query, { maxTokens: 4000 });
  const operations = document.definitions.filter(d => d.kind === Kind.OPERATION_DEFINITION);
  if (operations.length !== 1 || operations[0].operation !== 'query' || document.definitions.some(d => d.kind !== Kind.OPERATION_DEFINITION && d.kind !== Kind.FRAGMENT_DEFINITION)) throw Error('Exactly one read-only GraphQL query is allowed. Mutations and subscriptions are unavailable.');
  let depth = 0, fields = 0;
  visit(document, { SelectionSet: { enter() { if (++depth > 20) throw Error('GraphQL selection depth exceeds 20.'); }, leave() { depth--; } }, Field() { if (++fields > 500) throw Error('GraphQL query exceeds 500 fields.'); } });
  return { query, variables };
}

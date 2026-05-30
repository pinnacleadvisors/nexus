/**
 * lib/graph/structural-id.ts — id convention for structural ecosystem nodes
 * persisted into mol_edge (Akashic Thread A).
 *
 * Atom/entity ids are `<scope_id>:<slug>`; temporal nodes are raw UUIDs. To
 * avoid colliding with those, structural nodes use a `struct:` prefix:
 *   struct:agent:loop-runner · struct:tool:Bash · struct:skill:firecrawl
 *
 * The ecosystem-index graph (lib/graph/ecosystem-index.ts) already labels nodes
 * `<kind>:<slug>` (e.g. `agent:loop-runner`), so persisting one is just a
 * `struct:` prefix — see structuralIdFromNode.
 */

export function structuralId(kind: string, slug: string): string {
  return `struct:${kind}:${slug}`
}

/** Promote an ecosystem-index graph node id (`<kind>:<slug>`) to a structural
 *  mol_edge id (`struct:<kind>:<slug>`). */
export function structuralIdFromNode(nodeId: string): string {
  return `struct:${nodeId}`
}

export function isStructuralId(id: string): boolean {
  return id.startsWith('struct:')
}

export function parseStructuralId(id: string): { kind: string; slug: string } | null {
  const m = /^struct:([^:]+):(.+)$/.exec(id)
  return m ? { kind: m[1], slug: m[2] } : null
}

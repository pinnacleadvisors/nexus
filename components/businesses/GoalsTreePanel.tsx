import { Goal as GoalIcon, CheckCircle2, CircleDashed } from 'lucide-react'

export interface GoalNode {
  id:               string
  title:            string
  success_criteria: string | null
  parent_goal_id:   string | null
  status:           string
}

interface Props {
  goals: GoalNode[]
}

interface TreeNode extends GoalNode {
  children: TreeNode[]
}

function buildTree(goals: GoalNode[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  for (const g of goals) map.set(g.id, { ...g, children: [] })
  const roots: TreeNode[] = []
  for (const node of map.values()) {
    if (node.parent_goal_id && map.has(node.parent_goal_id)) {
      map.get(node.parent_goal_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

function GoalNodeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const Icon = node.status === 'completed' ? CheckCircle2 : CircleDashed
  const iconColor = node.status === 'completed' ? 'text-emerald-400' : 'text-zinc-500'
  return (
    <>
      <li className="flex items-start gap-2 py-1.5" style={{ paddingLeft: `${depth * 16}px` }}>
        <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${iconColor}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-zinc-200">{node.title}</p>
          {node.success_criteria ? (
            <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{node.success_criteria}</p>
          ) : null}
        </div>
      </li>
      {node.children.map(c => (
        <GoalNodeRow key={c.id} node={c} depth={depth + 1} />
      ))}
    </>
  )
}

export default function GoalsTreePanel({ goals }: Props) {
  const tree = buildTree(goals)
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <GoalIcon className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-300">Goals</h3>
      </div>
      {tree.length === 0 ? (
        <p className="text-sm italic text-zinc-500">
          No goals yet. Apply migration 047_goals.sql and seed via <code className="rounded bg-zinc-800/60 px-1 py-0.5 text-xs">lib/goals/insert.ts</code>.
        </p>
      ) : (
        <ul className="text-sm">
          {tree.map(g => <GoalNodeRow key={g.id} node={g} depth={0} />)}
        </ul>
      )}
    </div>
  )
}

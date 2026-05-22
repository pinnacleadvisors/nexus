import { Target } from 'lucide-react'

interface Props {
  mission:    string | null
  brandVoice: string | null
}

export default function MissionPanel({ mission, brandVoice }: Props) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-300">Mission</h3>
      </div>
      {mission ? (
        <p className="whitespace-pre-wrap text-base leading-relaxed text-zinc-200">{mission}</p>
      ) : (
        <p className="text-sm italic text-zinc-500">
          No mission set. Set <code className="rounded bg-zinc-800/60 px-1 py-0.5 text-xs">mission</code> on the business row in Settings.
        </p>
      )}
      {brandVoice ? (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Brand voice</h4>
          <p className="mt-1 text-sm text-zinc-400">{brandVoice}</p>
        </div>
      ) : null}
    </div>
  )
}

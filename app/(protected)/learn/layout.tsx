import LearnHeader from '@/components/learn/LearnHeader'

export default function LearnLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-8 py-6 max-w-5xl mx-auto">
      <LearnHeader />
      <div className="mt-8">{children}</div>
    </div>
  )
}

import Dashboard from '@/components/dashboard'
import '../home/dashboard.css'
export default async function CoachPage({ searchParams }: { searchParams: Promise<{ question?: string | string[] }> }) {
  const params = await searchParams
  const question = typeof params.question === 'string' ? params.question.slice(0, 300) : ''
  return <Dashboard view="coach" initialQuestion={question} />
}

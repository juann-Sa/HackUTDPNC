import AppHeader from '@/components/AppHeader'
import '../home/dashboard.css'
import './future.css'

export default function FuturePage() {
  return <div className="future-page"><AppHeader current="future" /><main className="future-main" aria-label="Future" /></div>
}

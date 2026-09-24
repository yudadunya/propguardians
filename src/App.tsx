import { Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Analyzer from './pages/Analyzer'
import Journal from './pages/Journal'
import Plan from './pages/Plan'
import Settings from './pages/Settings'

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/analyzer', label: 'Setup Analyzer' },
  { to: '/journal', label: 'Trade Journal' },
  { to: '/plan', label: 'Trading Plan' },
  { to: '/settings', label: 'Account & Rules' },
]

export default function App() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-950 text-slate-100">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-slate-900 border-r border-slate-800 p-4 flex flex-col">
        <div className="mb-8">
          <h1 className="text-xl font-bold text-emerald-400">Prop Guardian</h1>
          <p className="text-xs text-slate-500 mt-1">AI Risk & Process Coach</p>
        </div>

        <nav className="space-y-1 flex-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-colors ${
                  isActive
                    ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                    : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto pt-4 border-t border-slate-800 text-xs text-slate-500">
          Prop Guardian v1.0
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/analyzer" element={<Analyzer />} />
          <Route path="/journal" element={<Journal />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

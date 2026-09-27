import { Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import Analyzer  from './pages/Analyzer'
import Journal   from './pages/Journal'
import Plan      from './pages/Plan'
import Settings  from './pages/Settings'
import Learning  from './pages/Learning'
import { LivePriceRows } from './components/LivePriceTicker'

const navItems = [
  { to: '/',          label: 'Dashboard'      },
  { to: '/analyzer',  label: 'Setup Analyzer' },
  { to: '/journal',   label: 'Trade Journal'  },
  { to: '/plan',      label: 'Trading Plan'   },
  { to: '/settings',  label: 'Account & Rules'},
  { to: '/learning',  label: 'RSI Learning'   },
]

/** Symbols shown in sidebar — compact row variant */
const SIDEBAR_SYMBOLS = ['XAUUSD', 'NAS100', 'EURUSD', 'GBPUSD']

export default function App() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-950 text-slate-100">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="w-full md:w-64 bg-slate-900 border-r border-slate-800 p-4 flex flex-col">
        <div className="mb-6">
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

        {/* ── Live price rows in sidebar ─────────────────────── */}
        <div className="mt-4 py-4 border-t border-slate-800">
          <LivePriceRows symbols={SIDEBAR_SYMBOLS} />
        </div>

        <div className="pt-3 border-t border-slate-800 text-xs text-slate-600">
          Prop Guardian v1.0 · biquote.io
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────── */}
      <main className="flex-1 p-4 md:p-8 overflow-auto">
        <Routes>
          <Route path="/"          element={<Dashboard />} />
          <Route path="/analyzer"  element={<Analyzer  />} />
          <Route path="/journal"   element={<Journal   />} />
          <Route path="/plan"      element={<Plan      />} />
          <Route path="/settings"  element={<Settings  />} />
          <Route path="/learning"  element={<Learning  />} />
        </Routes>
      </main>
    </div>
  )
}

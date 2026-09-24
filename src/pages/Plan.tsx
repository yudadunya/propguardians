import { useStore } from '../hooks/useStore'

export default function Plan() {
  const { plan, updatePlan } = useStore()

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold">Trading Plan</h2>
      <p className="text-slate-400 text-sm">
        Plan ini akan dipakai AI untuk menilai setiap setup. Ubah sesuai edge
        kamu.
      </p>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <div>
          <label className="text-xs text-slate-400">Nama Plan</label>
          <input
            className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
            value={plan.name}
            onChange={(e) => updatePlan('name', e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">
            Instruments (pisahkan koma)
          </label>
          <input
            className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
            value={plan.instruments.join(', ')}
            onChange={(e) =>
              updatePlan(
                'instruments',
                e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Primary TF</label>
            <input
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={plan.primaryTF}
              onChange={(e) => updatePlan('primaryTF', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Confirmation TF</label>
            <input
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={plan.confirmationTF}
              onChange={(e) => updatePlan('confirmationTF', e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400">Entry Rules</label>
          <textarea
            className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm h-20"
            value={plan.entryRules}
            onChange={(e) => updatePlan('entryRules', e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">Stop Loss Rules</label>
          <textarea
            className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm h-16"
            value={plan.stopRules}
            onChange={(e) => updatePlan('stopRules', e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">Take Profit Rules</label>
          <textarea
            className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm h-16"
            value={plan.targetRules}
            onChange={(e) => updatePlan('targetRules', e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-slate-400">
            Allowed Sessions (pisahkan koma)
          </label>
          <input
            className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
            value={plan.sessions.join(', ')}
            onChange={(e) =>
              updatePlan(
                'sessions',
                e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              )
            }
          />
        </div>
      </div>
    </div>
  )
}

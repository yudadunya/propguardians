import { useStore } from '../hooks/useStore'

export default function Settings() {
  const { account, personalRules, updateAccount, updatePersonal, resetAll } =
    useStore()

  function handleReset() {
    if (confirm('Reset seluruh data akun & trade history?')) {
      resetAll()
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold">Account & Personal Rules</h2>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <h3 className="font-medium text-emerald-400">Prop Firm Account</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Firm Name</label>
            <input
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={account.firmName}
              onChange={(e) => updateAccount('firmName', e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Account Size ($)</label>
            <input
              type="number"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={account.accountSize}
              onChange={(e) =>
                updateAccount('accountSize', Number(e.target.value))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Max Daily DD (%)</label>
            <input
              type="number"
              step="0.1"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={account.maxDailyDD}
              onChange={(e) =>
                updateAccount('maxDailyDD', Number(e.target.value))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Max Overall DD (%)</label>
            <input
              type="number"
              step="0.1"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={account.maxOverallDD}
              onChange={(e) =>
                updateAccount('maxOverallDD', Number(e.target.value))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Current Balance</label>
            <input
              type="number"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={account.currentBalance}
              onChange={(e) =>
                updateAccount('currentBalance', Number(e.target.value))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Mode</label>
            <select
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={String(account.isChallenge)}
              onChange={(e) =>
                updateAccount('isChallenge', e.target.value === 'true')
              }
            >
              <option value="true">Challenge</option>
              <option value="false">Funded</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-5 space-y-4">
        <h3 className="font-medium text-amber-400">
          Personal Risk Rules (lebih ketat dari firm)
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-400">Risk per Trade (%)</label>
            <input
              type="number"
              step="0.1"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={personalRules.riskPerTrade}
              onChange={(e) =>
                updatePersonal('riskPerTrade', Number(e.target.value))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">
              Personal Daily Loss Limit (%)
            </label>
            <input
              type="number"
              step="0.1"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={personalRules.personalDailyLimit}
              onChange={(e) =>
                updatePersonal('personalDailyLimit', Number(e.target.value))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">
              Max Consecutive Losses
            </label>
            <input
              type="number"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={personalRules.maxConsecutiveLoss}
              onChange={(e) =>
                updatePersonal('maxConsecutiveLoss', Number(e.target.value))
              }
            />
          </div>
          <div>
            <label className="text-xs text-slate-400">Max Trades per Day</label>
            <input
              type="number"
              className="w-full mt-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm"
              value={personalRules.maxTradesPerDay}
              onChange={(e) =>
                updatePersonal('maxTradesPerDay', Number(e.target.value))
              }
            />
          </div>
        </div>
      </div>

      <button
        onClick={handleReset}
        className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-medium text-sm transition-colors"
      >
        Reset Semua Data
      </button>
    </div>
  )
}

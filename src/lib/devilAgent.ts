/**
 * Phase 3 — Devil's Advocate Agent
 * Sengaja mencari alasan kenapa setup ini jelek / invalid.
 * Tidak boleh diabaikan oleh Synthesis.
 */

import type {
  ICTStructureInput,
  StructureAgentOutput,
  EdgeAgentOutput,
  SetupType,
} from '../types/ict'

export interface DevilFlag {
  severity: 'critical' | 'high' | 'medium' | 'low'
  code: string
  message: string
  scorePenalty: number
}

export interface DevilAgentOutput {
  flags: DevilFlag[]
  totalPenalty: number
  veto: boolean // critical flags → force skip/block consideration
  summary: string
  attackCount: number
}

export function runDevilAgent(
  input: ICTStructureInput,
  structure: StructureAgentOutput,
  edge: EdgeAgentOutput,
  setupType: SetupType
): DevilAgentOutput {
  const flags: DevilFlag[] = []

  // --- Critical ---
  if (!structure.inKillZone) {
    flags.push({
      severity: 'critical',
      code: 'OUTSIDE_KZ',
      message: 'Di luar Kill Zone — edge historis biasanya negatif atau acak',
      scorePenalty: 25,
    })
  }

  if (!structure.sweepValid) {
    flags.push({
      severity: 'critical',
      code: 'NO_SWEEP',
      message: 'Tidak ada Liquidity Sweep yang valid — tidak ada “fuel” institusional',
      scorePenalty: 25,
    })
  }

  if (!structure.mssValid) {
    flags.push({
      severity: 'critical',
      code: 'NO_MSS',
      message: 'Tidak ada MSS/CHoCH — arah order flow belum terkonfirmasi',
      scorePenalty: 20,
    })
  }

  if (edge.expectancy < 0) {
    flags.push({
      severity: 'critical',
      code: 'NEG_EXPECTANCY',
      message: `Expectancy historis negatif (${edge.expectancy}R) — sistematis underperform`,
      scorePenalty: 30,
    })
  }

  // --- High ---
  if (!structure.fvgValid) {
    flags.push({
      severity: 'high',
      code: 'NO_FVG',
      message: 'Tidak ada FVG — entry zone tidak presisi',
      scorePenalty: 15,
    })
  }

  if (!structure.displacementValid) {
    flags.push({
      severity: 'high',
      code: 'WEAK_DISP',
      message: 'Displacement lemah/tidak ada — momentum institusional diragukan',
      scorePenalty: 12,
    })
  }

  if (input.rrRatio < 2) {
    flags.push({
      severity: 'high',
      code: 'LOW_RR',
      message: `R:R ${input.rrRatio.toFixed(1)} di bawah minimum 1:2`,
      scorePenalty: 15,
    })
  }

  if (input.fvgPartiallyFilled && structure.fvgValid) {
    flags.push({
      severity: 'high',
      code: 'FVG_PARTIAL',
      message: 'FVG sudah terisi sebagian — magnet rebalance melemah',
      scorePenalty: 10,
    })
  }

  // --- Medium ---
  if (!structure.premiumDiscountOk) {
    flags.push({
      severity: 'medium',
      code: 'PD_MISMATCH',
      message:
        input.direction === 'long'
          ? 'Long bukan di Discount — trading melawan array premium/discount'
          : 'Short bukan di Premium — trading melawan array premium/discount',
      scorePenalty: 8,
    })
  }

  if (!structure.oteBonus) {
    flags.push({
      severity: 'medium',
      code: 'NO_OTE',
      message: 'Di luar OTE (0.62–0.79) — entry kurang optimal',
      scorePenalty: 6,
    })
  }

  if (edge.confidence === 'low') {
    flags.push({
      severity: 'medium',
      code: 'LOW_SAMPLE',
      message: `Sample historis kecil (n=${edge.sampleSize}) — confidence rendah`,
      scorePenalty: 5,
    })
  }

  if (edge.expectancy >= 0 && edge.expectancy < 0.25) {
    flags.push({
      severity: 'medium',
      code: 'THIN_EDGE',
      message: `Edge tipis (E[R]=${edge.expectancy}) — sedikit room untuk error eksekusi`,
      scorePenalty: 7,
    })
  }

  // --- Low / contextual ---
  if (setupType === 'other') {
    flags.push({
      severity: 'high',
      code: 'NON_CORE_MODEL',
      message: 'Bukan model ICT Core terklasifikasi (sweep_mss_fvg / silver_bullet)',
      scorePenalty: 12,
    })
  }

  if (input.killZone === 'ny_pm') {
    flags.push({
      severity: 'low',
      code: 'NY_PM',
      message: 'NY PM lebih sering untuk management/reversal — bukan entry primer',
      scorePenalty: 4,
    })
  }

  if (structure.sweepValid && structure.mssValid && !structure.fvgValid) {
    flags.push({
      severity: 'medium',
      code: 'SWEEP_MSS_NO_FVG',
      message: 'Ada Sweep+MSS tapi tanpa FVG — tunggu imbalance atau skip',
      scorePenalty: 8,
    })
  }

  // Direction vs sweep consistency
  if (
    structure.sweepValid &&
    ((input.direction === 'long' && input.sweepType === 'bsl') ||
      (input.direction === 'short' && input.sweepType === 'ssl'))
  ) {
    flags.push({
      severity: 'high',
      code: 'SWEEP_DIR_CONFLICT',
      message:
        'Arah trade berlawanan dengan tipe sweep (SSL→long, BSL→short). Cek ulang bias.',
      scorePenalty: 18,
    })
  }

  const totalPenalty = flags.reduce((s, f) => s + f.scorePenalty, 0)
  const veto = flags.some((f) => f.severity === 'critical')

  const critical = flags.filter((f) => f.severity === 'critical').length
  const high = flags.filter((f) => f.severity === 'high').length

  let summary = 'Tidak ada serangan berarti — thesis relatif bersih'
  if (veto) {
    summary = `${critical} critical flag — thesis diruntuhkan`
  } else if (high > 0) {
    summary = `${high} high-severity issue — thesis lemah`
  } else if (flags.length > 0) {
    summary = `${flags.length} catatan minor — waspada`
  }

  return {
    flags,
    totalPenalty,
    veto,
    summary,
    attackCount: flags.length,
  }
}

/** Apply devil penalty to combined score */
export function applyDevilPenalty(combinedScore: number, totalPenalty: number): number {
  return Math.max(0, Math.min(100, combinedScore - totalPenalty * 0.5))
}

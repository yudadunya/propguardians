/**
 * devilAgent.ts — Devil's Advocate Agent v1.2
 *
 * Baru di v1.2:
 *  - Top-down conflict → critical veto kalau entry melawan D1+H4 bias
 *  - News window → high flag (avoid entry, size down)
 *  - Key level sweep validation → low flag kalau sweep bukan di key level
 *  - Outside KZ turun dari critical → high (jangan auto-veto)
 */

import type {
  ICTStructureInput,
  StructureAgentOutput,
  EdgeAgentOutput,
  DevilFlag,
  DevilAgentOutput,
  SetupType,
} from '../types/ict'

export function runDevilAgent(
  input:     ICTStructureInput,
  structure: StructureAgentOutput,
  edge:      EdgeAgentOutput,
  setupType: SetupType,
): DevilAgentOutput {
  const flags: DevilFlag[] = []

  /* ══ CRITICAL — veto if any ══ */

  // No sweep = no thesis
  if (!structure.sweepValid) {
    flags.push({
      severity: 'critical', code: 'NO_SWEEP',
      message: 'Tidak ada Liquidity Sweep — tidak ada fuel institusional',
      scorePenalty: 25,
    })
  }

  // No MSS = no direction change confirmation
  if (!structure.mssValid) {
    flags.push({
      severity: 'critical', code: 'NO_MSS',
      message: 'Tidak ada MSS/CHoCH — order flow belum terkonfirmasi',
      scorePenalty: 20,
    })
  }

  // Negative expectancy = statistiknya buruk
  if (edge.expectancy < 0) {
    flags.push({
      severity: 'critical', code: 'NEG_EXPECTANCY',
      message: `Expectancy negatif (${edge.expectancy.toFixed(2)}R) — setup ini underperform secara historis`,
      scorePenalty: 30,
    })
  }

  // Entry MELAWAN D1+H4 bias → highest risk
  if (input.topDown) {
    const td = input.topDown
    const conflict =
      (td.biasDirection === 'long'  && input.direction === 'short') ||
      (td.biasDirection === 'short' && input.direction === 'long')
    if (conflict && (td.alignment === 'strong_bull' || td.alignment === 'strong_bear')) {
      flags.push({
        severity: 'critical', code: 'AGAINST_HTF_BIAS',
        message: `Entry ${input.direction.toUpperCase()} MELAWAN D1+H4 bias ${td.biasDirection} — counter-trend tertinggi`,
        scorePenalty: 28,
      })
    }
  }

  /* ══ HIGH ══ */

  // Outside Kill Zone (turun dari critical → high)
  if (!structure.inKillZone) {
    flags.push({
      severity: 'high', code: 'OUTSIDE_KZ',
      message: 'Di luar Kill Zone — probabilitas historis rendah, spread lebih lebar',
      scorePenalty: 18,
    })
  }

  // D1 vs H4 conflicting (bukan entry vs bias, tapi D1 vs H4 saling bertentangan)
  if (input.topDown?.alignment === 'conflicting') {
    flags.push({
      severity: 'high', code: 'TOPDOWN_CONFLICT',
      message: 'D1 dan H4 berlawanan arah — market ranging/transisi, skip sampai resolusi',
      scorePenalty: 15,
    })
  }

  // News window
  if (input.newsStatus?.recommendation === 'avoid') {
    flags.push({
      severity: 'high', code: 'NEWS_WINDOW',
      message: `📰 NEWS: ${input.newsStatus.reason}`,
      scorePenalty: 20,
    })
  } else if (input.newsStatus?.recommendation === 'caution') {
    flags.push({
      severity: 'medium', code: 'NEWS_CAUTION',
      message: `📰 NEWS caution: ${input.newsStatus.reason}`,
      scorePenalty: 8,
    })
  }

  if (!structure.fvgValid) {
    flags.push({
      severity: 'high', code: 'NO_FVG',
      message: 'Tidak ada FVG — zona entry tidak presisi',
      scorePenalty: 15,
    })
  }

  if (!structure.displacementValid) {
    flags.push({
      severity: 'high', code: 'WEAK_DISP',
      message: 'Displacement lemah/tidak ada — momentum institusional diragukan',
      scorePenalty: 12,
    })
  }

  if (input.rrRatio < 2) {
    flags.push({
      severity: 'high', code: 'LOW_RR',
      message: `R:R ${input.rrRatio.toFixed(1)}:1 di bawah minimum 1:2`,
      scorePenalty: 15,
    })
  }

  if (input.fvgPartiallyFilled && structure.fvgValid) {
    flags.push({
      severity: 'high', code: 'FVG_PARTIAL',
      message: 'FVG sudah terisi sebagian — magnet rebalance melemah',
      scorePenalty: 10,
    })
  }

  // Sweep arah tidak sesuai direction
  if (
    structure.sweepValid &&
    ((input.direction === 'long'  && input.sweepType === 'bsl') ||
     (input.direction === 'short' && input.sweepType === 'ssl'))
  ) {
    flags.push({
      severity: 'high', code: 'SWEEP_DIR_CONFLICT',
      message: 'Sweep type tidak sesuai direction (SSL→long, BSL→short). Cek ulang.',
      scorePenalty: 18,
    })
  }

  /* ══ MEDIUM ══ */

  if (!structure.premiumDiscountOk) {
    flags.push({
      severity: 'medium', code: 'PD_MISMATCH',
      message: input.direction === 'long'
        ? 'Long bukan dari Discount zone — melawan array institusional'
        : 'Short bukan dari Premium zone — melawan array institusional',
      scorePenalty: 8,
    })
  }

  if (!structure.oteBonus) {
    flags.push({
      severity: 'medium', code: 'NO_OTE',
      message: 'Di luar OTE 62–79% — entry kurang optimal, spread risk lebih besar',
      scorePenalty: 6,
    })
  }

  if (edge.confidence === 'low') {
    flags.push({
      severity: 'medium', code: 'LOW_SAMPLE',
      message: `Sample historis kecil (n=${edge.sampleSize}) — confidence rendah`,
      scorePenalty: 5,
    })
  }

  if (edge.expectancy >= 0 && edge.expectancy < 0.25) {
    flags.push({
      severity: 'medium', code: 'THIN_EDGE',
      message: `Edge tipis (E[R]=${edge.expectancy.toFixed(2)}) — sedikit ruang untuk eksekusi error`,
      scorePenalty: 7,
    })
  }

  if (structure.sweepValid && structure.mssValid && !structure.fvgValid) {
    flags.push({
      severity: 'medium', code: 'SWEEP_MSS_NO_FVG',
      message: 'Sweep+MSS ada tapi FVG belum terbentuk — tunggu imbalance atau skip',
      scorePenalty: 8,
    })
  }

  // MSS tidak hard-confirmed
  if (structure.mssValid && !structure.mssStrong) {
    flags.push({
      severity: 'medium', code: 'MSS_NOT_HARD',
      message: 'MSS hanya inferred (displacement) — CHoCH close beyond level belum terjadi',
      scorePenalty: 7,
    })
  }

  /* ══ LOW ══ */

  if (setupType === 'other') {
    flags.push({
      severity: 'high', code: 'NON_CORE_MODEL',
      message: 'Bukan ICT Core model (sweep_mss_fvg / silver_bullet)',
      scorePenalty: 12,
    })
  }

  if (input.killZone === 'ny_pm') {
    flags.push({
      severity: 'low', code: 'NY_PM',
      message: 'NY PM lebih cocok untuk management/reversal, bukan entry primer',
      scorePenalty: 4,
    })
  }

  // Sweep bukan di key level
  if (
    structure.sweepValid &&
    input.keyLevels &&
    !input.keyLevels.matchedLevel
  ) {
    flags.push({
      severity: 'low', code: 'NO_KEY_LEVEL',
      message: 'Sweep bukan di PDH/PDL/PWH/PWL — level kurang institutional',
      scorePenalty: 5,
    })
  }

  // Top-down partial conflict (bukan full conflict, tapi arah berlawanan dari partial bias)
  if (input.topDown) {
    const td = input.topDown
    const partialConflict =
      (td.alignment === 'partial_bull' && input.direction === 'short') ||
      (td.alignment === 'partial_bear' && input.direction === 'long')
    if (partialConflict) {
      flags.push({
        severity: 'medium', code: 'PARTIAL_TOPDOWN_CONFLICT',
        message: `Entry ${input.direction} berlawanan dengan partial ${td.biasDirection} bias`,
        scorePenalty: 10,
      })
    }
  }

  /* ── Aggregate ── */

  const totalPenalty = flags.reduce((s, f) => s + f.scorePenalty, 0)
  const veto         = flags.some(f => f.severity === 'critical')

  const nCrit = flags.filter(f => f.severity === 'critical').length
  const nHigh = flags.filter(f => f.severity === 'high').length

  const summary = veto
    ? `${nCrit} critical — thesis diruntuhkan, SKIP`
    : nHigh > 0
      ? `${nHigh} high-severity issue — thesis lemah`
      : flags.length > 0
        ? `${flags.length} catatan minor — waspada`
        : 'Tidak ada flag berarti — thesis relatif bersih'

  return { flags, totalPenalty, veto, summary, attackCount: flags.length }
}

export function applyDevilPenalty(combinedScore: number, totalPenalty: number): number {
  return Math.max(0, Math.min(100, combinedScore - totalPenalty * 0.5))
}

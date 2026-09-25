# Prop Guardian RSI

AI Trader Profesional — ICT Pattern Detection + Multi-Agent + Recursive Self-Improvement.

## Phase 5 (saat ini)

```
OHLC (demo/live) → Pattern Detector → Structure → Edge → Devil → Risk → Synthesis
                                              ↑
                                        RSI weights
```

### Fitur baru Phase 5
- **Scan OHLC (Demo)** — deteksi swing, sweep, FVG, MSS, premium/discount dari candle
- Checklist auto-terisi → Run Multi-Agent
- Siap diganti feed live (API) tanpa ubah agent pipeline

### Alur uji
1. Pilih instrument (XAUUSD)
2. **Scan OHLC (Demo)**
3. **Run Multi-Agent**
4. Record outcome di RSI Learning → Run RSI

## Deploy

```bash
git add .
git commit -m "Phase 5: ICT OHLC pattern detector + demo scan"
git push
```

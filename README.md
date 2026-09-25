# Prop Guardian RSI

AI Trader — Live OHLC (biquote) + ICT Pattern + Multi-Agent + RSI.

## Phase 6

- **Scan Live (biquote)** — free, no API key: `https://biquote.io/api/{symbol}/ohlc`
- Symbol map: NAS100 → USTEC
- Scan Demo tetap ada sebagai fallback
- Pipeline: OHLC → Pattern Detector → Structure → Edge → Devil → Risk

## Deploy

```bash
git add .
git commit -m "Phase 6: biquote live OHLC integration"
git push
```

## Uji

1. Instrument XAUUSD, TF M15
2. **Scan Live (biquote)**
3. **Run Multi-Agent**

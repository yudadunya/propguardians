# Prop Guardian RSI

AI Trader Profesional — ICT Core + Multi-Agent + Recursive Self-Improvement.

## Phase 4 (saat ini)

```
Structure → Edge (weighted) → Devil → Risk → Synthesis
                    ↑
              RSI Learning
         (episodes → weights → model version)
```

### Fitur RSI
- Record outcome (actual R) per setup
- Batch RSI update (≥3 pending episodes)
- Feature weights naik/turun dari hasil nyata
- Model versioning
- Edge Agent memakai bobot hasil belajar

ICT Core **rules tetap kaku**. Yang berubah hanya **bobot edge**.

## Deploy

```bash
git add .
git commit -m "Phase 4: Recursive Self-Improvement engine"
git push
```

## Cara uji RSI
1. Analyzer → setup Grade A/B TAKE
2. RSI Learning → isi Actual R → Save (ulang ≥3x)
3. Run RSI → weights & model version update
4. Analyzer lagi → Edge memakai bobot baru

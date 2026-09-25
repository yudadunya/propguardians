# Prop Guardian RSI — Phase 8

## Autopilot Kill Zone

AI bekerja menurut jadwal ICT (waktu New York):

1. Centang **Autopilot Kill Zone**
2. Pilih interval (3 / 5 / 10 / 15 menit)
3. Saat status **KILL ZONE AKTIF** atau **PRE-WINDOW** → otomatis **Analyze Live**
4. Di luar jendela → standby (tidak spam API)

Bias 100% AI. Tidak ada pilihan Direction manual.

## Deploy

```bash
git add .
git commit -m "Phase 8: Autopilot during ICT kill zones"
git push
```

# Prop Guardian

AI Risk & Process Coach untuk Prop Trader.

## Fitur

- **Risk Dashboard** — monitor drawdown, daily PnL, consecutive losses
- **Setup Quality Analyzer** — Grade A/B/C/D berdasarkan Trading Plan
- **Trade Journal** — catat trade dalam R-multiple + auto update risk
- **Trading Plan Engine** — definisikan edge kamu
- **Personal Rules** — lebih ketat dari aturan firm (kunci survival)

## Tech Stack

- React 19 + TypeScript
- Vite 6
- Tailwind CSS 4
- Zustand (state + persist)
- React Router 7

## Cara Menjalankan Lokal

```bash
npm install
npm run dev
```

Buka http://localhost:3000

## Deploy ke Vercel (via GitHub)

1. Push repo ke GitHub
2. Import project di [vercel.com](https://vercel.com)
3. Framework Preset: **Vite**
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Deploy

File `vercel.json` sudah disiapkan untuk handle SPA routing.

## Environment Variables

Copy `.env.example` → `.env.local` dan isi jika dibutuhkan (untuk fitur AI lanjutan).

```bash
cp .env.example .env.local
```

## Struktur Folder

```
prop-guardian-react/
├── public/
├── src/
│   ├── components/     # (siap ditambah)
│   ├── hooks/          # useStore (Zustand)
│   ├── lib/            # risk, analyzer, storage
│   ├── pages/          # Dashboard, Analyzer, Journal, Plan, Settings
│   ├── types/
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── .env.example
├── .gitignore
├── index.html
├── package.json
├── tsconfig.json
├── vercel.json
└── vite.config.ts
```

## Catatan

Data disimpan di `localStorage` browser (via Zustand persist).  
Belum ada backend / realtime market data — fokus ke risk & process dulu.

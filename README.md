# A & P Brothers (Pvt) Ltd — Inventory & Billing Management System

A multi-user, cloud-synced inventory, warehouse, order fulfillment, and invoicing platform built for **A & P Brothers (Pvt) Ltd** (motorcycle spare parts distributor in Sri Lanka, LKR currency).

## Tech Stack
- **Frontend**: React 19, TypeScript, Tailwind CSS v4, React Router, Recharts, Lucide Icons, jsPDF + html2canvas
- **Backend / Sync**: Firebase Authentication, Cloud Firestore (real-time `onSnapshot` listeners + multi-tab IndexedDB persistence), Firebase Storage
- **AI Assistant**: Server-side Express API (`/api/ai/chat`, `/api/ai/reorder-suggestions`) powered by `@google/genai`

---

## 1. Firebase Console Setup

1. Open the [Firebase Console](https://console.firebase.google.com/) for project `fir-web-codelab-ea5d2`.
2. **Authentication -> Sign-in method**:
   - Enable **Email/Password**.
   - Enable **Google** (recommended for single-click login).
3. **Cloud Firestore**:
   - Database ID configured in `firebase-applet-config.json`: `ai-studio-b8d26a18-790b-47a9-88be-c6c0875d7ae4`.
   - Paste and publish `firestore.rules` in the **Firestore -> Rules** tab (or deploy via CLI below).
4. **Firebase Storage**:
   - Bucket: `fir-web-codelab-ea5d2.firebasestorage.app`.
   - Paste and publish `storage.rules` in the **Storage -> Rules** tab.
   - *Note*: `storage.rules` references `/databases/ai-studio-b8d26a18-790b-47a9-88be-c6c0875d7ae4/documents/...`. If deploying against the `(default)` Firestore database, update that path in `storage.rules` to `(default)`.

---

## 2. Composite Indexes (`firestore.indexes.json`)

Create these composite indexes in **Firestore -> Indexes** (or deploy with `firebase deploy --only firestore:indexes`):

| Collection Group | Fields |
|---|---|
| `items` | `isDeleted` (ASC), `name` (ASC) |
| `items` | `isDeleted` (ASC), `status` (ASC), `name` (ASC) |
| `stockLedger` | `itemId` (ASC), `createdAt` (DESC) |
| `salesOrders` | `isDeleted` (ASC), `status` (ASC), `createdAt` (DESC) |
| `invoices` | `isDeleted` (ASC), `status` (ASC), `createdAt` (DESC) |
| `purchaseOrders` | `isDeleted` (ASC), `status` (ASC), `createdAt` (DESC) |
| `bills` | `isDeleted` (ASC), `status` (ASC), `createdAt` (DESC) |
| `activityLog` | `module` (ASC), `createdAt` (DESC) |
| `inviteTokens` | `email` (ASC), `status` (ASC) |

*(Note: List queries include a resilient fallback when indexes are still building.)*

---

## 3. Environment Variables

Configure via `.env` or your hosting environment's Secrets panel (never commit secrets):
- `GEMINI_API_KEY`: Google Gemini API key used strictly server-side by Express (`/api/ai/*`).
- `APP_URL`: Public application URL for callbacks/links.

---

## 4. Local Development, Testing & Production Build

```bash
# Install dependencies
npm install

# Run unit tests & security rules tests
npx tsx --test src/lib/calculations.test.ts firestore.rules.test.ts

# Lint Firestore security rules
npx eslint firestore.rules

# Start Express + Vite dev server on port 3000
npm run dev

# Build production bundle & start Node server
npm run build
npm start
```

---

## 5. Deploy to Firebase Hosting & Rules

```bash
npm install -g firebase-tools
firebase login
firebase use fir-web-codelab-ea5d2

# Deploy Firestore rules, composite indexes, and Storage rules
firebase deploy --only firestore:rules,firestore:indexes,storage

# Build and deploy static frontend (or deploy Express server to Cloud Run)
npm run build
firebase deploy --only hosting
```

# Evallo Billing & Scheduling Consistency Dashboard

A high-performance MERN monorepo application implementing a timezone-aware calendar dashboard. This solution strictly separates React presentation UI from business logic using a Zustand store, handles complex billing adjustments immutably on the backend, performs tutor double-booking conflict checks, and supports weekly recurrence generation.

---

## 🚀 Getting Started & Seed Data

### Prerequisites
- **Node.js** v18 or later
- **npm** v9 or later

### Installation & Run

1. **Install Root and Monorepo Dependencies:**
   At the root of the project, run:
   ```bash
   npm install
   ```

2. **Start the Concurrent Development Servers:**
   To spin up the Express backend and React Vite frontend concurrently, run:
   ```bash
   npm run dev
   ```
   - **Frontend:** Runs on [http://localhost:5173](http://localhost:5173)
   - **Backend:** Runs on [http://localhost:5000](http://localhost:5000)

### 🗄️ In-Memory MongoDB Seeding
Because system environments might not have a local MongoDB daemon (`mongod`) running, the backend is configured to use **`mongodb-memory-server`** as a fallback. 
- If `MONGO_URI` is not present in `.env`, the server automatically spins up an isolated, in-memory MongoDB instance.
- On startup, the database checks if any session records exist. If empty, it automatically seeds the database with:
  - An **Organization** (`Evallo Academy`)
  - A suite of **5 mock sessions** distributed across the current week featuring **Unbilled** (blue), **Billed** (amber), and **Completed** (grey/locked) statuses.
  - An **Invoice** document linked to all Billed sessions via `lineItems[].sessionId`, representing an already-issued billing period.
  - Consistent Tutor IDs to make it easy to trigger booking conflicts.
- If sessions already exist but no Invoice document is found (e.g., after the Atlas migration), a **back-seeder** automatically creates the Invoice on the next restart.

### 🔌 API Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/api/sessions` | Fetch all sessions |
| `POST` | `/api/sessions` | Create session(s) with optional weekly recurrence |
| `PUT` | `/api/sessions/:id` | Reschedule/update a session; triggers Adjustment if Billed |
| `GET` | `/api/invoices` | Fetch all invoices (billing periods + line items) |
| `GET` | `/api/adjustments` | Fetch all adjustments (immutable audit trail) |

---

## 🛠️ The "Why" - Architecture Decisions

### 1. State Separation & Presentation UI Decoupling
To comply with the strict React guidelines, all calendar fetching, client-side conflict checking, loading states, and backend network operations are abstracted into a single, clean Zustand store (`frontend/src/useSchedulingStore.js`). Components like `App.jsx` are purely presentational and call actions from the hook.

### 2. Immutable Billing Ledger
When a session is rescheduled or modified, the backend checks if its status is `Billed`. If so, rather than silently overwriting the history (which ruins financial traceability):
- The original invoice is kept intact.
- A new **Adjustment** entry is saved, referencing the sessionId, detailing a **$50.00 credit**, and logging the timestamp.
- The backend sends back an `adjustmentPreview` containing the calculated credit details, which intercepts the UI drag-and-drop to pop open an explicit human-in-the-loop validation modal before changes are committed.

### 3. Click Idempotency & Save Locks
- **Frontend:** Button click interactions toggle the `isSaving` store state, immediately locking UI buttons to prevent double-click race conditions.
- **Backend:** Employs a server-side short-term in-memory cache of active UUID request keys. Double requests with the same transaction key within a threshold are rejected.

---

## ⚖️ Tradeoffs & Simplifications

- **In-Memory Cache for Idempotency:** For the 4-6 hour assessment scope, an in-memory `Set` was used for backend request lock validation. In a distributed multi-instance production environment, this should be backed by a shared Redis cache.
- **Single-Timezone Presentation:** While timezone conversions are handled correctly in ISO-8601 UTC formats on save and fetch, the calendar UI columns are hardcoded to display in the New York Eastern zone for visual consistency during evaluation.
- **Adjustment Constant:** Adjustments are stubbed at a flat `$50.00` credit. A production engine would dynamically calculate differences based on hourly rates, session durations, or historical invoice line items.

---

## 🔮 Next Steps with Two Additional Days

If given two additional days, here is how we would robustly implement the following production requirements:

### 1. Daylight Saving Time (DST) Transitions
To prevent calendar visual shifts (sessions displaying an hour early or late) during DST switch weeks:
- Store all date inputs as timezone-naive local datetimes plus a separate timezone string (e.g., `America/New_York`) instead of raw UTC ISO strings.
- Utilize a timezone library like `date-fns-tz` or `luxon` to project local hours dynamically onto the grid columns depending on the day's local DST offset.

### 2. Recurrence Exceptions (e.g., editing one occurrence in a series)
- Introduce an `exceptions` array field to the recurrence parent schema storing dates of modified occurrences, or split the edited session into a standalone document with `recurrenceGroupId` but flagged as `isException: true`.
- When rendering, load the base recurrence rule, project the dates, subtract the exception dates from the generated series, and overlay the unique exception documents.

### 3. Partial Reschedules (Duration Changes)
- Allow session resizing directly on the calendar grid.
- If a `Billed` session changes duration:
  - If duration decreases: Calculate a pro-rated refund credit based on tutor hourly rate and record an `Adjustment`.
  - If duration increases: Prompt the user to choose between creating an "add-on charge" adjustment or issuing a separate invoice.

### 4. Tutor Reassignment within a Recurring Series
- Implement a modal asking: *"Apply change to: [This Session Only] or [All Future Sessions]?"*
- Selecting "All Future Sessions" splits the recurring group at the target date: updating `tutorId` on all subsequent occurrences, generating a new `recurrenceGroupId` for the split subset, and ending the old recurrence series.

### 5. Locking Paid Invoices
- Before performing any adjustment check, the backend will query the associated `Invoice` status.
- If the session belongs to an invoice marked `Paid`, prevent adjustments from editing it directly. Force the user to issue a formal "Credit Note" or "Debit Note" adjustment ledger record associated with a future billing period instead.

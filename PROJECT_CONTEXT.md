# PROJECT_CONTEXT

Read this first in every new AI session.

## Goal
- Build AI-powered classroom app: classes, lessons, live teaching, assignments, attendance.
- Keep teacher workflows fast; student workflows simple and safe.

## Stack
- Frontend: React 19, Vite, Tailwind v4, React Router, Zustand, Axios, socket.io-client.
- Backend: Node.js, Express, Prisma, SQLite (`backend/dev.db`), JWT auth, Socket.IO.

## Roles / Permissions
- Teacher: create/manage classes, lessons, assignments, attendance; run AI lesson tools.
- Student: join classes, view lessons, submit assignments, view own attendance only.
- Teacher-only gates enforced in backend for admin actions.

## Core Features (Implemented)
- Class creation/join flow with teacher/student separation.
- Assignment lifecycle: create, submit, grade, teacher delete.
- Lesson lifecycle: create, edit, publish/live, teacher delete.
- AI 3-step lesson generation:
  - Step 1 Structure
  - Step 2 Block Strategy
  - Step 3 Full Lesson
- AI per-block refinement: teacher edits one block only; other blocks untouched.
- Live lesson sockets: quiz sync, leaderboard, chat lock/unlock, live attendance count.

## Recent Runtime Fixes (Kept)
- Realtime socket wiring extracted to `backend/realtime/registerRealtimeHandlers.js` and used by `backend/index.js`.
- Class stream assignment cards no longer render nested anchor tags (`<a>` inside `<a>`).
  - Card navigation now uses a keyboard-accessible container.
  - Teacher `Grade` link and `Delete` button remain independent controls.
- `data-testid` hooks remain on key auth/class/lesson/assignment controls for stable automation hooks.
- Frontend Vite scripts now use `--configLoader native` to avoid the Windows Tailwind oxide / Rolldown `EPERM` config-loading failure.
- Frontend routes are lazy-loaded in `frontend/src/App.jsx` to keep the main bundle smaller and avoid the previous chunk-size warning.
- Frontend API base URL now derives from the browser host when `VITE_API_URL` is not set (reduces localhost/127.0.0.1 mismatch issues).
- Assignment submit flow now surfaces backend error details in UI and backend validates enrollment/assignment existence before insert.

## Block UX Rules
- `INTERACTIVE_SIMULATION`:
  - Clean consistent layout.
  - Built-in controls.
  - Clear state-change visualization.
  - Minimal config; AI-friendly generation.
- `CODE`:
  - In-browser notebook-like runtime.
  - Run inside lesson; no manual setup.
  - Library imports allowed.
  - Output shown below code.
  - Multiple runnable cells/sections.
  - Sandboxed execution.

## Attendance (Implemented)
- Data model: `AttendanceRecord` (Prisma + DB synced).
- Teacher manual mode: mark each student `PRESENT` / `ABSENT`.
- Teacher automatic mode: online students `PRESENT`, others `ABSENT`.
- Presence source: Socket.IO class presence (`join_class_presence`, `leave_class_presence`).
- Teacher attendance UI: [PeoplePage](D:/AI_Tutor/frontend/src/pages/PeoplePage.jsx).
- Student attendance UI: same page, read-only own records.
- APIs: [attendance.js](D:/AI_Tutor/backend/routes/attendance.js).

## Important Constraints
- Legacy data not priority; clean foundation preferred.
- Old/legacy assignment data can be discarded; no backward migration required.
- Keep old design references in `docs/design_mockups_legacy/` (read-only).
- Avoid committing generated/runtime clutter.
- Preserve teacher/student permission boundaries.

## Current Gaps / Next
- Add attendance analytics/export.
- Add E2E smoke for AI-generated lessons and attendance flow (if test suite is reintroduced).

## Context Size Rules
- Keep file under ~3,500 chars preferred (hard max 8,000).
- Use short bullets only; no logs, traces, long prose.
- Keep at most 4 recent "next actions".
- After editing, run: `npm run context:compact`.

<!-- SESSION_LOG_START -->
## Session Log

### 2026-03-23 - Compact Handoff Reset
- Rewrote context into minimal resumable format.
- Preserved required blocks: goal, stack, roles, features, attendance, constraints.
- Kept rules optimized for low token transfer.

### 2026-03-24 - Test Artifact Cleanup
- Removed generated test artifacts and test suites by request.
- Removed test-only config/scripts/dependencies from backend and frontend manifests.
- Retained runtime fixes (realtime handler extraction and assignment-card nested-link fix).

### 2026-03-24 - Windows Build Fix
- Resolved the local Tailwind oxide / Vite config loader `EPERM` issue by switching frontend Vite scripts to `--configLoader native`.
- Added route-level lazy loading so the frontend production bundle no longer emits the previous oversized-chunk warning.

### 2026-03-24 - API Reliability Fixes
- Updated backend AI endpoints to return actionable provider/auth errors instead of generic failures.
- Added clearer network-unreachable messaging for AI lesson generation and assignment submission in frontend UI.
<!-- SESSION_LOG_END -->

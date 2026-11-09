# PROJECT_DOCUMENTATION.md

Last updated: 2026-04-24

## Section 1 - High Level Description

**Academic Atelier** is a classroom platform for two roles: **TEACHER** and **STUDENT**.

- Teachers create classes, publish assignments, build interactive lessons, run live sessions, grade work, and manage attendance.
- Students join classes by code, complete assignments, participate in live lesson activities, and view grades/attendance.
- The stack is:
  - **Frontend:** React + Vite SPA (`frontend/`)
  - **Backend:** Express + Prisma + Socket.IO (`backend/`)
  - **Database:** PostgreSQL via Prisma datasource (`backend/prisma/schema.prisma`)

### Product Design Language (Required Context for Contributors)

Target Demographic is University/College students. The current UI styling is approved, but any future UI additions or changes must be designed with adults in mind (professional, minimalist, high information density).

## Section 2 - Feature List (High Level)

1. Authentication and profile management
2. Class creation, joining, listing, archive/unarchive
3. Class announcements feed and class stream timeline (announcements + assignments + lessons/quizzes)
4. Class roster management (student directory, detailed student profiles, remove-student workflow)
5. Teacher student-record remarks (private records per student in class)
6. Class materials library (teacher upload, class-wide download)
7. Assignment submission and grading workflow
8. Lesson authoring editor with notebook-style blocks
9. AI lesson generation (full draft, web-augmented, reference-file aware) and AI per-block refinement
10. Live lesson runtime with realtime quiz and teacher orchestration
11. AI chat tutor and written answer evaluation
12. Attendance tracking (manual and automatic using online presence)
13. Calendar/classwork/grades aggregation pages
14. Multi-language code notebook execution (JavaScript, Python, C, C++, Java, PHP)
15. Student private notes and personal lesson forks
16. Unrestricted teacher editing for published global lessons
17. Sandpack-based interactive simulation runtime with safe source inspection

## Section 3 - Low Level Description (Per Feature)

### Feature: Authentication and Session Handling

Frontend behavior:

- Auth state is stored in Zustand (`frontend/src/store/useAuthStore.js`), initialized from `localStorage` via `authService.getCurrentUser()`.
- Axios request interceptor adds `Authorization: Bearer <token>` when token exists.
- Axios response interceptor clears session and redirects to `/login` on HTTP 401.

Backend endpoints (`backend/routes/auth.js`):

- `POST /api/auth/register`
  - Body: `{ name, email, password, role }`
  - Role normalization: only `TEACHER` remains teacher, otherwise defaults to `STUDENT`.
  - Response `201`: `{ token, user }` where `user` includes profile + notification fields + `has_password`.
- `POST /api/auth/login`
  - Body: `{ email, password, role? }`
  - If `role` is sent and mismatched with account role, returns 403.
  - Response: `{ token, user }`.
- `POST /api/auth/google`
  - Body: `{ credential, role }`
  - Uses `GOOGLE_CLIENT_ID` and `google-auth-library` verification.
  - New users are auto-created (no password).
- `GET /api/auth/me`
  - Auth required.
  - Response: normalized client user object.
- `PATCH /api/auth/me`
  - Auth required.
  - Accepted fields: `name`, `avatar_url`, `notify_assignments`, `notify_due_soon`, `notify_announcements`.
- `PATCH /api/auth/me/password`
  - Auth required.
  - Body: `{ current_password?, new_password }`.
  - Requires `current_password` only if account already has password.

Auth middleware details (`backend/middleware/authMiddleware.js`):

- JWT payload supports backward compatibility: `payload.userId` or legacy `payload.id`.
- Canonical role is always reloaded from DB on each request (`TEACHER` or `STUDENT`), preventing stale-token role drift.
- `requireTeacher` gate checks `req.user.role === 'TEACHER'`.

### Feature: Classes (Create / Join / List / Archive)

Backend endpoints (`backend/routes/classes.js`):

- `GET /api/classes?archived=false|true|all`
  - Teacher: classes where `teacher_id = req.user.userId`.
  - Student: enrolled classes only.
  - Teacher list includes `_count.enrollments`.
- `GET /api/classes/:id`
  - Teacher must own class.
  - Student must be enrolled.
- `GET /api/classes/:id/students`
  - Teacher owner or enrolled student.
  - Returns class roster plus online-presence summary.
- `GET /api/classes/:id/students/:studentId`
  - Teacher owner may view any student in class.
  - Student can only view own detailed profile.
  - Includes attendance summary/recent attendance; teacher responses also include `student_records`.
- `POST /api/classes/:id/students/:studentId/records` (teacher-only owner)
  - Body: `{ title?, remark }`
  - Adds a private teacher record/remark for a student.
- `DELETE /api/classes/:id/students/:studentId/records/:recordId` (teacher-only owner)
  - Deletes a private teacher record/remark entry.
- `POST /api/classes` (teacher-only)
  - Body: `{ name, section }`
  - Generates uppercase 6-char class code.
- `POST /api/classes/join`
  - Body: `{ class_code }`
  - Student-only; rejects teacher join attempts.
  - Rejects archived classes and duplicate enrollment.
- `PATCH /api/classes/:id/archive` (teacher owner-only)
  - Sets `is_archived = true`, `archived_at = now`.
- `PATCH /api/classes/:id/unarchive` (teacher owner-only)
  - Sets `is_archived = false`, `archived_at = null`.
- `DELETE /api/classes/:id/students/:studentId` (teacher owner-only)
  - Removes the student enrollment and returns remaining roster count.

Frontend pages using this feature:

- `DashboardPage.jsx`
- `ArchivedClassesPage.jsx`
- `ClassStreamPage.jsx` (class info banner/modal)
- `ClassworkPage.jsx`, `ClassMaterialsPage.jsx`, `PeoplePage.jsx`, `AttendancePage.jsx`, `GradesPage.jsx` (support class-scoped mode via `?classId=...`)
- `PeoplePage.jsx` includes roster search, online/offline indicators, profile drawer, remove-student flow, and teacher `student_records`.
- `TopNavBar.jsx` (class-context breadcrumb/tabs are query-driven)

### Feature: Announcements (Class Stream Broadcast)

Backend endpoints (`backend/routes/announcements.js`):

- `GET /api/announcements/class/:classId`
  - Access: class teacher or enrolled student.
  - Returns announcements sorted by `created_at desc`.
- `POST /api/announcements/class/:classId` (teacher-only owner)
  - Body: `{ message }`.
  - Rejects empty messages, length > 5000 chars, and archived classes.
- `DELETE /api/announcements/:id` (teacher-only owner)
  - Deletes a class announcement.

Frontend pages/components using this feature:

- `ClassStreamPage.jsx` (announcement fetch + stream cards + create modal + delete action)
- `TeacherCreateMenu.jsx` (Announcement action)
- `ClassworkPage.jsx` (teacher create menu forwards to stream action query)
- `services/api.js` (`announcementService.getByClass`, `create`, `remove`)

### Feature: Class Materials (Upload / List / Download)

Backend endpoints (`backend/routes/materials.js`):

- `GET /api/materials/class/:classId`
  - Returns class materials sorted by `created_at desc`.
  - Access: class teacher or enrolled student.
- `POST /api/materials/class/:classId` (teacher-only owner)
  - Body: `{ fileName, mimeType, base64 }`.
  - Rejects archived classes.
  - File payload is decoded from base64 and size-limited by `MATERIAL_MAX_FILE_BYTES` (default 15 MB).
- `GET /api/materials/:materialId/download`
  - Streams file bytes with attachment headers.
  - Access: class teacher or enrolled student.

Frontend pages/components using this feature:

- `ClassMaterialsPage.jsx` (class-scoped materials hub)
- `TopNavBar.jsx` (class tab includes `Class Material`)
- `services/api.js` (`materialService.listByClass`, `uploadToClass`, `download`)

### Feature: Assignments (Create / Submit / Grade / Delete)

Backend endpoints (`backend/routes/assignments.js`):

- `GET /api/assignments/class/:classId`
  - Teacher owner or enrolled student only.
  - Student responses include computed `completed` boolean.
- `GET /api/assignments/:id`
  - Teacher owner or enrolled student only.
  - Student view includes only own submissions in `submissions` array.
- `POST /api/assignments` (teacher-only)
  - Body: `{ class_id, title, description, due_date, attachment_url }`
  - Archived classes are blocked.
- `POST /api/assignments/:id/submit`
  - Student-only.
  - Body: `{ file_url }` (string required; used for typed text/link payload in current UI).
- `GET /api/assignments/:id/submissions` (teacher-only owner)
  - Response includes `student: { id, name, email }` per submission.
- `PUT /api/assignments/submissions/:submissionId/grade` (teacher-only owner)
  - Body: `{ grade, feedback }`, grade must be numeric 0..100.
- `DELETE /api/assignments/:id` (teacher-only owner)
  - Transactionally deletes all `Submission` rows then the `Assignment`.

Frontend pages using this feature:

- `ClassStreamPage.jsx`
- `AssignmentView.jsx`
- `AssignmentGradingPage.jsx`
- `ClassworkPage.jsx`
- `GradesPage.jsx`
- `CalendarPage.jsx`

### Feature: Lesson Authoring (CRUD + Notebook Blocks)

Backend endpoints (`backend/routes/lessons.js`):

- `GET /api/lessons/class/:classId`
  - Returns only global class lessons (`owner_student_id = null`), sorted by `created_at desc`.
  - Authorization:
    - `TEACHER`: must own the class.
    - `STUDENT`: must be enrolled in the class, and only sees `PUBLISHED`/`LIVE` global lessons.
  - Returns `403` when caller is authenticated but not authorized.
- `GET /api/lessons/class/:classId/personal` (student-only)
  - Returns the authenticated student's personal lesson forks for this class (`owner_student_id = req.user.userId`).
- `GET /api/lessons/:id`
  - Returns lesson and ordered blocks.
  - Authorization:
    - `TEACHER`: must own the lesson's class and can only access global lessons.
    - `STUDENT`: must be enrolled; may access global visible lessons or own personal fork lessons.
  - Returns `403` when caller is authenticated but not authorized.
- `POST /api/lessons` (teacher-only, class owner, class not archived)
  - Body: `{ class_id, title }`
  - Creates lesson with status `DRAFT`.
- `POST /api/lessons/:id/fork` (student-only)
  - Creates or returns a personal fork from a visible global lesson.
  - Fork copy is tied to `(owner_student_id, source_lesson_id)` and includes cloned ordered lesson blocks.
- `PUT /api/lessons/:id` (teacher or student)
  - Body: `{ title?, status?, blocks? }`
  - `TEACHER`:
    - may fully edit global lessons in owned, non-archived classes, including block reorder/edit/delete after publish.
    - may update lesson status (`DRAFT`, `PUBLISHED`, `LIVE`).
    - cannot edit student personal forks.
  - `STUDENT`:
    - may edit own personal fork lesson directly.
    - if target is a visible global lesson, backend auto-forks first and applies edits to the student's private fork.
    - cannot change lesson status.
- `GET /api/lessons/:id/personal-blocks` (student-only)
  - Returns only the authenticated student's personal blocks for the lesson.
- `POST /api/lessons/:id/personal-blocks` (student-only)
  - Creates a personal `TEXT`, `CODE`, or `INTERACTIVE_SIMULATION` block.
  - Supports anchor insertion via `after_block_id`.
- `PUT /api/lessons/:id/personal-blocks/:blockId` (student-only owner)
  - Updates only blocks owned by `student_id = req.user.userId`.
- `DELETE /api/lessons/:id/personal-blocks/:blockId` (student-only owner)
  - Deletes only blocks owned by the authenticated student.
- `POST /api/lessons/:id/personal-blocks/:blockId/refine-ai` (student-only owner)
  - AI refinement for personal `CODE` and `INTERACTIVE_SIMULATION` blocks.
  - Uses block-local context only (no full lesson rewrite).
  - Accepts optional `referenceImages` array for multimodal context:
    - `{ name, mimeType, base64 }`
- `DELETE /api/lessons/:id` (teacher-only owner)
  - Deletes dependent `QuizResponse`, `QuizSession`, `ChatMessage`, `LessonBlock` records in transaction.
  - Global lessons only; teacher cannot delete student personal lesson forks.

Editor page:

- `frontend/src/pages/LessonEditor.jsx`
- Local state: `title`, `blocks`, `saving`, `aiEdit*` modal state.
- Blocks are fully re-orderable/editable regardless of published status.
- Student editing a global lesson triggers automatic fork-on-save to their private lesson copy.

### Feature: AI Lesson Generation and AI Block Refinement

AI generation endpoint:

- `POST /api/lessons/generate` (teacher-only)
- Body (current): `{ topic, gradeLevel?, targetDuration, referenceContent?, referenceFiles?, interactivityLevel?, defaultCodeLanguage? }`
- `referenceFiles` (optional) is an array of objects:
  - `{ name, mimeType, base64 }`
  - Supports PDFs, PowerPoint, images, docs/spreadsheets, text/code files, and other model-supported file types.
- Generation pipeline is multi-stage and reliability-hardened:
  1. **Reference file context extraction**
     - Text-like files are decoded directly.
     - Binary/media files are summarized through Gemini file-aware extraction.
     - Input is size/count bounded and warnings are tracked.
  2. **Structured web research bundle**
     - Multi-query retrieval + trust/recency ranking.
     - Grounded Google fallback merges in when evidence quality is low.
     - Redis-backed research cache with in-memory fallback.
  3. **Structure plan**
  4. **Block strategy**
     - Server enforces section block density (3–6 per section).
  5. **Deep section generation (parallel)**
     - Sections are generated concurrently.
     - Failed sections are backfilled with deterministic fallback blocks and merged chronologically.
  6. **Post-generation factual verifier**
     - Auto-softens unsupported claims and can replace risky chart/mermaid outputs with safe fallbacks.
  7. **Simulation code pass**
- Response: `{ title, blocks, _generationMeta? }`.
- `_generationMeta` can include:
  - section reliability: `failedSections`, `fallbackSectionsCount`, `warning`
  - research traceability: `researchSources`, `researchUsage`, `researchWarnings`, `researchCache`
  - file traceability: `referenceFilesUsed`, `referenceFileWarnings`

AI block refinement endpoint:

- `POST /api/lessons/:id/refine-block` (teacher-only owner)
- Body: `{ blockType, blockContent, instructions, referenceImages? }`
- `referenceImages` is optional and accepts image attachments as:
  - `{ name, mimeType, base64 }`
- Valid images are passed to Vertex AI as multimodal refine context.
- Returns: `{ content }` with schema-aware normalization by block type.

Shared AI configuration:

- Uses `@google/genai` with Vertex routing.
- Configured via `GCP_PROJECT_ID`, `GCP_REGION`, and `GOOGLE_APPLICATION_CREDENTIALS`.
- Models:
  - `VERTEX_AI_GENERATION_MODEL` for lesson generation/refinement/research extraction
  - `VERTEX_AI_CHAT_MODEL` for streaming lesson chat

### Feature: Live Lesson Runtime and Realtime Orchestration

Primary live page:

- `frontend/src/pages/LiveLessonView.jsx`

Live lesson local state model (no context; no Redux):

- `lesson`, `loading`
- `messages` (AI chat transcript)
- `isChatLocked`
- `activeQuizzes` map by blockId
- `quizResults` map by blockId and option index
- `exerciseStates` map by blockId
- `leaderboard` map by userId
- `quizPhase` (`CONTENT`, `WAITING`, `RANKING`)
- `showLeaderboardSidebar`
- `studentCount`
- `understandingPercent`
- `socketRef` (`useRef`) for shared socket instance
- Derived gate: `hasLiveQuiz = Boolean(finalQuizBlockId)` where `finalQuizBlockId` is the last official `QUIZ` block ID in the lesson.

Live runtime scope:

- Live-only UI (live chip, Podium tab/sidebar, ranking overlays, teacher control panel) renders only when `hasLiveQuiz` is true.
- Lessons without a `QUIZ` block still open in `LiveLessonView`, but in standard lesson mode (chat + content only, no live competition UI).

Socket server wiring:

- Backend handler file: `backend/realtime/registerRealtimeHandlers.js`
- Registered from `backend/index.js`

Client emits seen in frontend:

- `join_lesson(lessonId)`
- `start_quiz({ lessonId, blockId, timeLimit })`
- `stop_quiz({ lessonId, blockId })`
- `submit_answer({ lessonId, blockId, optionIndex, userId, userName })`
- `chat_lock({ lessonId })` / `chat_unlock({ lessonId })`
- `start_final_quiz({ lessonId })`
- `show_leaderboard({ lessonId })`
- `join_class_presence({ classId, userId, role })`
- `leave_class_presence({ classId, userId })`

Server emits handled in frontend:

- `quiz_started`
- `quiz_stopped`
- `answer_received`
- `chat_locked`
- `chat_unlocked`
- `attendance_updated`
- `start_final_quiz`
- `show_leaderboard`
- `class_presence_updated` (People page)

Additional server emits currently implemented but not actively consumed by UI:

- `user_joined`
- `receive_message`

Quiz scoring behavior (server-side):

- If `pointsEarned` present in payload, uses it directly.
- Otherwise score = `1000 + round(timeLeft * 50)` based on active session timer.
- `start_quiz`, `stop_quiz`, and `submit_answer` are accepted only for the lesson's final `QUIZ` block.
- After final quiz `stop_quiz`, student UI transitions to static closed mode (results visible, no new live answers).
- Client-side `start_final_quiz` / `show_leaderboard` transitions are ignored when no final `QUIZ` block exists.

### Feature: AI Tutor Chat and Written Evaluation

Endpoints (`backend/routes/chat.js`):

- `POST /api/lesson-chat/message`
  - Body: `{ lessonId, messages }`
  - Builds lesson-aware system prompt by loading lesson blocks.
  - Executes Vertex AI stream (`streamGenerateContent`) using `VERTEX_AI_CHAT_MODEL` (default `gemini-2.5-flash`).
  - Natively uses Google Search Grounding (`googleSearch`) for real-time external contexts.
  - Response: Streams NDJSON (`{ type, message/text, usedWebContext, webContext }`).
- `POST /api/lesson-chat/evaluate-answer`
  - Body: `{ question, idealAnswer, studentAnswer }`
  - Evaluates student answers using Vertex AI.
  - Generates feedback and extracts score via `SCORE: X/10` output pattern.
  - Response: `{ feedback, score }`.

### Feature: Student Notes (Per-Block Private Notes)

Endpoints (`backend/routes/notes.js`):

- `GET /api/notes?lessonId=...&blockId=...` (student-only)
  - `lessonId` is required.
  - `blockId` is optional; when present it must belong to the lesson (official or student personal block).
- `POST /api/notes` (student-only)
  - Body: `{ lessonId, blockId, content }`.
  - Creates note scoped to the authenticated student.
- `PUT /api/notes/:id` (student-only owner)
  - Body: `{ content }`.
- `DELETE /api/notes/:id` (student-only owner)
  - Deletes own note.

Frontend usage:

- `LiveLessonView.jsx` loads lesson notes and supports add/edit/delete per block.
- `services/api.js` exposes `notesService.list/create/update/remove`.

### Feature: Attendance

Endpoints (`backend/routes/attendance.js`):

- `GET /api/attendance/class/:classId/day?date=YYYY-MM-DD` (teacher owner)
  - Response includes roster, statuses, online flags, summary.
- `POST /api/attendance/class/:classId/day/manual` (teacher owner)
  - Body: `{ date, records: [{ student_id, status }] }`
  - Upserts per student/day with mode `MANUAL`.
- `POST /api/attendance/class/:classId/day/automatic` (teacher owner)
  - Body: `{ date }`
  - Uses online presence set; mode `AUTO`.
- `GET /api/attendance/my?classId=...` (student)
  - Returns own historical records (up to 120) and summary.

Presence service (`backend/services/presenceStore.js`):

- Primary mode uses Redis sets for horizontal scaling:
  - `class:{classId}:online`
  - `class:{classId}:user:{userId}:sockets`
  - `socket:{socketId}:classes`
- If Redis is not configured or unavailable, logic gracefully falls back to in-memory Maps/Sets for local development.
- `getOnlineStudentIdsForClass(classId)` returns student IDs from Redis set (or in-memory fallback).

### Feature: Database Model (Prisma Schema)

Source: `backend/prisma/schema.prisma`

- `User`
  - Fields include identity (`id`, `name`, `email`, `password?`, `role`), profile (`avatar_url`), notification flags, `created_at`.
  - Relations:
    - teaches many `Class` records via relation `TeacherClasses`
    - has many `Enrollment`, `Submission`, `ChatMessage`
    - has many `StudentNote` and `StudentPersonalBlock`
    - uploads many `ClassMaterial` records
    - creates and receives many `StudentRecord` records
    - can own many personal lesson forks via `owned_lessons`
    - attendance relations:
      - `attendance_marked` (`AttendanceMarkedBy`)
      - `attendance_records` (`AttendanceStudent`)
- `Class`
  - Fields: `name`, `section?`, unique `class_code`, `teacher_id`, archive fields (`is_archived`, `archived_at`).
  - Relations: `teacher`, `enrollments`, `assignments`, `announcements`, `lessons`, `attendance_records`, `materials`, `student_records`.
- `ClassMaterial`
  - Stores uploaded class file payload and metadata (`file_name`, `mime_type`, `size_bytes`, `file_blob`, `uploader_id`).
  - Indexed by class and uploader timestamps.
- `StudentRecord`
  - Private teacher record attached to a class/student (`title?`, `remark`, `created_by`).
  - Indexed by class/student and creator/time.
- `Enrollment`
  - Join table between `User` and `Class` (`user_id`, `class_id`).
- `Assignment`
  - Belongs to class (`class_id`), has metadata (`title`, `description?`, `due_date?`, `attachment_url?`).
  - One-to-many with `Submission`.
- `Submission`
  - Belongs to assignment and student (`assignment_id`, `student_id`).
  - Stores `file_url`, optional `grade`, optional `feedback`, `submitted_at`.
- `Announcement`
  - Class announcement text + `created_at`.
- `Lesson`
  - Belongs to class (`class_id`), includes `title`, `created_by`, `status`, `created_at`.
  - Fork ownership fields:
    - `owner_student_id` (nullable): set for student personal lesson forks.
    - `source_lesson_id` (nullable): links fork to original global lesson.
  - Relations include fork lineage (`source_lesson`, `derived_lessons`) and student owner (`owner_student`).
  - Constraints/indexes include:
    - unique `(owner_student_id, source_lesson_id)` to enforce one fork per student per source lesson.
    - lookup indexes on class+owner and source lesson.
  - Has many `LessonBlock`, `QuizSession`, `ChatMessage`.
- `LessonBlock`
  - Stores ordered lesson content (`lesson_id`, `type`, `content`, `order_index`).
- `StudentNote`
  - Student-private note keyed by lesson + block (`user_id`, `lesson_id`, `block_id`, `content`).
- `StudentPersonalBlock`
  - Student-owned per-lesson personal block (`lesson_id`, `student_id`, `after_block_id?`, `type`, `content`, `order_index`).
- `QuizSession`
  - Belongs to lesson; has `active` and optional `current_question`.
  - Has many `QuizResponse`.
- `QuizResponse`
  - Belongs to quiz session (`session_id`) and stores `student_id`, `answer`, optional `score`.
- `ChatMessage`
  - Belongs to lesson and user; stores `message`, `role`, `timestamp`.
- `AttendanceRecord`
  - Belongs to class, student, and marker (`marked_by` user).
  - Fields: `attendance_date`, `status`, `mode`, timestamps.
  - Constraints:
    - unique on (`class_id`, `student_id`, `attendance_date`)
    - indexed by (`class_id`, `attendance_date`) and (`student_id`, `attendance_date`)

## Section 4 - UI Blocks (Reusable Blocks)

Lesson block rendering occurs in both `LessonEditor.jsx` (authoring) and `LiveLessonView.jsx` (runtime).

### TEXT block

- Storage type: plain string
- Editor: textarea explanation content
- Live: rendered paragraph-like text

### DISCUSSION block

- Storage type: plain string prompt
- Editor: textarea prompt
- Live: highlighted discussion card

### CODE block (`CodeNotebookBlock`)

- Component: `frontend/src/components/CodeNotebookBlock.jsx`
- Props:
  - `content`
  - `code` (fallback alias)
  - `onChange`
  - `editable` (default `false`)
  - `blockId`
- Content supports:
  - Legacy string code (split by `// %%` markers)
  - Notebook object `{ version, language, runtime, defaultLanguage, code, cells[] }`
- Runtime:
  - Runtime language selector in block UI: JavaScript, Python, C, C++, Java, PHP.
  - JavaScript runs in-browser using the sandboxed iframe runtime.
  - Python/C/C++/Java/PHP execute through backend `POST /api/execute-code` (authenticated) which proxies to a remote sandbox execution API.
  - Shared notebook text remains common; only execution context changes with selected runtime language.
  - Browser runtime keeps helper APIs: `display`, `print`, `table`, `html`, `plot`, `fetchJson`, `importLib`.

### EXERCISE block

- Storage type: object `{ question, options[] }`
- Option structure: `{ text, isCorrect, feedback }`
- Editor: option CRUD + correct-answer radio
- Live: local answer selection + feedback reveal

### MCQ block (`InteractiveQuiz`, type `QUIZ`)

- Component props:
  - `block`
  - `userRole`
  - `isActive`
  - `onStart(blockId)`
  - `onStop(blockId)`
  - `onSubmit(blockId, optionIndex)`
  - `results`
- Storage type: object `{ question, options[], timeLimit }`
- Live uses socket-driven active/stop/result states.

### Written Question block (`WrittenQuiz`, type `WRITTEN_QUIZ`)

- Component props:
  - `block`
  - `userRole`
- Storage type: object `{ question, idealAnswer }`
- Student submits free text for AI evaluation.

### INTERACTIVE_SIMULATION block (`InteractiveSimulationBlock`)

- Component props:
  - `block`
  - `compact` (default `false`)
- Storage type: object including:
  - `title`, `description`, `hint`, `solutionText`
  - `template` (`react` or `vanilla`)
  - `files` object (Sandpack file map like `/App.js`, `/styles.css`, `/index.js`)
- Runtime:
  - Rendered via `@codesandbox/sandpack-react` with a safe embedded runtime.
  - Default mode is preview-first; "View Source Code" toggles to editor+preview.
  - Protected by `SandpackErrorBoundary` so compile/runtime faults do not crash lesson view.
  - Legacy `html/css/js` payloads are normalized into Sandpack-compatible files for backward compatibility.

### Other reusable UI components

- `ChatAssistant({ messages, onSendMessage, isLocked, user })`
- `TeacherControlPanel({ lessonId, socket, isChatLocked, onToggleChat, onStartCompetition, onShowPodium, studentCount, understandingPercent })`
- `Sidebar({ onJoinClass })`
- `TopNavBar()` (context-aware class header + tabs)
  - Menu icon toggles side menu state (desktop collapse/expand and mobile drawer open/close).
  - Class breadcrumb and class tabs render only on class-context routes (`/class/stream`, `/classwork`, `/class/materials`, `/people`, `/attendance`, `/grades`) when `classId` exists.
  - Core class tabs render for all roles: `Stream`, `Classwork`, `Class Material`, `People`, `Attendance`.
  - `Grades` tab renders only for `TEACHER` and is not present in DOM for `STUDENT`.

## Section 5 - Buttons and Controls (Inventory)

### Global navigation

- Top bar menu button toggles side menu (desktop collapse/expand, mobile drawer open/close).
- Top bar class context (only on `/class/stream`, `/classwork`, `/class/materials`, `/people`, `/attendance`, `/grades` with `?classId=...`):
  - Breadcrumb: `Classroom > {Class Name}`
  - Tabs: `Stream`, `Classwork`, `Class Material`, `People`, `Attendance` (all roles), and `Grades` (teacher-only); tabs preserve `classId` query.
- Top bar outside class context: class breadcrumb and class tabs are hidden.
- App menu links: Stream, Classwork, People, Attendance, Grades, Settings (plus `Class Material` when in class context)
- Profile menu actions: Manage account, Sign out
- Sidebar links: Home, Calendar, Enrolled, Archived, Settings, Help, Privacy

### Dashboard

- Create/Join class trigger (card + mobile FAB)
- Class actions menu (teacher): Open class, Copy class code, Archive class
- Archived Classes navigation
- View All Tasks quick action

### Class stream

- Teacher actions:
  - `Create` menu (teacher-only, disabled for archived classes):
    - Announcement
    - Assignment
    - Lesson -> Lesson with AI / Lesson manually
    - Quiz -> Quiz with AI / Quiz manually
  - Delete Announcement
  - Delete Assignment
  - Delete Lesson
- Modals:
  - Create announcement
  - Create assignment
  - Create lesson / create quiz (manual mode)
  - Generate AI lesson / generate AI quiz (topic + reference text + reference file/image uploads, including PDF snapshots)
  - Class info
- Assignment row actions (teacher): Grade, Delete

### Classwork

- Teacher-only create menu in class-scoped mode (`/classwork?classId=...`) mirrors stream create actions:
  - Announcement
  - Assignment
  - Lesson -> Lesson with AI / Lesson manually
  - Quiz -> Quiz with AI / Quiz manually
  - Action routes back to class stream with query-driven modal open.
- Student-only lesson collection switcher in class-scoped mode (`/classwork?classId=...`):
  - `Global Lessons`: teacher-published lessons for the class.
  - `Personal Lessons`: the student's own forked/modified lesson copies.
- Student row actions:
  - Global lesson: `Open Lesson`, `Edit My Copy` (fork then open editor).
  - Personal lesson: `Open Editor`.

### Class materials

- Page route: `/class/materials?classId=...`
- Teacher actions:
  - Choose file
  - Upload material (disabled for archived classes)
- All roles:
  - Refresh materials list
  - Download file

### Lesson editor

- Top actions:
  - Teacher global lesson: Save, Publish, Run Quiz Live (live button only when lesson contains at least one `QUIZ` block)
  - Student personal/global-edit path: Save only
- Per-block controls: move up/down, AI refine (teacher), delete
- Inline add-block row: Text, Code, Exercise, Prompt, Written Question Block, Simulation, Diagram, Chart
- Floating add menu duplicates block insertion options
- `Quick Quiz` insertion from the lesson editor add controls has been removed; quiz authoring now starts from class stream/classwork `Create -> Quiz`.

### Live lesson

- Top action:
  - When lesson has live quiz:
    - Teacher: Stop Presenting (link back to editor)
    - Student: Exit Live Session (link back to class stream)
  - When lesson has no live quiz:
    - Teacher: Back to Editor
    - Student: Back to Class
- Sidebar behavior:
  - With live quiz: Chat / Podium tabs
  - Without live quiz: Chat-only sidebar
- Teacher control panel:
  - Renders only when lesson has live quiz
  - Includes COMPETITION, PODIUM, LOCKED / OPEN chat toggle, student count, and understanding percentage
- Fullscreen ranking/waiting overlays render only for live quiz sessions

### People page

- Class selector (visible when route has no `?classId=...`)
- In class-context mode (`/people?classId=...`), class selector is hidden and the page stays locked to that class.
- Search students by name/email.
- Roster shows online/offline state from realtime presence updates.
- Profile drawer:
  - Teacher: detailed attendance summary, recent attendance table, add/delete private student records, remove student from class.
  - Student: view-only profile snapshot.

### Attendance page

- Page route: `/attendance` (supports `?classId=...` class-context mode).
- Class selector hidden in class-context mode.
- Date selector (teacher).
- Teacher actions:
  - Auto Mark (Online = Present)
  - Save Manual Attendance
  - Refresh snapshot
  - Per-student Present/Absent toggle
- Student mode:
  - View own attendance history + summary for selected class.

### Assignment / grading pages

- Student: Turn in submission
- Teacher: Grade submissions, Return to Student, Save Draft

### Settings

- Save Profile
- Save Notifications
- Change/Set Password

### Utility pages

- Back to Dashboard

### Forgot Password

- Send Reset Link
- Cancel / Back to Login

## Section 6 - User Roles

### TEACHER

Server-enforced permissions:

- Create classes
- Archive/unarchive owned classes
- Manage class roster (view students, remove students)
- Create/delete class announcements
- Add/delete private student records (`student_records`)
- Create/update/delete global lessons in owned classes
- Fully edit/reorder published global lessons (no publish-lock restrictions)
- Generate/refine AI lesson content for owned classes
- Create/delete assignments in owned classes
- Grade submissions for owned assignments
- Read and modify attendance for owned classes

UI capabilities:

- Dashboard class management
- Class stream content creation and deletion
- People page roster + student profile management
- Full lesson editor and quiz-live controls
- Live lesson teacher orchestration panel (quiz sessions only)
- Attendance roster control

### STUDENT

Server-enforced permissions:

- Join class by code
- Access enrolled classes
- Submit assignments (teacher submission blocked)
- Access class roster and own student profile details within enrolled classes
- View own attendance via `/api/attendance/my`
- Fork teacher global lessons into private personal lesson copies
- Edit only own personal lesson forks (global lessons remain unaffected)
- Create/update/delete own lesson notes

UI capabilities:

- Consume lesson blocks
- Participate in live quiz/exercise/written simulation interactions
- Use AI tutor chat unless locked by teacher
- View own grade status

### Admin note

No standalone `ADMIN` role or admin panel is implemented in scanned code. Administrative operations are teacher-scoped.

## Section 7 - Page Structure

### Frontend routes (`frontend/src/App.jsx`)

- `/`, `/login` -> `LoginPage`
- `/forgot-password` -> `ForgotPasswordPage`
- `/dashboard` -> `DashboardPage`
- `/classwork` -> `ClassworkPage` (supports optional `?classId=...` class-context mode)
- `/class/materials` -> `ClassMaterialsPage` (requires `?classId=...` for class-context data)
- `/people` -> `PeoplePage` (supports optional `?classId=...` class-context mode)
- `/attendance` -> `AttendancePage` (supports optional `?classId=...` class-context mode)
- `/grades` -> `GradesPage` (supports optional `?classId=...` class-context mode)
- `/calendar` -> `CalendarPage`
- `/archived` -> `ArchivedClassesPage`
- `/settings` -> `SettingsPage`
- `/help`, `/privacy`, `/terms` -> `UtilityPage`
- `/class/stream?classId=...` -> `ClassStreamPage`
- `/assignment/:id` -> `AssignmentView`
- `/assignment/:id/grade` -> `AssignmentGradingPage`
- `/lesson/edit?lessonId=...` -> `LessonEditor`
- `/lesson/live?lessonId=...` -> `LiveLessonView`

Class-context navigation note:

- When a class is open, top tabs preserve the same class by carrying `?classId=...` across Stream/Classwork/Class Material/People/Attendance/Grades.

All page components are lazy-loaded via `React.lazy` + `Suspense`.

### Backend router mounts (`backend/index.js`)

- `/api/auth`
- `/api/classes`
- `/api/assignments`
- `/api/lessons`
- `/api/lesson-chat`
- `/api/attendance`
- `/api/announcements`
- `/api/materials`
- `/api/execute-code`
- `/api/notes`

Additional routes:

- `GET /` health text
- `GET /classes` simple Prisma class dump (non-authenticated utility route)

### State management summary

- Global auth/session: Zustand (`useAuthStore`)
- Everything else: component-local React state
- No React Context for app domain state
- Realtime sockets managed directly in page components (`useRef` + `useEffect`)

## Section 8 - Interaction Flow

### Flow A: Teacher creates class, student joins

1. Teacher logs in and opens Dashboard.
2. Teacher creates class (`POST /api/classes`), receives generated class code.
3. Student logs in and joins with class code (`POST /api/classes/join`).
4. Dashboard refreshes class list for each role.

### Flow B: Teacher assigns work, student submits, teacher grades

1. Teacher opens class stream and creates assignment (`POST /api/assignments`).
2. Student opens assignment and submits turn-in payload (`POST /api/assignments/:id/submit`).
3. Teacher opens grading page, selects submission.
4. Teacher returns grade (`PUT /api/assignments/submissions/:submissionId/grade`).

### Flow C: Teacher builds lesson and runs quiz live

1. Teacher creates lesson manually or by AI generation.
2. Teacher edits blocks in Lesson Editor and saves (`PUT /api/lessons/:id`).
3. Teacher can continue editing/reordering blocks even after publish; updates are saved on the same global lesson.
4. If the lesson contains a `QUIZ` block, teacher can open live route and run realtime quiz + podium orchestration through Socket.IO events.

### Flow D: Student opens lesson runtime

1. Student opens lesson runtime route (`/lesson/live?lessonId=...`).
2. Client fetches lesson blocks via `/api/lessons/:id`.
3. Client joins lesson room and class-presence room.
4. Student can use AI tutor chat if unlocked; realtime quiz submission appears only when lesson has an active final `QUIZ` block.

### Flow E: Student forks and edits personal lesson copy

1. Student opens class-scoped Classwork and selects `Global Lessons`.
2. Student clicks `Edit My Copy` (or saves edits from a global lesson in editor).
3. Backend creates or reuses student fork (`owner_student_id`, `source_lesson_id`) and clones lesson blocks.
4. Student edits the personal lesson; teacher global lesson remains unchanged.
5. Student can switch to `Personal Lessons` in Classwork to revisit and continue private edits.

### Flow F: Teacher attendance operations

1. Teacher opens Attendance page and picks class/date.
2. Teacher loads day snapshot (`GET /api/attendance/class/:classId/day`).
3. Teacher either:
   - saves manual statuses (`POST .../manual`), or
   - runs automatic attendance from online presence (`POST .../automatic`).
4. Student can view own history via `GET /api/attendance/my?classId=...`.

## Section 9 - Cloud Migration Status (Current)

The application operates on a Cloud-Native architecture using Google Cloud Platform (GCP).

### Confirmed migration state

- Backend and Frontend fully Dockerized for Cloud Run (`PORT=8080`).
- Frontend container utilizes a 2-stage Vite build routing through `nginx:alpine`.
- Prisma connects to Cloud SQL (PostgreSQL).
- AI interactions are Vertex-based using `@google/genai` (Vertex mode).
- Lesson generation uses hybrid retrieval (DuckDuckGo multi-query + grounded Google fallback), while lesson chat uses native Google Search Grounding.
- Redis caching persists for WebSocket presence tracking (auto-falls back to memory if REDIS_URL absent).

### Required environment variables

Backend (`backend/.env`):

- `DATABASE_URL` (PostgreSQL connection string)
- `FRONTEND_URL` (primary CORS allowlist origin)
- `FRONTEND_URLS` (optional comma-separated additional CORS origins)
- `CORS_ALLOW_ALL` (optional emergency override; `true` allows all origins)
- `JWT_SECRET` (used by auth middleware and auth routes for token signing/verification)
- `GCP_PROJECT_ID`
- `GCP_REGION`
- `GOOGLE_CLIENT_ID` (required for backend Google token verification)
- `GOOGLE_APPLICATION_CREDENTIALS` (Service account JSON for local/CI tests)
- `VERTEX_AI_GENERATION_MODEL`
- `VERTEX_AI_CHAT_MODEL`
- `PORT` (Cloud Run/runtime port; defaults to `8080`)
- `REDIS_URL` (optional)
- `PISTON_URL` (preferred code execution provider endpoint; optional if using Judge0-only)
- `JUDGE0_URL` (fallback code execution provider; defaults to `https://ce.judge0.com`)
- `REQUEST_BODY_LIMIT` (JSON payload limit; defaults to `30mb`)
- `MATERIAL_MAX_FILE_BYTES` (class material upload size cap; default 15 MB)
- `RESEARCH_CACHE_TTL_SECONDS`
- `RESEARCH_MAX_QUERIES`
- `RESEARCH_MAX_GLOBAL_EVIDENCE`
- `RESEARCH_MAX_SECTION_EVIDENCE`
- `RESEARCH_MIN_CONFIDENCE`
- `MAX_REFERENCE_FILES`
- `MAX_REFERENCE_FILE_BYTES`
- `MAX_REFERENCE_TOTAL_BYTES`
- `MAX_GENERATE_REFERENCE_IMAGES`
- `MAX_GENERATE_REFERENCE_IMAGE_BYTES`
- `MAX_GENERATE_REFERENCE_IMAGE_TOTAL_BYTES`
- `MAX_REFINE_REFERENCE_IMAGES`
- `MAX_REFINE_REFERENCE_IMAGE_BYTES`
- `MAX_REFINE_REFERENCE_IMAGE_TOTAL_BYTES`

Frontend (`frontend/.env`):

- `VITE_API_URL`
- `VITE_GOOGLE_CLIENT_ID` (if Google login enabled)
- `VITE_APP_VERSION` (used by frontend self-heal version check)

### Production Deployment Workflow

Deployment is fully containerized. Use the Google Cloud CLI (`gcloud run deploy`) to push the backend and frontend folders into distinct Cloud Run services. Use the included `deploy-gcp.bat` or `deploy-gcp.sh` scripts from the project root to automate deployments.

## Section 10 - Discovered Architecture Details

1. **Presence tracking is Redis-backed with local fallback.**
   - `presenceStore.js` writes presence into Redis sets for class online users and socket membership.
   - If Redis is missing/unavailable, the same API falls back to in-memory Maps/Sets for local development.

2. **Quiz session timing state is Redis-backed with local fallback.**
   - Realtime handler stores quiz timing in keys shaped like `quiz:{lessonId}:{blockId}`.
   - Scoring reads start-time/time-limit from Redis when available, otherwise from in-memory fallback state.

3. **Lesson read endpoints now have explicit authorization gates.**
   - `GET /api/lessons/class/:classId` and `GET /api/lessons/:id` both enforce:
     - teacher must own class
     - student must be enrolled
   - Unauthorized access now returns `403`.

4. **Auth role safety remains stronger than typical JWT-only setups.**
   - Middleware re-fetches role from DB for each authenticated request.
   - Prevents stale token role mismatch issues after role updates.

5. **AI generation pipeline has robust fallback normalization.**
   - Structure/strategy/content are separated, with section content generated in parallel for latency reduction.
   - Required pedagogical block coverage and section density (3-6 blocks per section) are enforced server-side.
   - Failed sections are backfilled and merged in chronological order.

6. **Lesson block storage model is type + serialized content.**
   - `LessonBlock.content` is a string in DB.
   - Object-based block content is serialized/deserialized in backend/frontend normalization layers.

7. **No cron jobs or background schedulers were found in scanned backend source.**
   - Workflows are request-driven and socket-event-driven.

8. **Current backend uses Express 5.x with commonjs modules.**
   - Most route-level error handling remains explicit (`try/catch` + JSON errors).
   - A centralized middleware now handles oversized payload (`413`) and malformed JSON (`400`) request failures.

9. **Shared Redis connectivity is centralized.**
   - `backend/services/redisClient.js` provides a reusable Redis client accessor.
   - Presence and quiz-state logic both use this helper and automatically degrade to in-memory behavior when Redis is unavailable.

10. **Code execution backend uses provider failover.**
   - `POST /api/execute-code` attempts Piston first (when `PISTON_URL` is configured).
   - If Piston fails/unavailable, backend falls back to Judge0 and returns fallback metadata.

11. **Class stream is a unified timeline with typed feed items.**
   - Stream merges announcements, assignments, lessons, and quizzes into a single reverse-chronological list.
   - Item typing is hydrated client-side (`ANNOUNCEMENT`, `ASSIGNMENT`, `LESSON`, `QUIZ`) for role-aware rendering.

12. **People and attendance workflows are explicitly split by page.**
   - `/people` is roster + profile/records management.
   - `/attendance` is date-based attendance marking/history.

## Section 11 - Recent Updates (2026-03-27 to 2026-04-24)

1. **Reference file uploads added to lesson generation (2026-04-01).**
   - The Generate Lesson modal now accepts optional reference files in addition to plain text notes.
   - Teachers can add files through three paths: **Select Files** button, drag-and-drop zone, or clipboard paste (when files are present in clipboard data).
   - Files are converted client-side to base64 payloads and sent as `referenceFiles` with the generation request.
   - File limits are enforced in UI and backend (`MAX_REFERENCE_FILES`, `MAX_REFERENCE_FILE_BYTES`, `MAX_REFERENCE_TOTAL_BYTES`).

2. **Backend reference-context extraction pipeline added (2026-04-01).**
   - Text-like uploads are decoded directly.
   - PDFs, PowerPoint, images, and other model-supported formats are summarized into extraction text via Gemini.
   - Extracted context is merged with teacher `referenceContent` before structure/strategy/content generation.
   - Generation metadata now records `referenceFilesUsed` and `referenceFileWarnings`.

3. **Lesson generation reliability hardening expanded (2026-03-30 to 2026-04-01).**
   - Section generation runs in parallel and preserves chronological merge order.
   - Failed sections are replaced with deterministic fallback blocks instead of being dropped.
   - Server-side block-density enforcement ensures 3-6 blocks per section.
   - Post-generation verifier can soften unsupported claims and replace risky factual blocks.

4. **Structured web research pipeline upgraded (2026-03-30 to 2026-04-01).**
   - Multi-query retrieval and ranking with trust/recency scoring.
   - Grounded fallback retrieval when initial evidence quality is weak.
   - Caching and traceability metadata now included (`researchSources`, `researchUsage`, `researchWarnings`, cache info).

5. **Frontend dependency hardening retained (2026-03-27).**
   - Toolchain updated to modern Vite/ESLint versions.
   - Frontend build and lint baselines remain clean in the current branch.

6. **Frontend delivery cache behavior hardened (2026-04-01).**
   - Nginx now serves `index.html` with no-cache headers to reduce stale app-shell issues after deployments.
   - Hashed `/assets/*` files remain long-cache immutable for performance.

7. **Frontend auto self-heal for stale bundles added (2026-04-01).**
   - App now periodically checks `/version.json` (and on tab focus/network return) against the in-bundle `VITE_APP_VERSION`.
   - When a newer deployed version is detected, the client performs a one-time forced reload with an `appv` query param.
   - Docker build stamps a unique app version and generated timestamp into both `VITE_APP_VERSION` and `public/version.json`.

8. **Interactive Simulation viewport controls added (2026-04-01).**
   - Each simulation block now supports both **Expand/Collapse** and **Full Screen/Exit Full Screen** actions.
   - Preview/editor height scales automatically in expanded and full-screen modes for better visibility of large simulations.

9. **Textbook-style lesson text rendering added (2026-04-01).**
   - TEXT blocks now render as structured academic content with heading hierarchy, paragraph spacing, list styling, and stronger emphasis treatment.
   - Definition-style callouts are supported and displayed as visual boxes (e.g., `> [!DEFINITION] ...`).
   - Lesson editor now includes a live "Textbook Preview" for TEXT blocks while authoring.

10. **AI refine image attachments added (2026-04-01).**
   - Both teacher block refine and student personal refine modals now accept image context via drag-and-drop, clipboard paste, and manual file selection.
   - Frontend sends attached image payloads as `referenceImages`.
   - Backend validates image count/size and forwards valid images as multimodal input during Vertex AI refine calls.

11. **Navigation refactor for class-context UX (2026-04-07).**
   - Sidebar branding is now anchored in the side menu header, while top header branding is class-context only.
   - The top-left `menu` control now toggles side menu state instead of navigating to Home.
   - Class breadcrumb (`Classroom > {Class Name}`) and class tabs appear only on class-context routes with `?classId=...`.
   - Class tabs preserve class context while switching between Stream, Classwork, People, and Grades.
   - `ClassworkPage`, `PeoplePage`, and `GradesPage` now support class-scoped rendering when `classId` is present (People hides class selector in this mode).

12. **Teacher create-flow refactor for lessons and quizzes (2026-04-07).**
   - Class Stream and class-scoped Classwork now use a shared teacher `Create` menu.
   - `Create` includes Assignment, Lesson (AI/manual), and Quiz (AI/manual).
   - Stream action query support now includes `create-quiz-manual` and `create-quiz-ai`.
   - Manual quiz creation seeds a draft lesson with a default `QUIZ` block and opens the lesson editor.
   - AI quiz generation filters to `QUIZ`/`WRITTEN_QUIZ` blocks; AI lesson generation excludes quiz blocks.
   - Lesson editor add controls no longer expose `Quick Quiz`; quiz creation is now routed through the teacher create menu.

13. **Quiz-scoped live runtime and block terminology alignment (2026-04-07).**
   - Lesson editor now shows `Run Quiz Live` only when the lesson contains a `QUIZ` block.
   - `LiveLessonView` now gates live-only UI with `hasLiveQuiz`:
     - no live chip, no podium sidebar/tab, no ranking overlays, and no teacher control panel for non-quiz lessons.
   - Socket-triggered competition/ranking transitions are ignored client-side when no final `QUIZ` block exists.
   - User-facing block names were aligned:
     - `QUIZ` -> **MCQ Block**
     - `WRITTEN_QUIZ` -> **Written Question Block**

14. **Class materials navigation moved into class tabs (2026-04-08).**
   - `Class Material` is now a class-context top tab (same behavior as Stream/Classwork/People/Grades) instead of a separate header modal button.
   - Added dedicated routed page: `/class/materials?classId=...` -> `ClassMaterialsPage`.
   - Top-tab class-context detection now includes `/class/materials`.

15. **Global lesson editing and student personal fork workflow (2026-04-08).**
   - Removed publish-lock behavior for teacher-owned global lessons. Teachers can now edit, reorder, and delete blocks at any lesson status.
   - Added personal lesson ownership on `Lesson` (`owner_student_id`, `source_lesson_id`) with one-fork-per-student-per-source uniqueness.
   - Student lesson edits now fork teacher global lessons automatically into private personal copies and apply edits there.
   - Added `GET /api/lessons/class/:classId/personal` and `POST /api/lessons/:id/fork` for student personal collection access and explicit fork creation.
   - Classwork now includes student-only `Global Lessons` / `Personal Lessons` toggle and streamlined actions (`Open Lesson`, `Edit My Copy`, `Open Editor`).

16. **Generation reference-image pipeline expanded (2026-04-13 to 2026-04-15).**
   - AI generation now accepts direct image references alongside file references.
   - Attached PDFs are sampled into page snapshots for multimodal grounding.
   - Generation enforces PDF snapshot availability when PDFs are attached and surfaces explicit guidance when snapshots are missing.

17. **People + Attendance class tabs and roster tooling expanded (2026-04-24).**
   - Class-context top tabs now include `Attendance` in addition to Stream/Classwork/Class Material/People.
   - People page received richer student profile workflows: attendance snapshot cards, remove-student action, and teacher private records.
   - Backend class routes now support detailed student profile + teacher record CRUD endpoints.

18. **Class announcements feature added (2026-04-24).**
   - New backend route family: `/api/announcements/*` with class-scoped fetch/create/delete.
   - Teacher `Create` menu now includes `Announcement` in stream and classwork entrypoints.
   - Stream feed now renders announcement cards inline with assignments and lessons.

19. **Top-nav action cleanup (2026-04-24).**
   - Header controls were simplified to rely on the side-menu toggle and profile menu actions.
   - Legacy top-bar app-grid action was removed to reduce redundant navigation paths.

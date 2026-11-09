# Project Summary: Academic Atelier

## Overview

Academic Atelier is a classroom and lesson-delivery platform for teachers and students. It combines a lightweight LMS with AI-assisted lesson generation, live lesson presentation, real-time quizzes, assignment submission, and an in-lesson tutoring chat.

The repository currently contains three main parts:

- `frontend/`: React + Vite single-page app
- `backend/`: Express + Prisma API with Socket.IO real-time features
- `design_mockups/`: HTML mockups, delivery notes, and product/design reference material

## What the Product Does

The current app supports two roles:

- `TEACHER`
- `STUDENT`

Core user flows:

- Users can register, log in with email/password, or sign in with Google OAuth.
- Teachers can create classes and share a generated class code.
- Students can join a class using that code.
- Teachers can create assignments and grade student submissions.
- Teachers can create lessons manually or generate lesson drafts with AI.
- Lessons are built from content blocks such as text, code, discussion prompts, MCQ exercises, live quizzes, and written exercises.
- Teachers can present lessons live to students.
- Live sessions include synchronized quizzes, attendance counts, leaderboard scoring, and teacher chat controls.
- Students can use an AI tutor chat during lessons and receive AI evaluation on written responses.

## Frontend

The frontend is a React 19 app using:

- `react-router-dom` for page routing
- `axios` for API requests
- `zustand` for auth state
- `socket.io-client` for live session sync
- `@react-oauth/google` for Google sign-in
- Tailwind CSS v4 for styling

Main routes:

- `/login`: login and registration
- `/dashboard`: class list and class creation/join flow
- `/class/stream`: assignments and lessons for a class
- `/assignment/:id`: student assignment detail and submission
- `/assignment/:id/grade`: teacher grading workspace
- `/lesson/edit`: teacher lesson editor
- `/lesson/live`: live lesson presentation view

Important frontend behavior:

- The API client automatically attaches the JWT token from `localStorage`.
- Unauthorized API responses clear local auth state and redirect to `/login`.
- The lesson editor supports block-based authoring and a simple in-browser code runner using `eval`.
- The live lesson page renders lesson content, runs synchronized quizzes, shows a leaderboard, and exposes the AI tutor chat.

## Backend

The backend is an Express 5 app with Prisma and Socket.IO. It exposes REST endpoints under `/api` and runs a WebSocket server for live lesson features.

Key API areas:

- `/api/auth`: register, login, Google OAuth
- `/api/classes`: get classes, create class, join class
- `/api/assignments`: list, create, submit, fetch submissions, grade
- `/api/lessons`: list, fetch, create, update, AI-generate lesson content
- `/api/lesson-chat`: AI tutor chat and written-answer evaluation

Real-time behavior handled in `backend/index.js`:

- lesson room join/attendance updates
- live quiz start/stop events
- real-time answer collection
- speed-based quiz scoring
- teacher chat lock/unlock controls

Authentication is JWT-based with middleware for:

- token validation
- teacher-only route protection

## Data Model

The Prisma schema defines the core entities:

- `User`
- `Class`
- `Enrollment`
- `Assignment`
- `Submission`
- `Announcement`
- `Lesson`
- `LessonBlock`
- `QuizSession`
- `QuizResponse`
- `ChatMessage`

This supports both LMS-style workflows and interactive lesson delivery.

## AI Features

AI capabilities are currently routed through OpenRouter:

- lesson generation from a teacher prompt
- tutoring chat during lessons
- written answer evaluation against an ideal answer

The lesson generator asks the model to return structured JSON containing lesson blocks, which the app then stores as editable lesson content.

## Design Assets

`design_mockups/` contains non-runtime artifacts:

- product requirement and architecture notes
- UI reference HTML files
- screen-level mockups for login, dashboard, class stream, lesson editing, live lesson views, grading, and AI flows

These files are helpful for understanding the intended direction of the product, but they are not the primary source of truth for the running application.

## Current State and Notes

- The backend currently uses Prisma with `sqlite` (`backend/dev.db`) in code, even though some design docs describe PostgreSQL as a target setup.
- The implementation is functional but still fairly monolithic: most backend logic lives directly in route files plus `index.js`.
- The root project does not yet have a central README; the frontend still has the default Vite README.
- There are no meaningful automated tests configured yet.
- `node_modules/` and built frontend output are present in the repo, which suggests this is an active local working copy rather than a cleaned distribution branch.

## In One Sentence

This project is a prototype-to-MVP AI classroom platform that blends class management, assignment workflows, interactive lesson authoring, real-time live teaching, and embedded AI tutoring in a single React/Express application.

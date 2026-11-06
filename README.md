# Academic Atelier

An AI-first, asynchronous learning management system (LMS) built for universities and colleges. 


---

## 🚀 Overview

**Academic Atelier** modernizes higher education by replacing static slide decks and fragmented toolchains with interactive, block-based lessons. It combines zero-friction AI content generation, in-browser multi-language code execution, and a context-aware Socratic AI tutor into a single, unified platform.

---

## ✨ Key Features

* **Zero-Friction AI Authoring:** Powered by **Vertex AI**, instructors can instantly transform existing static documents (PDFs, slide decks, images) into comprehensive, block-based interactive lessons.
* **Integrated Code Environments:** Features executable code environments and safe, in-browser simulations so students never need to context-switch between separate tools while learning.
* **Socratic AI Tutor:** Powered by Gemini, the tutor guides students through critical thinking to arrive at solutions themselves rather than simply giving away answers.
* **Automated Evaluation:** Provides precise, automated assessment for free-text assignments and student code.

---

## 🛠️ Tech Stack

### Frontend
* **Framework:** React 19.2.4
* **Build Tool:** Vite 8.0.3
* **Styling:** Tailwind CSS 4.2.2
* **State Management:** Zustand 5.0.12

### Backend
* **Runtime & Server:** Node.js (Docker `node:20-slim`), Express 5.2.1
* **Database & ORM:** PostgreSQL, Prisma 5.22.0

### AI Stack
* **SDKs:** `@google/genai` (1.47.0) & `@google-cloud/vertexai` (1.10.3)
* **Models:** 
  * **Gemini 2.5 Pro:** Used for content generation and lesson refinement.
  * **Gemini 2.5 Flash:** Used for real-time chat and student evaluation.

### Infrastructure & Deployment
* **Containerization:** Fully Dockerized frontend and backend services.
* **Cloud Hosting:** Google Cloud Run (Backend) & Vercel (Frontend workflow).

---

## 📂 Project Architecture

The repository is structured around a robust full-stack architecture featuring modular backend endpoints and scalable frontend route management:
* **Backend Modules:** 10 core API modules handling authentication, class management, interactive lesson authoring, and Vertex AI service orchestration.
* **Frontend Routes:** 20+ frontend routes tailored for seamless instructor authoring flows and student learning views.

---

## 🚦 Getting Started (Local Development)

### Prerequisites
* Docker & Docker Compose
* Node.js (v20+ recommended)
* PostgreSQL database instance (or run via Docker)

- [Watch Product Demo Video](./videos/demo.mp4)

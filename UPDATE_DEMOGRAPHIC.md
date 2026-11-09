<context>
Project: Academic Atelier (React/Vite Frontend, Node.js/Express Backend, Prisma ORM).
Goal: Ensure the application's target demographic is strictly set to University/College students for all AI-generated content and documentation, while explicitly preserving the current UI.
</context>

<rules>
- Do not modify any core database schema, API routing logic, or Socket.IO events. 
- STRICT UI LOCK: Do NOT modify any CSS classes, Tailwind configurations, or UI component styling. The current frontend design is approved as-is.
- Only modify text in documentation files and backend AI system prompts.
</rules>

<execution-plan>

  <step id="1" name="Documentation Rewrite">
    <target-file>PROJECT_DOCUMENTATION.md</target-file>
    <instructions>
      - Locate "Section 1 - High Level Description" and the "Product Design Language" subsection.
      - Delete any legacy references to early education or young demographics.
      - Ensure the directive explicitly states: "Target Demographic is University/College students. The current UI styling is approved, but any future UI additions or changes must be designed with adults in mind (professional, minimalist, high information density)."
    </instructions>
  </step>

  <step id="2" name="Upgrade AI Generation Prompts (Backend)">
    <target-directory>backend/routes/</target-directory>
    <target-directory>backend/services/</target-directory>
    <instructions>
      - Locate the file handling `POST /api/lessons/generate` (likely in `routes/lessons.js` or a dedicated AI service file).
      - Find the system prompt string that instructs the AI on how to draft the lesson.
      - Remove any instructions asking the AI to use simple vocabulary or target a younger audience.
      - Rewrite the system prompt to instruct the AI to act as a "University-level Teaching Assistant." It should generate rigorous, academically dense content suitable for higher education, including advanced vocabulary and complex concepts.
      - Repeat this process for the `POST /api/lesson-chat/message` (AI Tutor) system prompt so the chat assistant speaks and evaluates answers like a college professor.
    </instructions>
  </step>

</execution-plan>

<output-requirements>
After executing these steps, output a short summary detailing the exact files where the AI system prompts were located and updated, and confirm that no frontend UI files were modified.
</output-requirements>
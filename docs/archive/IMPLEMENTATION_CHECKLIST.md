# Dead Controls Implementation Checklist (Priority Ordered)

## P0 - Critical UX/Behavior Gaps

- [x] Wire live session `COMPETITION` broadcast end-to-end.
- [x] Wire live session `PODIUM` broadcast end-to-end.
- [x] Fix grading page runtime bug (`setError` undefined in fetch failure path).
- [x] Wire grading sidebar search to actually filter students.
- [x] Wire `Save Draft` on grading page with local draft persistence.

## P1 - High Value Navigation & Classroom Shell

- [x] Add real routes for top nav tabs: `Classwork`, `People`, `Grades`.
- [x] Replace top nav placeholder anchors with router links.
- [x] Wire dashboard `View All Tasks` CTA to classwork route.
- [x] Wire dashboard class-card quick controls (`more_vert`, `folder_open`) to open class stream.
- [x] Wire class stream header `info` button to a class details modal.
- [x] Add working destinations for login `Forgot?`, `Help Center`, `Privacy`, `Terms`.
- [x] Replace sidebar placeholder links (`Calendar`, `Archived`, `Settings`, `Help`, `Privacy`) with routed pages.

## P2 - Next Controls To Wire (Next Batch)

- [ ] Add class-card actions menu (rename/archive/copy invite link), not just open stream.
- [x] Add real archived class lifecycle (archive/unarchive backend + UI).
- [ ] Implement full class roster per class (teacher + student lists, invite/remove flows).
- [ ] Add gradebook aggregation for teachers (assignment averages, missing submissions).
- [ ] Add calendar grid view with due-date plotting, not just route placeholder.
- [ ] Add password reset backend flow (token/email) to back the new forgot-password page.

## P3 - Polish / Product Hardening

- [ ] Add toasts for all newly wired controls (success/error feedback consistency).
- [ ] Add E2E smoke tests for top nav + grading flows + live controls.
- [ ] Improve role-based nav visibility (hide irrelevant tabs/actions by role).
- [ ] Add access guards and deep-link handling for new routes.
- [ ] Replace placeholder legal/help content with final policy/support docs.

## Notes

- This checklist is designed to convert the Google Classroom-inspired shell into fully functional workflows in small, verifiable increments.
- Current pass focused on P0 + most P1 to eliminate visible no-op controls first.

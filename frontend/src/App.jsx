import React, { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import useAppVersionSelfHeal from './hooks/useAppVersionSelfHeal';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ClassStreamPage = lazy(() => import('./pages/ClassStreamPage'));
const AssignmentView = lazy(() => import('./pages/AssignmentView'));
const AssignmentGradingPage = lazy(() => import('./pages/AssignmentGradingPage'));
const LessonEditor = lazy(() => import('./pages/LessonEditor'));
const LiveLessonView = lazy(() => import('./pages/LiveLessonView'));
const ClassworkPage = lazy(() => import('./pages/ClassworkPage'));
const ClassMaterialsPage = lazy(() => import('./pages/ClassMaterialsPage'));
const PeoplePage = lazy(() => import('./pages/PeoplePage'));
const AttendancePage = lazy(() => import('./pages/AttendancePage'));
const GradesPage = lazy(() => import('./pages/GradesPage'));
const UtilityPage = lazy(() => import('./pages/UtilityPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const ArchivedClassesPage = lazy(() => import('./pages/ArchivedClassesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));

function RouteFallback() {
  return (
    <div className="min-h-screen bg-background text-on-background flex items-center justify-center">
      <p className="text-sm font-semibold tracking-wide text-on-surface-variant">
        Loading Academic Atelier...
      </p>
    </div>
  );
}

function App() {
  useAppVersionSelfHeal();

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/classwork" element={<ClassworkPage />} />
        <Route path="/class/materials" element={<ClassMaterialsPage />} />
        <Route path="/people" element={<PeoplePage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/grades" element={<GradesPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/archived" element={<ArchivedClassesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<UtilityPage title="Help Center" description="Help entry point is connected. Next step: FAQs, troubleshooting, and contact support." />} />
        <Route path="/privacy" element={<UtilityPage title="Privacy Policy" description="Privacy route is connected for legal content and policy disclosures." />} />
        <Route path="/terms" element={<UtilityPage title="Terms of Service" description="Terms route is connected for product usage terms and legal agreements." />} />
        <Route path="/class/stream" element={<ClassStreamPage />} />
        <Route path="/assignment/:id" element={<AssignmentView />} />
        <Route path="/assignment/:id/grade" element={<AssignmentGradingPage />} />
        <Route path="/lesson/edit" element={<LessonEditor />} />
        <Route path="/lesson/live" element={<LiveLessonView />} />
      </Routes>
    </Suspense>
  );
}

export default App;

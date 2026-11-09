import React from 'react';
import { Link } from 'react-router-dom';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';

export default function UtilityPage({ title, description }) {
  return (
    <div className="bg-background text-on-surface min-h-screen">
      <TopNavBar />
      <div className="flex pt-16">
        <Sidebar />
        <main className="w-full lg:pl-64 px-6 py-8">
          <div className="max-w-3xl mx-auto">
            <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-8">
              <p className="text-xs font-bold uppercase tracking-widest text-outline">Workspace</p>
              <h1 className="text-4xl font-bold tracking-tight mt-2">{title}</h1>
              <p className="text-sm text-outline mt-3">{description}</p>
              <div className="mt-6">
                <Link to="/dashboard" className="inline-flex items-center gap-2 px-4 py-2 rounded-full signature-gradient text-white font-semibold">
                  Back to Dashboard
                </Link>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

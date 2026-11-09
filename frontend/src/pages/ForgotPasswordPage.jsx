import React, { useState } from 'react';
import { Link } from 'react-router-dom';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSent(true);
  };

  return (
    <div className="bg-background text-on-surface min-h-screen flex items-center justify-center p-6">
      <main className="w-full max-w-md bg-surface-container-lowest rounded-xl p-8 shadow-sm border border-outline-variant/20">
        <h1 className="text-2xl font-bold tracking-tight">Reset Password</h1>
        <p className="text-sm text-outline mt-2">Enter your account email to receive recovery instructions.</p>

        {sent ? (
          <div className="mt-6 p-4 rounded-lg bg-secondary/10 border border-secondary/20">
            <p className="text-sm text-secondary font-semibold">If an account exists, recovery instructions were sent.</p>
            <Link to="/login" className="inline-block mt-4 text-primary font-semibold hover:underline">
              Back to Login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@school.edu"
              className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary outline-none px-3 py-3"
            />
            <button type="submit" className="w-full py-3 rounded-full signature-gradient text-white font-semibold">
              Send Reset Link
            </button>
            <Link to="/login" className="block text-center text-sm text-outline hover:text-on-surface">
              Cancel
            </Link>
          </form>
        )}
      </main>
    </div>
  );
}

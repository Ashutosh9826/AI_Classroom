import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import useAuthStore from '../store/useAuthStore';
import { API_BASE_URL } from '../services/api';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('STUDENT');
  const [error, setError] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const { login, register, googleLogin } = useAuthStore();

  const formatAuthError = (err) => {
    const apiError = err?.response?.data?.error;
    if (apiError) return apiError;

    const networkFailure =
      err?.message?.toLowerCase?.().includes('network') ||
      err?.code === 'ECONNABORTED' ||
      err?.code === 'ERR_NETWORK';

    if (networkFailure) {
      return `Cannot reach backend API (${API_BASE_URL}). Check connection and try again.`;
    }

    return 'Authentication failed';
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      if (isRegistering) {
        await register({ name, email, password, role });
      } else {
        await login(email, password, role);
      }
      navigate('/dashboard');
    } catch (err) {
      setError(formatAuthError(err));
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    try {
      await googleLogin(credentialResponse.credential, role);
      navigate('/dashboard');
    } catch (err) {
      setError(formatAuthError(err));
    }
  };

  return (
    <div className="bg-background font-body text-on-surface min-h-screen flex flex-col items-center justify-center p-6">
      {/* Brand Header Anchor */}
      <header className="mb-12 text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="w-12 h-12 signature-gradient rounded-xl flex items-center justify-center shadow-lg">
            <span className="material-symbols-outlined text-white text-3xl">school</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-on-surface headline">Academic Atelier</h1>
        </div>
      </header>
      
      <main className="w-full max-w-[440px]">
        {/* The Atelier Card */}
        <div className="bg-surface-container-lowest rounded-xl p-8 ambient-shadow">
          <div className="mb-8 text-center">
            <h2 className="text-3xl font-semibold text-on-surface mb-2">Welcome Back</h2>
            <p className="text-on-surface-variant text-sm">Please enter your details to sign in</p>
          </div>
          
          {/* Role Selection Toggle */}
          <div className="flex p-1 bg-surface-container rounded-full mb-8">
            <button data-testid="role-student-toggle" type="button" onClick={() => setRole('STUDENT')} className={`flex-1 py-2 text-sm font-semibold rounded-full transition-all ${role === 'STUDENT' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>
              Student
            </button>
            <button data-testid="role-teacher-toggle" type="button" onClick={() => setRole('TEACHER')} className={`flex-1 py-2 text-sm font-semibold rounded-full transition-all ${role === 'TEACHER' ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-on-surface-variant hover:text-on-surface'}`}>
              Teacher
            </button>
          </div>
          {!isRegistering && (
            <p className="text-[11px] text-on-surface-variant -mt-6 mb-6 text-center">
              Role selection affects registration and first-time Google sign-in. Email login uses your existing account role.
            </p>
          )}
          
          <form className="space-y-6" onSubmit={handleSubmit} data-testid="auth-form">
            {/* Google Sign In (Real OAuth) */}
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => setError('Google sign-in was unsuccessful')}
                theme="outline"
                shape="pill"
                size="large"
                width="380"
                text="signin_with"
              />
            </div>
            
            <div className="relative flex items-center py-4">
              <div className="flex-grow border-t border-outline-variant/30"></div>
              <span className="flex-shrink mx-4 text-xs font-semibold text-on-surface-variant label-md tracking-wider uppercase">Or continue with</span>
              <div className="flex-grow border-t border-outline-variant/30"></div>
            </div>

            {error && <div className="text-error text-sm text-center mb-4">{error}</div>}

            {isRegistering && (
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-on-surface-variant ml-1 label-md">FULL NAME</label>
                <div className="relative group">
                  <input data-testid="auth-name-input" value={name} onChange={e => setName(e.target.value)} required className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-1 py-3 transition-colors outline-none text-on-surface placeholder:text-on-surface-variant/50" placeholder="John Doe" type="text" />
                </div>
              </div>
            )}
            
            {/* Email Input */}
            <div className="space-y-1">
              <label className="block text-xs font-semibold text-on-surface-variant ml-1 label-md">EMAIL ADDRESS</label>
              <div className="relative group">
                <input data-testid="auth-email-input" value={email} onChange={e => setEmail(e.target.value)} required className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-1 py-3 transition-colors outline-none text-on-surface placeholder:text-on-surface-variant/50" placeholder="name@school.edu" type="email" />
              </div>
            </div>
            
            {/* Password Input */}
            <div className="space-y-1">
              <div className="flex justify-between items-center px-1">
                <label className="text-xs font-semibold text-on-surface-variant label-md">PASSWORD</label>
                {!isRegistering && <Link className="text-xs font-semibold text-primary hover:underline" to="/forgot-password">Forgot?</Link>}
              </div>
              <div className="relative group">
                <input data-testid="auth-password-input" value={password} onChange={e => setPassword(e.target.value)} required className="w-full bg-surface-container-high border-b-2 border-outline/50 focus:border-primary focus:ring-0 px-1 py-3 transition-colors outline-none text-on-surface placeholder:text-on-surface-variant/50" placeholder="••••••••" type="password" />
              </div>
            </div>
            
            {/* Sign In Button */}
            <button data-testid="auth-submit-button" type="submit" className="w-full signature-gradient text-white font-semibold py-4 rounded-full shadow-lg shadow-primary/20 hover:shadow-primary/40 active:scale-95 transition-all duration-200 mt-4 block text-center">
              {isRegistering ? 'Create Account' : 'Sign in to Atelier'}
            </button>
          </form>
          
          <div className="mt-8 text-center">
            <p className="text-sm text-on-surface-variant">
              {isRegistering ? "Already have an account?" : "Don't have an account?"} <button data-testid="auth-switch-mode-button" type="button" onClick={() => setIsRegistering(!isRegistering)} className="text-primary font-semibold hover:underline decoration-2 underline-offset-4">{isRegistering ? 'Sign in' : 'Create account'}</button>
            </p>
          </div>
        </div>
        
        {/* Footer Links */}
        <footer className="mt-12 flex justify-center gap-6 text-xs font-medium text-on-surface-variant">
          <Link className="hover:text-primary transition-colors" to="/help">Help Center</Link>
          <Link className="hover:text-primary transition-colors" to="/privacy">Privacy Policy</Link>
          <Link className="hover:text-primary transition-colors" to="/terms">Terms of Service</Link>
        </footer>
      </main>
      
      {/* Decoration / Ambient Background Elements */}
      <div className="fixed top-0 left-0 w-full h-full -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] right-[-5%] w-96 h-96 bg-primary/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-[-10%] left-[-5%] w-80 h-80 bg-secondary/5 rounded-full blur-3xl"></div>
      </div>
    </div>
  );
}

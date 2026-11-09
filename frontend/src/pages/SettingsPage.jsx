import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TopNavBar from '../components/TopNavBar';
import Sidebar from '../components/Sidebar';
import useAuthStore from '../store/useAuthStore';
import { authService } from '../services/api';

const defaultNotificationState = {
  notify_assignments: true,
  notify_due_soon: true,
  notify_announcements: true,
};

function SettingsToggle({ label, description, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/20 px-4 py-3">
      <div>
        <p className="text-sm font-semibold text-on-surface">{label}</p>
        <p className="text-xs text-outline mt-1">{description}</p>
      </div>
      <button
        type="button"
        onClick={onChange}
        className={`relative h-7 w-12 rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-outline-variant/60'}`}
        aria-pressed={checked}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-[22px]' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [profileName, setProfileName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [notifications, setNotifications] = useState(defaultNotificationState);

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingNotifications, setSavingNotifications] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [passwordError, setPasswordError] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');

  useEffect(() => {
    if (!user?.id) {
      navigate('/login');
      return;
    }

    const loadProfile = async () => {
      try {
        setLoading(true);
        setError('');
        const me = await authService.getMe();
        setUser(me);
        setProfileName(me.name || '');
        setAvatarUrl(me.avatar_url || '');
        setNotifications({
          notify_assignments: Boolean(me.notify_assignments),
          notify_due_soon: Boolean(me.notify_due_soon),
          notify_announcements: Boolean(me.notify_announcements),
        });
      } catch (err) {
        console.error(err);
        setProfileName(user?.name || '');
        setAvatarUrl(user?.avatar_url || '');
        setNotifications({
          notify_assignments: user?.notify_assignments ?? true,
          notify_due_soon: user?.notify_due_soon ?? true,
          notify_announcements: user?.notify_announcements ?? true,
        });
        setError(err.response?.data?.error || 'Failed to load settings from server. Showing local profile data.');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, navigate, setUser]);

  const initials = useMemo(() => {
    if (!profileName?.trim()) return 'U';
    return profileName
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((chunk) => chunk[0]?.toUpperCase())
      .join('');
  }, [profileName]);

  const saveProfile = async (event) => {
    event.preventDefault();
    try {
      setSavingProfile(true);
      setError('');
      setMessage('');
      const updated = await authService.updateMe({
        name: profileName.trim(),
        avatar_url: avatarUrl.trim(),
      });
      setUser(updated);
      setProfileName(updated.name || '');
      setAvatarUrl(updated.avatar_url || '');
      setMessage('Profile updated.');
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to save profile');
    } finally {
      setSavingProfile(false);
    }
  };

  const saveNotifications = async (event) => {
    event.preventDefault();
    try {
      setSavingNotifications(true);
      setError('');
      setMessage('');
      const updated = await authService.updateMe(notifications);
      setUser(updated);
      setNotifications({
        notify_assignments: Boolean(updated.notify_assignments),
        notify_due_soon: Boolean(updated.notify_due_soon),
        notify_announcements: Boolean(updated.notify_announcements),
      });
      setMessage('Notification preferences saved.');
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to save notifications');
    } finally {
      setSavingNotifications(false);
    }
  };

  const changePassword = async (event) => {
    event.preventDefault();
    setPasswordError('');
    setPasswordMessage('');

    if (!newPassword || newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirm password do not match.');
      return;
    }

    try {
      setSavingPassword(true);
      await authService.changePassword({
        current_password: currentPassword,
        new_password: newPassword,
      });
      const refreshed = await authService.getMe();
      setUser(refreshed);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated.');
    } catch (err) {
      console.error(err);
      setPasswordError(err.response?.data?.error || 'Failed to update password');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="bg-background text-on-surface min-h-screen">
      <TopNavBar />
      <div className="flex pt-16">
        <Sidebar />
        <main className="w-full lg:pl-64 px-6 py-8">
          <div className="max-w-5xl mx-auto space-y-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-outline">Account</p>
                <h1 className="text-4xl font-bold tracking-tight mt-2">Settings</h1>
                <p className="text-sm text-outline mt-2">Manage your profile and classroom preferences.</p>
              </div>
            </header>

            {loading && <p className="text-outline">Loading settings...</p>}
            {error && <p className="text-error">{error}</p>}
            {message && <p className="text-secondary font-semibold text-sm">{message}</p>}

            {!loading && (
              <>
                <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-6">
                  <h2 className="text-lg font-bold">Profile</h2>
                  <form className="mt-4 space-y-5" onSubmit={saveProfile}>
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full overflow-hidden border border-outline-variant/30 bg-surface-container-low flex items-center justify-center">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt="Profile avatar" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xl font-bold text-primary">{initials}</span>
                        )}
                      </div>
                      <div className="text-sm text-outline">
                        <p>{user?.role === 'TEACHER' ? 'Teacher profile' : 'Student profile'}</p>
                        {user?.created_at && (
                          <p>Joined {new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-outline mb-2">Display Name</label>
                        <input
                          type="text"
                          value={profileName}
                          onChange={(event) => setProfileName(event.target.value)}
                          className="w-full bg-white border border-outline-variant/40 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-outline mb-2">Email</label>
                        <input
                          type="email"
                          value={user?.email || ''}
                          className="w-full bg-surface-container-low border border-outline-variant/30 rounded-xl px-3 py-2.5 text-sm text-outline"
                          disabled
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold uppercase tracking-wider text-outline mb-2">Avatar URL (optional)</label>
                      <input
                        type="url"
                        placeholder="https://..."
                        value={avatarUrl}
                        onChange={(event) => setAvatarUrl(event.target.value)}
                        className="w-full bg-white border border-outline-variant/40 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary"
                      />
                    </div>

                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={savingProfile}
                        className="px-5 py-2.5 rounded-full signature-gradient text-white font-semibold disabled:opacity-60"
                      >
                        {savingProfile ? 'Saving...' : 'Save Profile'}
                      </button>
                    </div>
                  </form>
                </section>

                <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-6">
                  <h2 className="text-lg font-bold">Notifications</h2>
                  <form className="mt-4 space-y-3" onSubmit={saveNotifications}>
                    <SettingsToggle
                      label="Assignments"
                      description="Notify me when new assignments are posted."
                      checked={notifications.notify_assignments}
                      onChange={() =>
                        setNotifications((prev) => ({ ...prev, notify_assignments: !prev.notify_assignments }))
                      }
                    />
                    <SettingsToggle
                      label="Due Soon Reminders"
                      description="Send reminders before assignment due dates."
                      checked={notifications.notify_due_soon}
                      onChange={() =>
                        setNotifications((prev) => ({ ...prev, notify_due_soon: !prev.notify_due_soon }))
                      }
                    />
                    <SettingsToggle
                      label="Announcements"
                      description="Notify me when class announcements are posted."
                      checked={notifications.notify_announcements}
                      onChange={() =>
                        setNotifications((prev) => ({ ...prev, notify_announcements: !prev.notify_announcements }))
                      }
                    />
                    <div className="flex justify-end pt-2">
                      <button
                        type="submit"
                        disabled={savingNotifications}
                        className="px-5 py-2.5 rounded-full border border-primary/30 text-primary font-semibold hover:bg-primary/5 disabled:opacity-60"
                      >
                        {savingNotifications ? 'Saving...' : 'Save Notifications'}
                      </button>
                    </div>
                  </form>
                </section>

                <section className="bg-surface-container-lowest rounded-2xl border border-outline-variant/20 p-6">
                  <h2 className="text-lg font-bold">Security</h2>
                  <form className="mt-4 space-y-4" onSubmit={changePassword}>
                    {user?.has_password && (
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-outline mb-2">Current Password</label>
                        <input
                          type="password"
                          value={currentPassword}
                          onChange={(event) => setCurrentPassword(event.target.value)}
                          className="w-full bg-white border border-outline-variant/40 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary"
                          required={Boolean(user?.has_password)}
                        />
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-outline mb-2">New Password</label>
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(event) => setNewPassword(event.target.value)}
                          className="w-full bg-white border border-outline-variant/40 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold uppercase tracking-wider text-outline mb-2">Confirm Password</label>
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(event) => setConfirmPassword(event.target.value)}
                          className="w-full bg-white border border-outline-variant/40 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-primary"
                          required
                        />
                      </div>
                    </div>
                    {passwordError && <p className="text-error text-sm">{passwordError}</p>}
                    {passwordMessage && <p className="text-secondary text-sm font-semibold">{passwordMessage}</p>}
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={savingPassword}
                        className="px-5 py-2.5 rounded-full border border-outline-variant/40 text-on-surface font-semibold hover:bg-surface-container-low disabled:opacity-60"
                      >
                        {savingPassword ? 'Updating...' : user?.has_password ? 'Change Password' : 'Set Password'}
                      </button>
                    </div>
                  </form>
                </section>
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

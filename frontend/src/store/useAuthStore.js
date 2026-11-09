import { create } from 'zustand';
import { authService } from '../services/api';

const useAuthStore = create((set) => ({
  user: authService.getCurrentUser(),
  login: async (email, password, role) => {
    const data = await authService.login(email, password, role);
    set({ user: data.user });
    return data;
  },
  register: async (userData) => {
    const data = await authService.register(userData);
    set({ user: data.user });
    return data;
  },
  logout: () => {
    authService.logout();
    set({ user: null });
  },
  googleLogin: async (credential, role) => {
    const data = await authService.googleLogin(credential, role);
    set({ user: data.user });
    return data;
  },
  setUser: (user) => set({ user }),
}));

export default useAuthStore;

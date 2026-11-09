import { create } from 'zustand';

const DESKTOP_BREAKPOINT = '(min-width: 1024px)';

const isDesktopViewport = () => {
  if (typeof window === 'undefined') return true;
  return window.matchMedia(DESKTOP_BREAKPOINT).matches;
};

const useLayoutStore = create((set) => ({
  isDesktopSidebarExpanded: true,
  isMobileSidebarOpen: false,

  toggleSidebar: () =>
    set((state) => {
      if (isDesktopViewport()) {
        return {
          isDesktopSidebarExpanded: !state.isDesktopSidebarExpanded,
          isMobileSidebarOpen: false,
        };
      }

      return { isMobileSidebarOpen: !state.isMobileSidebarOpen };
    }),

  closeMobileSidebar: () => set({ isMobileSidebarOpen: false }),
}));

export default useLayoutStore;

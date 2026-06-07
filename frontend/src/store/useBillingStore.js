import { create } from 'zustand';

export const useBillingStore = create((set, get) => ({
  sessions: [],
  setSessions: (sessions) => set({ sessions }),
  updateSession: (updatedSession) => set((state) => ({
    sessions: state.sessions.map((s) => s._id === updatedSession._id ? updatedSession : s)
  })),
  checkConflict: (newSession) => {
    const { sessions } = get();
    // Complex business logic abstracted into the store
    const start = new Date(newSession.startTime).getTime();
    const end = new Date(newSession.endTime).getTime();
    return sessions.some(s => {
      if (s._id === newSession._id) return false;
      const sStart = new Date(s.startTime).getTime();
      const sEnd = new Date(s.endTime).getTime();
      return (start < sEnd && end > sStart); // overlap condition
    });
  }
}));

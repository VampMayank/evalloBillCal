import { create } from 'zustand';
import axios from 'axios';

export const useSchedulingStore = create((set, get) => ({
  sessions: [],
  isFetching: false,
  isSaving: false,
  error: null,
  
  // Track the session being actively edited
  editingSessionId: null,
  // Flag necessity of an adjustment workflow if the session is already 'Billed'
  needsAdjustmentWorkflow: false,

  setEditingSession: (session) => {
    set({ 
      editingSessionId: session ? session._id : null,
      needsAdjustmentWorkflow: session ? session.billingStatus === 'Billed' : false 
    });
  },

  clearError: () => set({ error: null }),

  // 1. Fetching calendar data from Express backend
  fetchSessions: async () => {
    set({ isFetching: true, error: null });
    try {
      const response = await axios.get('/api/sessions');
      set({ sessions: response.data, isFetching: false });
    } catch (error) {
      set({ error: error.message, isFetching: false });
    }
  },

  // 2. Client-side optimistic double-booking validation
  // NOTE: tutorId from MongoDB comes back as an ObjectId; normalize both sides
  // with String() so strict equality works regardless of source type.
  checkDoubleBooking: (tutorId, newStartTime, newEndTime, excludeSessionId) => {
    const { sessions } = get();
    const sTime = new Date(newStartTime).getTime();
    const eTime = new Date(newEndTime).getTime();
    const normalizedTutor = String(tutorId);

    return sessions.some(session => {
      // Exclude the session currently being edited
      if (String(session._id) === String(excludeSessionId)) return false;

      // Conflict only if same tutor
      if (String(session.tutorId) !== normalizedTutor) return false;

      const currentSTime = new Date(session.startTime).getTime();
      const currentETime = new Date(session.endTime).getTime();

      // Standard half-open interval overlap
      return (sTime < currentETime && eTime > currentSTime);
    });
  },

  // 3. Tracking global loading flags (Frontend click idempotency)
  updateSessionWithLock: async (sessionId, updateData) => {
    const { isSaving, checkDoubleBooking } = get();
    
    // Frontend idempotency: Reject immediately if a save is already in progress
    if (isSaving) {
      console.warn('Save operation blocked: Action already in progress.');
      return null;
    }
    
    const { tutorId, startTime, endTime } = updateData;

    // Run client-side validation before sending network request
    if (tutorId && startTime && endTime) {
      const isConflict = checkDoubleBooking(tutorId, startTime, endTime, sessionId);
      if (isConflict) {
        set({ error: 'Client Validation Failed: Tutor is double-booked for this time slot.' });
        return null;
      }
    }

    set({ isSaving: true, error: null });

    try {
      // Generate a unique idempotency key for the backend to prevent network-level duplicates
      const idempotencyKey = `req-${sessionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const response = await axios.put(`/api/sessions/${sessionId}`, updateData, {
        headers: {
          'x-idempotency-key': idempotencyKey
        }
      });

      // Update local state with the returned validated session
      const updatedSession = response.data.session;
      set((state) => ({
        sessions: state.sessions.map((s) => s._id === updatedSession._id ? updatedSession : s),
        isSaving: false,
        editingSessionId: null,
        needsAdjustmentWorkflow: false
      }));

      // Return the full payload (which may include the adjustmentPreview object)
      return response.data;
    } catch (error) {
      set({ 
        error: error.response?.data?.message || error.message, 
        isSaving: false 
      });
      throw error;
    }
  },

  // 4. Create a new session (with isSaving lock + idempotency key)
  addSession: async (payload) => {
    const { isSaving, checkDoubleBooking, fetchSessions } = get();
    if (isSaving) return null;

    const { tutorId, startTime, endTime } = payload;
    if (tutorId && startTime && endTime) {
      const isConflict = checkDoubleBooking(tutorId, startTime, endTime);
      if (isConflict) {
        set({ error: 'Conflict Engine: This tutor already has a booking that overlaps with the proposed time.' });
        return null;
      }
    }

    set({ isSaving: true, error: null });
    try {
      const idempotencyKey = `new-${tutorId}-${new Date(startTime).getTime()}-${Math.random().toString(36).substr(2, 9)}`;
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': idempotencyKey
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.message || 'Failed to create session');
      }

      const data = await response.json();
      // Refresh full session list to pick up all generated recurring occurrences
      await fetchSessions();
      set({ isSaving: false });
      return data;
    } catch (error) {
      set({ error: error.message, isSaving: false });
      throw error;
    }
  }
}));

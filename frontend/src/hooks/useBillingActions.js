import { useState, useCallback } from 'react';
import axios from 'axios';
import { useBillingStore } from '../store/useBillingStore';

export const useBillingActions = () => {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState(null);
  const { setSessions, updateSession } = useBillingStore();

  const fetchSessions = useCallback(async () => {
    try {
      const response = await axios.get('http://localhost:5000/api/sessions');
      setSessions(response.data);
    } catch (err) {
      setError(err.message);
    }
  }, [setSessions]);

  const saveAdjustment = useCallback(async (sessionId, newAmount, reason) => {
    // Strict loading state locking to prevent button double-clicking
    if (isSaving) return; 
    
    setIsSaving(true);
    setError(null);
    try {
      const response = await axios.put(`http://localhost:5000/api/sessions/${sessionId}`, {
        newAmount,
        reason
      });
      updateSession(response.data);
      return response.data;
    } catch (err) {
      setError(err.response?.data?.message || err.message);
      throw err;
    } finally {
      // Release lock
      setIsSaving(false); 
    }
  }, [isSaving, updateSession]);

  return { fetchSessions, saveAdjustment, isSaving, error };
};

import { useEffect, useState } from 'react';
import { useSchedulingStore } from './useSchedulingStore';

function App() {
  const {
    sessions,
    isFetching,
    isSaving,
    error,
    fetchSessions,
    addSession,
    updateSessionWithLock,
    checkDoubleBooking,
    clearError
  } = useSchedulingStore();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState(null);

  // New session form states
  const [newSessionSubject, setNewSessionSubject] = useState('Mathematics');
  const [newSessionTutor, setNewSessionTutor] = useState('65f1a2b3c4d5e6f7a8b9c001');
  const [newSessionDate, setNewSessionDate] = useState('');
  const [newSessionStartHour, setNewSessionStartHour] = useState('09:00');
  const [newSessionDuration, setNewSessionDuration] = useState('1.5');
  const [newSessionStatus, setNewSessionStatus] = useState('Unbilled');
  const [newSessionRepeatWeekly, setNewSessionRepeatWeekly] = useState(false);
  const [newSessionRepeatUntil, setNewSessionRepeatUntil] = useState('');

  // Edit session modal states
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingSession, setEditingSession] = useState(null);
  const [editSessionSubject, setEditSessionSubject] = useState('Mathematics');
  const [editSessionTutor, setEditSessionTutor] = useState('');
  const [editSessionDate, setEditSessionDate] = useState('');
  const [editSessionStartHour, setEditSessionStartHour] = useState('09:00');
  const [editSessionDuration, setEditSessionDuration] = useState('1.5');
  const [editSessionStatus, setEditSessionStatus] = useState('Unbilled');

  // Load initial data
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Calculate start of current week (Sunday)
  const getStartOfWeek = (d) => {
    const date = new Date(d);
    const day = date.getDay();
    const diff = date.getDate() - day;
    const start = new Date(date.setDate(diff));
    start.setHours(0, 0, 0, 0);
    return start;
  };

  const startOfWeek = getStartOfWeek(currentDate);

  const daysOfWeek = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startOfWeek);
    d.setDate(startOfWeek.getDate() + i);
    return d;
  });

  const hours = Array.from({ length: 13 }, (_, i) => 8 + i); // 8 AM to 8 PM
  const hourHeight = 70; // Height of an hour slot in pixels

  // Helper to filter sessions for a specific day
  const getSessionsForDay = (day) => {
    return sessions.filter((s) => {
      const sDate = new Date(s.startTime);
      return (
        sDate.getFullYear() === day.getFullYear() &&
        sDate.getMonth() === day.getMonth() &&
        sDate.getDate() === day.getDate()
      );
    });
  };

  // Helper to calculate overlap columns and layout widths
  const getSessionsWithLayout = (daySessions) => {
    const sorted = [...daySessions].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    const columns = [];
    
    sorted.forEach(session => {
      let placed = false;
      const sTime = new Date(session.startTime).getTime();
      
      for (let i = 0; i < columns.length; i++) {
        const col = columns[i];
        const lastSession = col[col.length - 1];
        const lastETime = new Date(lastSession.endTime).getTime();
        
        if (sTime >= lastETime) {
          col.push(session);
          placed = true;
          break;
        }
      }
      
      if (!placed) {
        columns.push([session]);
      }
    });
    
    const sessionStyles = new Map();
    columns.forEach((col, colIdx) => {
      col.forEach(session => {
        sessionStyles.set(session._id, {
          columnIndex: colIdx,
          totalColumns: columns.length
        });
      });
    });
    
    return sorted.map(session => {
      const layout = sessionStyles.get(session._id) || { columnIndex: 0, totalColumns: 1 };
      return {
        ...session,
        layout
      };
    });
  };

  // Helper to calculate top & height for absolute placement on the grid
  const getSessionLayout = (session) => {
    const start = new Date(session.startTime);
    const end = new Date(session.endTime);
    const startHourVal = start.getHours() + start.getMinutes() / 60;
    const endHourVal = end.getHours() + end.getMinutes() / 60;

    const top = Math.max(0, (startHourVal - 8) * hourHeight);
    const height = Math.max(35, (endHourVal - startHourVal) * hourHeight);
    return { top, height };
  };

  // Navigate weeks
  const changeWeek = (offset) => {
    const nextDate = new Date(currentDate);
    nextDate.setDate(currentDate.getDate() + offset * 7);
    setCurrentDate(nextDate);
  };

  // Drag and Drop handlers
  const handleDragStart = (e, session) => {
    e.dataTransfer.setData('text/plain', session._id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = async (e, dayDate, hour) => {
    e.preventDefault();
    const sessionId = e.dataTransfer.getData('text/plain');
    const session = sessions.find((s) => s._id === sessionId);
    if (!session) return;

    if (session.billingStatus === 'Completed') {
      useSchedulingStore.setState({ error: 'Completed Guardrail: Completed sessions are locked and cannot be edited.' });
      return;
    }

    // Set new start time based on drop target
    const newStart = new Date(dayDate);
    newStart.setHours(hour, 0, 0, 0);

    const durationMs = new Date(session.endTime).getTime() - new Date(session.startTime).getTime();
    const newEnd = new Date(newStart.getTime() + durationMs);

    // Client-side optimistic check
    const isConflict = checkDoubleBooking(session.tutorId, newStart.toISOString(), newEnd.toISOString(), sessionId);
    if (isConflict) {
      useSchedulingStore.setState({ error: 'Conflict Engine: The tutor is already scheduled for another session during this time slot.' });
      return;
    }

    // Intercept if session is 'Billed'
    if (session.billingStatus === 'Billed') {
      setPendingUpdate({
        sessionId,
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString(),
        title: session.subject || 'Academic Session',
        originalStartTime: session.startTime,
        originalEndTime: session.endTime
      });
      setShowAdjustmentModal(true);
    } else {
      // Normal update for Unbilled
      await updateSessionWithLock(sessionId, {
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString()
      });
    }
  };

  // Confirm adjustment from the modal
  const handleConfirmAdjustment = async () => {
    if (!pendingUpdate || isSaving) return;
    try {
      const result = await updateSessionWithLock(pendingUpdate.sessionId, {
        startTime: pendingUpdate.startTime,
        endTime: pendingUpdate.endTime
      });
      
      if (result && result.adjustmentPreview) {
        alert(`Success! Adjustment Saved:\nAmount: ${result.adjustmentPreview.amount}\nDescription: ${result.adjustmentPreview.description}`);
      }
      setShowAdjustmentModal(false);
      setPendingUpdate(null);
    } catch (err) {
      console.error(err);
    }
  };

  // Open Edit Session Modal
  const handleCardClick = (session) => {
    clearError();
    setEditingSession(session);
    setEditSessionSubject(session.subject || 'Other');
    setEditSessionTutor(session.tutorId);
    
    // Format date in local timezone YYYY-MM-DD
    const sDate = new Date(session.startTime);
    const year = sDate.getFullYear();
    const month = String(sDate.getMonth() + 1).padStart(2, '0');
    const day = String(sDate.getDate()).padStart(2, '0');
    setEditSessionDate(`${year}-${month}-${day}`);
    
    // Format hours HH:MM
    const hoursVal = String(sDate.getHours()).padStart(2, '0');
    const minsVal = String(sDate.getMinutes()).padStart(2, '0');
    setEditSessionStartHour(`${hoursVal}:${minsVal}`);
    
    // Duration in hours
    const eDate = new Date(session.endTime);
    const diffHours = (eDate.getTime() - sDate.getTime()) / (1000 * 60 * 60);
    setEditSessionDuration(String(diffHours));
    
    setEditSessionStatus(session.billingStatus || 'Unbilled');
    setShowEditModal(true);
  };

  // Submit edits for a session
  const handleEditSessionSubmit = async (e) => {
    e.preventDefault();
    if (!editingSession || isSaving) return;

    const [startH, startM] = editSessionStartHour.split(':').map(Number);
    const start = new Date(editSessionDate);
    start.setHours(startH, startM, 0, 0);

    const durationHrs = parseFloat(editSessionDuration);
    const end = new Date(start.getTime() + durationHrs * 60 * 60 * 1000);

    // 1. Completed Guardrail
    if (editingSession.billingStatus === 'Completed') {
      alert('Cannot edit a completed session');
      return;
    }

    // 2. Conflict Engine Validation
    const isConflict = checkDoubleBooking(
      editSessionTutor, 
      start.toISOString(), 
      end.toISOString(), 
      editingSession._id
    );
    if (isConflict) {
      alert('Conflict Engine: This tutor already has a booking that overlaps with the proposed time.');
      return;
    }

    // Check if reschedule occurred
    const timeChanged = 
      start.getTime() !== new Date(editingSession.startTime).getTime() ||
      end.getTime() !== new Date(editingSession.endTime).getTime();

    const isBilled = editingSession.billingStatus === 'Billed';

    if (isBilled && timeChanged) {
      // Intercept with Adjustment workflow
      setPendingUpdate({
        sessionId: editingSession._id,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        title: editSessionSubject,
        originalStartTime: editingSession.startTime,
        originalEndTime: editingSession.endTime,
        billingStatus: editSessionStatus
      });
      setShowAdjustmentModal(true);
      setShowEditModal(false);
    } else {
      // Normal save
      try {
        await updateSessionWithLock(editingSession._id, {
          title: editSessionSubject,
          subject: editSessionSubject,
          tutorId: editSessionTutor,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          billingStatus: editSessionStatus
        });
        setShowEditModal(false);
      } catch (err) {
        alert(err.message);
      }
    }
  };

  // Add a brand new session
  // Routed through store.addSession which handles:
  //   1. isSaving lock (idempotency — button disabled while in-flight)
  //   2. Client-side conflict check before network call
  //   3. Unique x-idempotency-key header to backend
  //   4. Auto-refresh of session list (picks up all recurrence occurrences)
  const handleAddSession = async (e) => {
    e.preventDefault();
    if (!newSessionDate || isSaving) return;

    const [startH, startM] = newSessionStartHour.split(':').map(Number);
    const start = new Date(newSessionDate);
    start.setHours(startH, startM, 0, 0);
    const durationHrs = parseFloat(newSessionDuration);
    const end = new Date(start.getTime() + durationHrs * 60 * 60 * 1000);

    try {
      const result = await addSession({
        title: newSessionSubject,
        subject: newSessionSubject,
        tutorId: newSessionTutor,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        timezone: 'America/New_York',
        billingStatus: newSessionStatus,
        repeatWeekly: newSessionRepeatWeekly,
        repeatUntil: newSessionRepeatUntil
      });
      // null means conflict or lock prevented — error already set in store
      if (result !== null) {
        setShowAddModal(false);
        setNewSessionDate('');
        setNewSessionRepeatWeekly(false);
        setNewSessionRepeatUntil('');
      }
    } catch (err) {
      // error already set in store, no-op
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans">
      {/* Header bar */}
      <header className="bg-slate-950/80 backdrop-blur-md border-b border-slate-800 p-4 sticky top-0 z-10 flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <span className="p-2 bg-gradient-to-tr from-indigo-500 to-violet-600 rounded-lg text-white font-bold tracking-wider text-xl shadow-lg shadow-indigo-500/20">
            eB
          </span>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-violet-300 bg-clip-text text-transparent">
              Evallo Billing Calendar
            </h1>
            <p className="text-xs text-slate-400">Timezone-Aware Monorepo Dashboard</p>
          </div>
        </div>

        {/* Date Selector Navigation */}
        <div className="flex items-center gap-2 bg-slate-900 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => changeWeek(-1)}
            className="p-2 hover:bg-slate-800 rounded transition-colors text-slate-300"
          >
            ←
          </button>
          <span className="px-4 py-1 font-semibold text-sm">
            {startOfWeek.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} –{' '}
            {daysOfWeek[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          <button
            onClick={() => changeWeek(1)}
            className="p-2 hover:bg-slate-800 rounded transition-colors text-slate-300"
          >
            →
          </button>
        </div>

        {/* Add Session Trigger */}
        <button
          onClick={() => { clearError(); setShowAddModal(true); }}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-medium py-2 px-4 rounded-lg shadow-md hover:shadow-indigo-500/20 transition-all flex items-center gap-2"
        >
          <span className="text-lg font-bold">+</span> New Session
        </button>
      </header>

      {/* Main View Area */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full flex flex-col gap-6">
        {error && (
          <div className="bg-rose-950/50 border border-rose-800/80 rounded-lg p-4 text-rose-300 flex justify-between items-center">
            <p className="text-sm font-medium">{error}</p>
            <button onClick={clearError} className="text-rose-400 hover:text-rose-200">
              ✕
            </button>
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-6 bg-slate-950/40 p-4 rounded-xl border border-slate-800/60 text-xs">
          <span className="text-slate-400 font-semibold uppercase tracking-wider">Statuses:</span>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-md bg-indigo-500/20 border border-indigo-500/50"></span>
            <span>Unbilled (Draggable)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-md bg-amber-500/20 border border-amber-500/50"></span>
            <span>Billed (Rescheduling Credit Workflow)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-md bg-slate-700/30 border border-slate-600/50"></span>
            <span>Completed (Locked)</span>
          </div>
          <span className="text-slate-500 ml-auto italic">Tip: Drag & drop Unbilled or Billed session cards to reschedule them.</span>
        </div>

        {/* Week View Grid */}
        <div className="bg-slate-950/40 border border-slate-800 rounded-2xl overflow-hidden flex flex-col flex-1 shadow-2xl">
          {/* Day Headers */}
          <div className="grid grid-cols-8 border-b border-slate-800 bg-slate-950/80 text-center font-semibold text-xs tracking-wider text-slate-400 uppercase">
            <div className="p-3 border-r border-slate-800 flex items-center justify-center">Time</div>
            {daysOfWeek.map((day, idx) => {
              const isToday = new Date().toDateString() === day.toDateString();
              return (
                <div
                  key={idx}
                  className={`p-3 border-r border-slate-800 flex flex-col justify-center items-center gap-1 ${
                    isToday ? 'bg-indigo-950/20 text-indigo-400' : ''
                  }`}
                >
                  <span>{day.toLocaleDateString(undefined, { weekday: 'short' })}</span>
                  <span className={`text-base font-bold ${isToday ? 'text-indigo-400' : 'text-slate-200'}`}>
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Calendar Body */}
          <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 300px)', minHeight: '300px' }}>
            <div className="grid grid-cols-8 relative select-none" style={{ height: `${13 * hourHeight}px` }}>
            {/* Sidebar Time Labels */}
            <div className="relative border-r border-slate-800 bg-slate-950/20">
              {hours.map((h, i) => (
                <div
                  key={h}
                  className="absolute left-0 right-0 text-right pr-3 text-[10px] font-bold text-slate-500"
                  style={{ top: `${i * hourHeight}px`, height: `${hourHeight}px`, lineHeight: '14px' }}
                >
                  {h === 12 ? '12:00 PM' : h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`}
                </div>
              ))}
            </div>

            {/* Day Columns */}
            {daysOfWeek.map((day, dIdx) => {
              const rawDaySessions = getSessionsForDay(day);
              const daySessions = getSessionsWithLayout(rawDaySessions);
              return (
                <div
                  key={dIdx}
                  className="relative border-r border-slate-800 h-full bg-slate-900/10 hover:bg-slate-900/30 transition-colors"
                  onDragOver={(e) => e.preventDefault()}
                >
                  {/* Grid Lines for Hours */}
                  {hours.map((h, hIdx) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-b border-slate-800/40"
                      style={{ top: `${hIdx * hourHeight}px`, height: `${hourHeight}px` }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleDrop(e, day, h)}
                    />
                  ))}

                  {/* Render Sessions */}
                  {daySessions.map((session) => {
                    const { top, height } = getSessionLayout(session);
                    const { columnIndex, totalColumns } = session.layout;
                    
                    const leftPercent = (columnIndex / totalColumns) * 100;
                    const widthPercent = 100 / totalColumns;

                    const isBilled = session.billingStatus === 'Billed';
                    const isCompleted = session.billingStatus === 'Completed';

                    let colorClasses = 'bg-indigo-500/10 border-indigo-500/60 text-indigo-200';
                    if (isBilled) {
                      colorClasses = 'bg-green/10 border-amber-500/60 text-amber-200';
                    } else if (isCompleted) {
                      colorClasses = 'bg-slate-700/20 border-slate-600/40 text-slate-400 opacity-60';
                    }

                    return (
                      <div
                        key={session._id}
                        draggable={!isCompleted}
                        onDragStart={(e) => handleDragStart(e, session)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.stopPropagation();
                          handleDrop(e, day, new Date(session.startTime).getHours());
                        }}
                        onClick={() => handleCardClick(session)}
                        className={`absolute p-2 rounded-xl border flex flex-col justify-between transition-all ${colorClasses} ${
                          !isCompleted ? 'cursor-grab active:cursor-grabbing hover:shadow-lg hover:brightness-110' : 'cursor-default'
                        }`}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          left: `calc(${leftPercent}% + 2px)`,
                          width: `calc(${widthPercent}% - 4px)`
                        }}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold text-xs truncate">{session.subject || 'Session'}</span>
                            <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-950/40 font-semibold">
                              {session.billingStatus}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-400 block mt-0.5">
                            {new Date(session.startTime).toLocaleTimeString(undefined, {
                              hour: 'numeric',
                              minute: '2-digit'
                            })}
                          </span>
                          {session.recurrenceGroupId && (
                            <span className="text-[9px] text-violet-400 font-semibold mt-0.5 flex items-center gap-0.5">
                              ↻ Recurring
                            </span>
                          )}
                        </div>
                        <span className="text-[9px] text-slate-500 self-end font-medium">
                          Tutor: {String(session.tutorId) === '65f1a2b3c4d5e6f7a8b9c001' ? 'Tutor A' : 'Tutor B'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          </div>
        </div>
      </main>

      {/* 1. Adjustment Preview Modal */}
      {showAdjustmentModal && pendingUpdate && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl p-6 overflow-hidden animate-in fade-in zoom-in duration-200">
            <h3 className="text-lg font-bold text-amber-400 mb-2 flex items-center gap-2">
              ⚠️ Adjustment Preview Required
            </h3>
            <p className="text-slate-300 text-sm mb-4 leading-relaxed">
              You are updating a <strong>Billed</strong> session. To preserve original invoice ledger records, an adjustment credit of $50 will be generated.
            </p>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800/80 flex flex-col gap-2.5 text-xs mb-6">
              <div className="flex justify-between">
                <span className="text-slate-400">Session:</span>
                <span className="font-semibold text-slate-200">{pendingUpdate.title}</span>
              </div>
              <div className="flex flex-col gap-1 border-t border-slate-800/50 pt-2">
                <span className="text-slate-400">Original Time:</span>
                <span className="text-slate-300">
                  {new Date(pendingUpdate.originalStartTime).toLocaleString()}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-slate-400">Proposed New Time:</span>
                <span className="text-slate-300">
                  {new Date(pendingUpdate.startTime).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-800/50 pt-2 font-bold">
                <span className="text-slate-400">Calculated Adjustment:</span>
                <span className="text-emerald-400">-$50.00 (Credit)</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setShowAdjustmentModal(false);
                  setPendingUpdate(null);
                }}
                disabled={isSaving}
                className="flex-1 py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAdjustment}
                disabled={isSaving}
                className="flex-1 py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors disabled:bg-indigo-800 disabled:text-indigo-400 flex items-center justify-center gap-2"
              >
                {isSaving ? 'Processing...' : 'Confirm Adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Add Session Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleAddSession}
            className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl p-6 overflow-hidden flex flex-col gap-4"
          >
            <h3 className="text-lg font-bold text-slate-100">Create Mock Session</h3>

            {error && (
              <div className="bg-rose-950/60 border border-rose-800/80 rounded-lg p-3 text-rose-300 text-xs flex justify-between items-center">
                <span>{error}</span>
                <button type="button" onClick={clearError} className="text-rose-400 font-bold ml-2">✕</button>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-bold uppercase">Subject</label>
              <select
                value={newSessionSubject}
                onChange={(e) => setNewSessionSubject(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                {['Mathematics','Physics','Chemistry','Biology','English','History','Geography','Computer Science','SAT Prep','ACT Prep','Other'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-bold uppercase">Tutor</label>
                <select
                  value={newSessionTutor}
                  onChange={(e) => setNewSessionTutor(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="65f1a2b3c4d5e6f7a8b9c001">Tutor A</option>
                  <option value="65f1a2b3c4d5e6f7a8b9c002">Tutor B</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-bold uppercase">Billing Status</label>
                <select
                  value={newSessionStatus}
                  onChange={(e) => setNewSessionStatus(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="Unbilled">Unbilled</option>
                  <option value="Billed">Billed</option>
                  <option value="Completed">Completed</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-slate-400 font-bold uppercase">Date</label>
              <input
                type="date"
                required
                value={newSessionDate}
                onChange={(e) => setNewSessionDate(e.target.value)}
                onClick={(e) => e.target.showPicker && e.target.showPicker()}
                onFocus={(e) => e.target.showPicker && e.target.showPicker()}
                className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-bold uppercase">Start Time</label>
                <input
                  type="time"
                  required
                  value={newSessionStartHour}
                  onChange={(e) => setNewSessionStartHour(e.target.value)}
                  onClick={(e) => e.target.showPicker && e.target.showPicker()}
                  onFocus={(e) => e.target.showPicker && e.target.showPicker()}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-bold uppercase">Duration (Hours)</label>
                <select
                  value={newSessionDuration}
                  onChange={(e) => setNewSessionDuration(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="0.5">30 Mins</option>
                  <option value="1">1 Hour</option>
                  <option value="1.5">1.5 Hours</option>
                  <option value="2">2 Hours</option>
                </select>
              </div>
            </div>

            {/* Weekly Recurrence */}
            <div className="flex flex-col gap-2.5 bg-slate-950/30 p-3.5 rounded-xl border border-slate-800/60">
              <label className="flex items-center gap-2 text-xs font-bold uppercase text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newSessionRepeatWeekly}
                  onChange={(e) => setNewSessionRepeatWeekly(e.target.checked)}
                  className="rounded border-slate-800 bg-slate-950 text-indigo-600 focus:ring-0 focus:ring-offset-0 w-4 h-4 cursor-pointer"
                />
                Repeat Weekly
              </label>
              
              {newSessionRepeatWeekly && (
                <div className="flex flex-col gap-1.5 mt-1.5 animate-in fade-in duration-200">
                  <label className="text-[10px] text-slate-400 font-bold uppercase">Repeat Until Date</label>
                  <input
                    type="date"
                    required={newSessionRepeatWeekly}
                    value={newSessionRepeatUntil}
                    onChange={(e) => setNewSessionRepeatUntil(e.target.value)}
                    onClick={(e) => e.target.showPicker && e.target.showPicker()}
                    onFocus={(e) => e.target.showPicker && e.target.showPicker()}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={() => { setShowAddModal(false); clearError(); }}
                disabled={isSaving}
                className="flex-1 py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              {/* Idempotency lock: disabled + spinner while isSaving is true */}
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors disabled:bg-indigo-800 disabled:text-indigo-400 flex items-center justify-center gap-2"
              >
                {isSaving ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Saving...
                  </>
                ) : 'Save Session'}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* 3. Edit Session Modal */}
      {showEditModal && editingSession && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleEditSessionSubmit}
            className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-2xl shadow-2xl p-6 overflow-hidden flex flex-col gap-4"
          >
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-100">
                {editingSession.billingStatus === 'Completed' ? 'View Completed Session (Locked)' : 'Edit Session Details'}
              </h3>
              {editingSession.billingStatus === 'Completed' && (
                <span className="text-[10px] uppercase font-bold text-red-400 bg-red-950/30 border border-red-800/40 px-2 py-0.5 rounded">
                  Locked
                </span>
              )}
            </div>

            {error && (
              <div className="bg-rose-950/60 border border-rose-800/80 rounded-lg p-3 text-rose-300 text-xs flex justify-between items-center">
                <span>{error}</span>
                <button type="button" onClick={clearError} className="text-rose-400 font-bold ml-2">✕</button>
              </div>
            )}

            <fieldset disabled={editingSession.billingStatus === 'Completed'} className="flex flex-col gap-4">

              {/* Recurrence info banner */}
              {editingSession.recurrenceGroupId && (
                <div className="flex items-center gap-2 bg-violet-950/30 border border-violet-800/40 rounded-lg p-3 text-xs text-violet-300">
                  <span className="text-base">↻</span>
                  <div>
                    <p className="font-bold">Part of a recurring series</p>
                    <p className="text-violet-400/80 mt-0.5">Navigate weeks with ← → to see all occurrences. Editing only changes this session.</p>
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-bold uppercase">Subject</label>
                <select
                  value={editSessionSubject}
                  onChange={(e) => setEditSessionSubject(e.target.value)}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                >
                  {['Mathematics','Physics','Chemistry','Biology','English','History','Geography','Computer Science','SAT Prep','ACT Prep','Other'].map(s => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-bold uppercase">Tutor</label>
                  <select
                    value={editSessionTutor}
                    onChange={(e) => setEditSessionTutor(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  >
                    <option value="65f1a2b3c4d5e6f7a8b9c001">Tutor A</option>
                    <option value="65f1a2b3c4d5e6f7a8b9c002">Tutor B</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-bold uppercase">Billing Status</label>
                  <select
                    value={editSessionStatus}
                    onChange={(e) => setEditSessionStatus(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  >
                    <option value="Unbilled">Unbilled</option>
                    <option value="Billed">Billed</option>
                    <option value="Completed">Completed</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-slate-400 font-bold uppercase">Date</label>
                <input
                  type="date"
                  required
                  value={editSessionDate}
                  onChange={(e) => setEditSessionDate(e.target.value)}
                  onClick={(e) => e.target.showPicker && e.target.showPicker()}
                  onFocus={(e) => e.target.showPicker && e.target.showPicker()}
                  className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-bold uppercase">Start Time</label>
                  <input
                    type="time"
                    required
                    value={editSessionStartHour}
                    onChange={(e) => setEditSessionStartHour(e.target.value)}
                    onClick={(e) => e.target.showPicker && e.target.showPicker()}
                    onFocus={(e) => e.target.showPicker && e.target.showPicker()}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-slate-400 font-bold uppercase">Duration (Hours)</label>
                  <select
                    value={editSessionDuration}
                    onChange={(e) => setEditSessionDuration(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-sm text-slate-100 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  >
                    <option value="0.5">30 Mins</option>
                    <option value="1">1 Hour</option>
                    <option value="1.5">1.5 Hours</option>
                    <option value="2">2 Hours</option>
                  </select>
                </div>
              </div>
            </fieldset>

            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={() => { setShowEditModal(false); clearError(); }}
                disabled={isSaving}
                className="flex-1 py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors disabled:opacity-50"
              >
                Close
              </button>
              {editingSession.billingStatus !== 'Completed' && (
                /* Idempotency lock: disabled + spinner while isSaving prevents double-saves */
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-colors disabled:bg-indigo-800 disabled:text-indigo-400 flex items-center justify-center gap-2"
                >
                  {isSaving ? (
                    <>
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Saving...
                    </>
                  ) : 'Save Changes'}
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;

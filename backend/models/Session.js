const mongoose = require('mongoose');

const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'History', 'Geography', 'Computer Science', 'SAT Prep', 'ACT Prep', 'Other'];

const sessionSchema = new mongoose.Schema({
  subject: { type: String, enum: SUBJECTS, required: true, default: 'Other' },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  tutorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  startTime: { type: Date, required: true },
  endTime: { type: Date, required: true },
  timezone: { type: String, required: true, description: 'Local timezone string (e.g., America/New_York)' },
  billingStatus: { type: String, enum: ['Unbilled', 'Billed', 'Completed'], default: 'Unbilled' },
  recurrenceGroupId: { type: mongoose.Schema.Types.ObjectId }
}, { timestamps: true });

module.exports = mongoose.model('Session', sessionSchema);

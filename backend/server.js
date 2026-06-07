global.crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

const Session = require('./models/Session');
const Adjustment = require('./models/Adjustment');
const { MongoMemoryServer } = require('mongodb-memory-server');

dotenv.config({ path: require('path').resolve(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json());

const Organization = require('./models/Organization');
const Invoice = require('./models/Invoice');

// Seeding function to populate db with mock sessions if empty
async function seedData() {
  try {
    const sessionCount = await Session.countDocuments();
    if (sessionCount === 0) {
      console.log('Seeding database with initial data...');
      
      let org = await Organization.findOne();
      if (!org) {
        org = new Organization({
          name: 'Evallo Academy',
          contactEmail: 'hello@evallo.com'
        });
        await org.save();
      }

      // Consistent tutor IDs for testing conflict engine
      const tutorId1 = new mongoose.Types.ObjectId('65f1a2b3c4d5e6f7a8b9c001');
      const tutorId2 = new mongoose.Types.ObjectId('65f1a2b3c4d5e6f7a8b9c002');

      const today = new Date();
      // Start of current week (e.g. Sunday or Monday)
      const startOfWeek = new Date(today);
      startOfWeek.setDate(today.getDate() - today.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const sessions = [
        {
          organizationId: org._id,
          tutorId: tutorId1,
          subject: 'Mathematics',
          startTime: new Date(startOfWeek.getTime() + (1 * 24 + 9) * 60 * 60 * 1000),
          endTime: new Date(startOfWeek.getTime() + (1 * 24 + 10.5) * 60 * 60 * 1000),
          timezone: 'America/New_York',
          billingStatus: 'Unbilled'
        },
        {
          organizationId: org._id,
          tutorId: tutorId1,
          subject: 'SAT Prep',
          startTime: new Date(startOfWeek.getTime() + (1 * 24 + 11) * 60 * 60 * 1000),
          endTime: new Date(startOfWeek.getTime() + (1 * 24 + 12.5) * 60 * 60 * 1000),
          timezone: 'America/New_York',
          billingStatus: 'Billed'
        },
        {
          organizationId: org._id,
          tutorId: tutorId2,
          subject: 'English',
          startTime: new Date(startOfWeek.getTime() + (2 * 24 + 14) * 60 * 60 * 1000),
          endTime: new Date(startOfWeek.getTime() + (2 * 24 + 15.5) * 60 * 60 * 1000),
          timezone: 'America/New_York',
          billingStatus: 'Completed'
        },
        {
          organizationId: org._id,
          tutorId: tutorId1,
          subject: 'Physics',
          startTime: new Date(startOfWeek.getTime() + (3 * 24 + 10) * 60 * 60 * 1000),
          endTime: new Date(startOfWeek.getTime() + (3 * 24 + 11.5) * 60 * 60 * 1000),
          timezone: 'America/New_York',
          billingStatus: 'Unbilled'
        },
        {
          organizationId: org._id,
          tutorId: tutorId2,
          subject: 'Chemistry',
          startTime: new Date(startOfWeek.getTime() + (4 * 24 + 13) * 60 * 60 * 1000),
          endTime: new Date(startOfWeek.getTime() + (4 * 24 + 14.5) * 60 * 60 * 1000),
          timezone: 'America/New_York',
          billingStatus: 'Billed'
        }
      ];

      const createdSessions = await Session.insertMany(sessions);
      console.log('Database successfully seeded with mock sessions.');

      // Clear old invoices and seed new one for Billed sessions
      await Invoice.deleteMany({});
      const billedSessions = createdSessions.filter(s => s.billingStatus === 'Billed');
      if (billedSessions.length > 0) {
        const invoice = new Invoice({
          organizationId: org._id,
          billingPeriodStart: startOfWeek,
          billingPeriodEnd: new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000), // end of week
          lineItems: billedSessions.map(s => ({
            description: `Tutoring Session: ${s.subject}`,
            amount: 120,
            sessionId: s._id
          }))
        });
        await invoice.save();
        console.log('Database successfully seeded with Invoice containing Billed sessions.');
      }
    } else {
      // If sessions already exist but no invoices exist, back-seed invoices for Billed sessions
      const invoiceCount = await Invoice.countDocuments();
      if (invoiceCount === 0) {
        const billedSessions = await Session.find({ billingStatus: 'Billed' });
        if (billedSessions.length > 0) {
          let org = await Organization.findOne();
          if (!org) {
            org = new Organization({ name: 'Evallo Academy', contactEmail: 'hello@evallo.com' });
            await org.save();
          }
          const today = new Date();
          const startOfWeek = new Date(today);
          startOfWeek.setDate(today.getDate() - today.getDay());
          startOfWeek.setHours(0, 0, 0, 0);

          const invoice = new Invoice({
            organizationId: org._id,
            billingPeriodStart: startOfWeek,
            billingPeriodEnd: new Date(startOfWeek.getTime() + 7 * 24 * 60 * 60 * 1000),
            lineItems: billedSessions.map(s => ({
              description: `Tutoring Session: ${s.title || 'Academic Session'}`,
              amount: 120,
              sessionId: s._id
            }))
          });
          await invoice.save();
          console.log('Database successfully back-seeded with Invoice containing Billed sessions.');
        }
      }
    }
  } catch (error) {
    console.error('Error seeding database:', error);
  }
}

// Mongoose initialization
async function connectDB() {
  let mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.log('No MONGO_URI found in env. Starting MongoMemoryServer...');
    try {
      const mongoServer = await MongoMemoryServer.create();
      mongoUri = mongoServer.getUri();
      console.log('MongoMemoryServer started at:', mongoUri);
    } catch (e) {
      console.error('Failed to start MongoMemoryServer:', e);
      // Fallback to local
      mongoUri = 'mongodb://127.0.0.1:27017/evalloBillCal';
    }
  }

  try {
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');
    await seedData();
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
}

connectDB();

// ── Admin Reseed ────────────────────────────────────────────────────────────
// POST /api/admin/reseed — wipe all data and insert 10 random sessions
const SUBJECTS = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English',
  'History', 'Geography', 'Computer Science', 'SAT Prep', 'ACT Prep'];
const STATUSES = ['Unbilled', 'Unbilled', 'Billed', 'Billed', 'Completed']; // weighted

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

app.post('/api/admin/reseed', async (req, res) => {
  try {
    // 1. Wipe all collections
    await Session.deleteMany({});
    await Invoice.deleteMany({});
    await Adjustment.deleteMany({});
    await Organization.deleteMany({});

    // 2. Re-create organisation
    const org = await Organization.create({
      name: 'Evallo Academy',
      contactEmail: 'hello@evallo.com'
    });

    // 3. Fixed tutor IDs (needed for conflict engine)
    const tutorId1 = new mongoose.Types.ObjectId('65f1a2b3c4d5e6f7a8b9c001');
    const tutorId2 = new mongoose.Types.ObjectId('65f1a2b3c4d5e6f7a8b9c002');
    const tutors = [tutorId1, tutorId2];

    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay()); // Sunday
    startOfWeek.setHours(0, 0, 0, 0);

    // 4. Generate 10 non-overlapping random sessions spread Mon–Sat
    const DURATIONS = [1, 1.5, 2]; // hours
    const SESSION_COUNT = 10;
    const usedSlots = {}; // tutorId_day_startHour → true  (simple collision guard)

    const sessionsToInsert = [];
    let attempts = 0;

    while (sessionsToInsert.length < SESSION_COUNT && attempts < 200) {
      attempts++;
      const dayOffset = randInt(1, 6);        // Mon=1 … Sat=6
      const startHour = randInt(8, 17);        // 8 AM – 5 PM
      const duration  = pick(DURATIONS);
      const tutorId   = pick(tutors);
      const slotKey   = `${tutorId}_${dayOffset}_${startHour}`;

      if (usedSlots[slotKey]) continue;

      // Check that a 2-hour window at this slot is fully free for this tutor
      const slotConflict = [0, 0.5, 1, 1.5].some(d =>
        usedSlots[`${tutorId}_${dayOffset}_${startHour + d}`]
      );
      if (slotConflict) continue;

      // Mark slots occupied
      for (let h = 0; h < duration; h += 0.5) {
        usedSlots[`${tutorId}_${dayOffset}_${startHour + h}`] = true;
      }

      const startTime = new Date(startOfWeek.getTime() + (dayOffset * 24 + startHour) * 3600000);
      const endTime   = new Date(startTime.getTime() + duration * 3600000);

      sessionsToInsert.push({
        organizationId: org._id,
        tutorId,
        subject: pick(SUBJECTS),
        startTime,
        endTime,
        timezone: 'America/New_York',
        billingStatus: pick(STATUSES)
      });
    }

    const created = await Session.insertMany(sessionsToInsert);

    // 5. Create Invoice for Billed sessions
    const billed = created.filter(s => s.billingStatus === 'Billed');
    let invoice = null;
    if (billed.length > 0) {
      invoice = await Invoice.create({
        organizationId: org._id,
        billingPeriodStart: startOfWeek,
        billingPeriodEnd: new Date(startOfWeek.getTime() + 7 * 86400000),
        lineItems: billed.map(s => ({
          description: `Tutoring Session: ${s.subject}`,
          amount: 120,
          sessionId: s._id
        }))
      });
    }

    console.log(`[reseed] Wiped DB. Inserted ${created.length} sessions, ${billed.length} billed.`);
    res.json({
      message: `Database reseeded with ${created.length} random sessions.`,
      sessionCount: created.length,
      billedCount: billed.length,
      invoiceId: invoice?._id ?? null
    });
  } catch (err) {
    console.error('[reseed] Error:', err);
    res.status(500).json({ message: err.message });
  }
});
// ────────────────────────────────────────────────────────────────────────────

app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await Session.find();
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post('/api/sessions', async (req, res) => {
  try {
    const { title, tutorId, startTime, endTime, timezone, billingStatus, organizationId, repeatWeekly, repeatUntil } = req.body;
    let orgId = organizationId;
    if (!orgId) {
      let org = await Organization.findOne();
      if (!org) {
        org = new Organization({
          name: 'Evallo Academy',
          contactEmail: 'hello@evallo.com'
        });
        await org.save();
      }
      orgId = org._id;
    }

    const sessionsToCreate = [];
    const recurrenceGroupId = repeatWeekly ? new mongoose.Types.ObjectId() : null;

    let currentStart = new Date(startTime);
    let currentEnd = new Date(endTime);
    const untilDate = repeatUntil ? new Date(repeatUntil) : null;

    if (repeatWeekly && untilDate) {
      // Create recurring occurrences
      while (currentStart <= untilDate) {
        sessionsToCreate.push({
          title: title || 'Academic Session',
          organizationId: orgId,
          tutorId,
          startTime: new Date(currentStart),
          endTime: new Date(currentEnd),
          timezone: timezone || 'America/New_York',
          billingStatus: billingStatus || 'Unbilled',
          recurrenceGroupId
        });

        // Advance by exactly 7 days
        currentStart.setDate(currentStart.getDate() + 7);
        currentEnd.setDate(currentEnd.getDate() + 7);
      }
    } else {
      sessionsToCreate.push({
        title: title || 'Academic Session',
        organizationId: orgId,
        tutorId,
        startTime: currentStart,
        endTime: currentEnd,
        timezone: timezone || 'America/New_York',
        billingStatus: billingStatus || 'Unbilled'
      });
    }

    // Conflict Check for each generated session in the series
    for (const sessionData of sessionsToCreate) {
      const conflict = await Session.findOne({
        tutorId,
        startTime: { $lt: sessionData.endTime },
        endTime: { $gt: sessionData.startTime }
      });
      if (conflict) {
        return res.status(409).json({
          message: `Conflict Engine Validation Failed: Tutor is already booked for an overlapping session on ${new Date(sessionData.startTime).toLocaleDateString()}`
        });
      }
    }

    const createdSessions = await Session.insertMany(sessionsToCreate);
    res.status(201).json({ sessions: createdSessions });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// In-memory set to prevent double-click save operations (Idempotency check)
const processedRequests = new Set();

// GET /api/invoices — return all invoices with line items (for billing ledger display)
app.get('/api/invoices', async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    res.json(invoices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/adjustments — return all adjustments (audit trail)
app.get('/api/adjustments', async (req, res) => {
  try {
    const adjustments = await Adjustment.find().sort({ createdAt: -1 });
    res.json(adjustments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.put('/api/sessions/:id', async (req, res) => {
  try {
    // Backend Idempotency Check against button double-clicks
    const idempotencyKey = req.headers['x-idempotency-key'] || req.body.idempotencyKey;
    if (idempotencyKey) {
      if (processedRequests.has(idempotencyKey)) {
        return res.status(409).json({ message: 'Duplicate request detected. Action already processed.' });
      }
      processedRequests.add(idempotencyKey);
      
      // Optional: Clear key after some time to prevent memory leak
      setTimeout(() => processedRequests.delete(idempotencyKey), 60000);
    }

    const session = await Session.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ message: 'Session not found' });
    }

    // 1. Completed Guardrail
    if (session.billingStatus === 'Completed') {
      return res.status(403).json({ message: 'Cannot edit a completed session' });
    }

    const { startTime: newStartTime, endTime: newEndTime, ...otherUpdates } = req.body;
    
    let isRescheduled = false;
    let sTime = session.startTime;
    let eTime = session.endTime;

    if (newStartTime || newEndTime) {
      sTime = newStartTime ? new Date(newStartTime) : session.startTime;
      eTime = newEndTime ? new Date(newEndTime) : session.endTime;
      
      // Check if times actually changed
      if (sTime.getTime() !== session.startTime.getTime() || eTime.getTime() !== session.endTime.getTime()) {
        isRescheduled = true;

        // 2. Conflict Engine
        const conflict = await Session.findOne({
          _id: { $ne: session._id },
          tutorId: session.tutorId,
          startTime: { $lt: eTime },
          endTime: { $gt: sTime }
        });

        if (conflict) {
          return res.status(409).json({ message: 'Conflict Engine Validation Failed: Tutor is already booked for this time slot' });
        }
      }
    }

    let adjustmentPreview = null;

    // 3. Immutable Billing Engine
    if (session.billingStatus === 'Billed' && isRescheduled) {
      // Create a $50 credit adjustment without overwriting the original invoice ledger history
      const adjustment = new Adjustment({
        sessionId: session._id,
        amount: -50, // $50 credit
        description: 'Rescheduling fee credit applied due to post-billing schedule change'
      });
      await adjustment.save();

      // Payload for client-side human verification
      adjustmentPreview = {
        amount: adjustment.amount,
        description: adjustment.description,
        adjustmentId: adjustment._id
      };
    }

    // Apply updates
    if (isRescheduled) {
      session.startTime = sTime;
      session.endTime = eTime;
    }
    
    // Process other non-schedule updates (ensuring we don't maliciously overwrite billing status)
    if (otherUpdates.title) {
      session.title = otherUpdates.title;
    }
    if (otherUpdates.subject) {
      session.subject = otherUpdates.subject;
    }
    if (otherUpdates.billingStatus && session.billingStatus !== 'Completed') {
      session.billingStatus = otherUpdates.billingStatus;
    }

    await session.save();

    const responsePayload = { session };
    if (adjustmentPreview) {
      responsePayload.adjustmentPreview = adjustmentPreview;
    }

    res.json(responsePayload);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

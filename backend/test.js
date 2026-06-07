// Set environment to test so server.js spins up an isolated MongoMemoryServer
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Let OS assign a random free port

const assert = require('assert');
const app = require('./server');
const mongoose = require('mongoose');

const Session = require('./models/Session');
const Adjustment = require('./models/Adjustment');
const Organization = require('./models/Organization');
const Invoice = require('./models/Invoice');

let server;
let baseUrl;

async function runTests() {
  console.log('\n===== STARTING BACKEND BUSINESS RULE TESTS =====\n');

  // 1. Wait for database connection and server to be ready
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      console.log(`Test server listening on ${baseUrl}`);
      resolve();
    });
  });

  try {
    // Wipe any seeded mock data to ensure clean, isolated tests
    await Session.deleteMany({});
    await Adjustment.deleteMany({});
    await Invoice.deleteMany({});

    const org = await Organization.findOne() || await Organization.create({ name: 'Evallo Academy', contactEmail: 'test@evallo.com' });
    const tutorId1 = new mongoose.Types.ObjectId('65f1a2b3c4d5e6f7a8b9c001');
    const tutorId2 = new mongoose.Types.ObjectId('65f1a2b3c4d5e6f7a8b9c002');

    // ─── TEST 1: TUTOR CONFLICT DETECTION ─────────────────────────────────────
    console.log('Test 1: Verifying tutor conflict detection...');
    
    // Create base session
    const baseSession = await Session.create({
      organizationId: org._id,
      tutorId: tutorId1,
      subject: 'Mathematics',
      startTime: new Date('2026-06-08T09:00:00Z'),
      endTime: new Date('2026-06-08T10:30:00Z'),
      timezone: 'America/New_York',
      billingStatus: 'Unbilled'
    });

    // Attempt to book overlapping session for same tutor
    const overlapRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationId: org._id,
        tutorId: tutorId1.toString(),
        subject: 'Physics',
        startTime: '2026-06-08T10:00:00Z', // overlaps 10:00 - 10:30
        endTime: '2026-06-08T11:30:00Z',
        timezone: 'America/New_York',
        billingStatus: 'Unbilled'
      })
    });

    assert.strictEqual(overlapRes.status, 409, 'Overlapping booking should return 409 Conflict');
    const overlapData = await overlapRes.json();
    assert.match(overlapData.message, /Conflict Engine/, 'Error message should indicate conflict');
    console.log('✅ Test 1 Passed: Double-booking correctly blocked.');


    // ─── TEST 2: COMPLETED SESSION GUARDRAIL ──────────────────────────────────
    console.log('\nTest 2: Verifying completed session guardrail...');
    
    const completedSession = await Session.create({
      organizationId: org._id,
      tutorId: tutorId2,
      subject: 'English',
      startTime: new Date('2026-06-09T14:00:00Z'),
      endTime: new Date('2026-06-09T15:30:00Z'),
      timezone: 'America/New_York',
      billingStatus: 'Completed'
    });

    const editCompletedRes = await fetch(`${baseUrl}/api/sessions/${completedSession._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startTime: new Date('2026-06-09T15:00:00Z').toISOString()
      })
    });

    assert.strictEqual(editCompletedRes.status, 403, 'Editing a completed session should return 403 Forbidden');
    const completedData = await editCompletedRes.json();
    assert.match(completedData.message, /completed session/, 'Should block edits to completed sessions');
    console.log('✅ Test 2 Passed: Completed sessions are correctly locked.');


    // ─── TEST 3: BILLING HISTORY ADJUSTMENTS ──────────────────────────────────
    console.log('\nTest 3: Verifying billing adjustments ledger...');
    
    const billedSession = await Session.create({
      organizationId: org._id,
      tutorId: tutorId2,
      subject: 'Chemistry',
      startTime: new Date('2026-06-10T13:00:00Z'),
      endTime: new Date('2026-06-10T14:30:00Z'),
      timezone: 'America/New_York',
      billingStatus: 'Billed'
    });

    const editBilledRes = await fetch(`${baseUrl}/api/sessions/${billedSession._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startTime: new Date('2026-06-10T14:00:00Z').toISOString(),
        endTime: new Date('2026-06-10T15:30:00Z').toISOString()
      })
    });

    assert.strictEqual(editBilledRes.status, 200, 'Rescheduling billed session should succeed');
    const billedData = await editBilledRes.json();
    
    // Check that an adjustment was generated
    assert.ok(billedData.adjustmentPreview, 'Response should contain adjustment preview');
    assert.strictEqual(billedData.adjustmentPreview.amount, -50, 'Adjustment amount should be -50');

    const adjustmentsInDb = await Adjustment.find({ sessionId: billedSession._id });
    assert.strictEqual(adjustmentsInDb.length, 1, 'Exactly 1 adjustment document should exist in DB');
    assert.strictEqual(adjustmentsInDb[0].amount, -50);
    console.log('✅ Test 3 Passed: Changing billed session correctly logged a credit adjustment.');


    // ─── TEST 4: API IDEMPOTENCY KEY ──────────────────────────────────────────
    console.log('\nTest 4: Verifying API request idempotency...');
    
    const idempotencyKey = 'test-idemp-12345';
    const payload = {
      organizationId: org._id,
      tutorId: tutorId2.toString(),
      subject: 'Biology',
      startTime: new Date('2026-06-11T09:00:00Z').toISOString(),
      endTime: new Date('2026-06-11T10:30:00Z').toISOString(),
      timezone: 'America/New_York',
      billingStatus: 'Unbilled'
    };

    // First request
    const firstRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey
      },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(firstRes.status, 201, 'First request should succeed');

    // Duplicate second request with same key
    const secondRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-idempotency-key': idempotencyKey
      },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(secondRes.status, 409, 'Duplicate request should return 409 Conflict');
    const secondData = await secondRes.json();
    assert.match(secondData.message, /Duplicate request/, 'Should report duplicate request');
    console.log('✅ Test 4 Passed: Duplicate API requests correctly rejected.');

    console.log('\n================================================');
    console.log('🎉 ALL BACKEND BUSINESS RULE TESTS PASSED SUCCESSFULLY 🎉');
    console.log('================================================\n');

  } catch (error) {
    console.error('\n❌ TEST SUITE FAILED:', error);
    process.exitCode = 1;
  } finally {
    // Teardown
    if (server) server.close();
    await mongoose.disconnect();
    process.exit();
  }
}

runTests();

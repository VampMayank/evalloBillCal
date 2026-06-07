const mongoose = require('mongoose');

const lineItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  amount: { type: Number, required: true },
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' }
});

const invoiceSchema = new mongoose.Schema({
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  billingPeriodStart: { type: Date, required: true },
  billingPeriodEnd: { type: Date, required: true },
  lineItems: [lineItemSchema]
}, { timestamps: true });

module.exports = mongoose.model('Invoice', invoiceSchema);

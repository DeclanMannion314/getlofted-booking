require('dotenv').config();
const express = require('express');
const path = require('path');
const nodemailer = require('nodemailer');
const { MongoClient } = require('mongodb');

const app = express();
const PORT = process.env.PORT || 3000;

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'changeme';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- MongoDB setup ---
const client = new MongoClient(process.env.MONGODB_URI);
let jobsCollection;

async function connectDB() {
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'getlofted-bookings');
  jobsCollection = db.collection('jobs');
  console.log('Connected to MongoDB');
}

// --- Email setup ---
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

function sendJobEmail(job) {
  const notifyEmail = process.env.NOTIFY_EMAIL;

  if (!notifyEmail) {
    console.log('NOTIFY_EMAIL not set, skipping email (job was still saved).');
    return;
  }

  const mailOptions = {
    from: process.env.SMTP_USER || 'noreply@example.com',
    to: notifyEmail,
    subject: `New job request: ${job.typeOfWork} - ${job.name}`,
    text:
      `New job request submitted\n\n` +
      `Name: ${job.name}\n` +
      `Phone: ${job.phone}\n` +
      `Address: ${job.address}\n` +
      `Type of work: ${job.typeOfWork}\n` +
      `Urgency: ${job.urgency}\n` +
      `Preferred date: ${job.preferredDate || 'Not specified'}\n\n` +
      `Job description:\n${job.description}\n`
  };

  transporter.sendMail(mailOptions).catch((err) => {
    console.error('Email failed to send (job was still saved):', err.message);
  });
}

// --- Routes ---

app.post('/api/jobs', async (req, res) => {
  const { name, phone, address, typeOfWork, description, urgency, preferredDate } = req.body;

  if (!name || !phone || !address || !typeOfWork || !description || !urgency) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const job = {
    id: Date.now().toString(),
    name,
    phone,
    address,
    typeOfWork,
    description,
    urgency,
    preferredDate: preferredDate || '',
    status: 'new',
    scheduledDate: '',
    createdAt: new Date().toISOString()
  };

  await jobsCollection.insertOne(job);

  sendJobEmail(job);

  res.status(201).json({ success: true, job });
});

function requireDashboardAuth(req, res, next) {
  const password = req.headers['x-dashboard-password'] || req.query.password;
  if (password !== DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

app.get('/api/jobs', requireDashboardAuth, async (req, res) => {
  const jobs = await jobsCollection.find({}).project({ _id: 0 }).toArray();
  res.json(jobs);
});

app.patch('/api/jobs/:id', requireDashboardAuth, async (req, res) => {
  const { status, scheduledDate } = req.body;
  const validStatuses = ['new', 'contacted', 'scheduled', 'done'];

  const updates = {};

  if (status !== undefined) {
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status.' });
    }
    updates.status = status;
  }

  if (scheduledDate !== undefined) {
    updates.scheduledDate = scheduledDate;
  }

  const result = await jobsCollection.findOneAndUpdate(
    { id: req.params.id },
    { $set: updates },
    { returnDocument: 'after' }
  );

  if (!result) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  res.json({ success: true, job: result });
});

app.delete('/api/jobs/:id', requireDashboardAuth, async (req, res) => {
  const result = await jobsCollection.deleteOne({ id: req.params.id });

  if (result.deletedCount === 0) {
    return res.status(404).json({ error: 'Job not found.' });
  }

  res.json({ success: true });
});

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Booking app running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to connect to MongoDB:', err);
});
const os = require('os');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const cfg = require('./config');

exports.createApp = (name, { json = true, db = true } = {}) => {
  const app = express();
  app.disable('x-powered-by');
  // Only trust X-Forwarded-For from our own private network (Nginx, gateways), so clients cannot spoof their IP.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.use(helmet());
  app.use(morgan(`[${name}] :method :url :status :response-time ms`));
  if (json) app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => { res.set('X-Served-By', process.env.INSTANCE_ID || os.hostname()); next(); });
  app.get('/health', (req, res) => {
    const body = { service: name, status: 'ok', instance: process.env.INSTANCE_ID || os.hostname() };
    if (db) { body.db = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'; if (!body.db.startsWith('c')) body.status = 'degraded'; }
    res.status(body.status === 'ok' ? 200 : 503).json(body);
  });
  return app;
};

exports.finish = app => {
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((err, req, res, next) => { // eslint-disable-line
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Validation failed', details: err.issues.map(i => ({ field: i.path.join('.'), message: i.message })) });
    if (err.name === 'CastError') return res.status(400).json({ error: 'Invalid id' });
    if (err.code === 11000) return res.status(409).json({ error: 'Already exists' });
    const s = err.status || 500;
    if (s >= 500) console.error(err);
    res.status(s).json({ error: s >= 500 && s !== 502 ? 'Internal server error' : err.message });
  });
};

async function connect() {
  for (let i = 1; i <= 15; i++) {
    try {
      await mongoose.connect(cfg.mongo, { dbName: cfg.db, serverSelectionTimeoutMS: 4000 });
      console.log(`MongoDB connected (${cfg.db})`);
      return;
    } catch (e) { console.log(`MongoDB not ready, retry ${i}/15: ${e.message}`); await new Promise(r => setTimeout(r, 3000)); }
  }
  console.error('MongoDB unreachable, exiting'); process.exit(1);
}

exports.start = async (app, name, onReady) => {
  await connect();
  if (onReady) await onReady();
  const server = app.listen(cfg.port, () => console.log(`${name} listening on ${cfg.port}`));
  const stop = () => server.close(() => mongoose.disconnect().then(() => process.exit(0)));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
};

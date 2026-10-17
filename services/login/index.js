const cfg = require('../../common/config');
cfg.need('INTERNAL_KEY', 'MONGO_URL', 'JWT_SECRET');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { createApp, finish, start } = require('../../common/app');
const { trustGateway, internal } = require('../../common/auth');
const { call } = require('../../common/http');
const { wrap, httpError, oid } = require('../../common/util');

const audit = new mongoose.Schema({ email: String, userId: String, success: Boolean, ip: String }, { timestamps: true });
audit.index({ email: 1, createdAt: -1 });
audit.index({ userId: 1, createdAt: -1 });
const Audit = mongoose.model('LoginAudit', audit);

const app = createApp('login-service');
app.use(trustGateway);

app.post('/login', wrap(async (req, res) => {
  const { email, password } = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(72) }).parse(req.body);
  const fails = await Audit.countDocuments({ email, success: false, createdAt: { $gt: new Date(Date.now() - 15 * 60 * 1000) } });
  if (fails >= 5) throw httpError(429, 'Too many failed attempts. Try again in 15 minutes.');
  let user;
  try { user = await call(cfg.urls.registration, '/internal/verify', { method: 'POST', body: { email, password } }); }
  catch (e) {
    if (e.status === 401) { await Audit.create({ email, success: false, ip: req.ip }); throw httpError(401, 'Invalid email or password'); }
    throw e;
  }
  await Audit.create({ email, userId: user.id, success: true, ip: req.ip });
  const token = jwt.sign({ role: user.role, name: user.name }, cfg.jwtSecret, { algorithm: 'HS256', issuer: 'tutorpulse', subject: user.id, expiresIn: cfg.jwtExpires });
  res.json({ token, tokenType: 'Bearer', expiresIn: cfg.jwtExpires, user });
}));
app.get('/me', wrap(async (req, res) => {
  if (!req.user) throw httpError(401, 'Authentication required');
  res.json({ id: req.user.id, role: req.user.role, name: decodeURIComponent(req.user.name || '') });
}));
app.get('/history', wrap(async (req, res) => {
  if (!req.user) throw httpError(401, 'Authentication required');
  const items = await Audit.find({ userId: req.user.id }).sort('-createdAt').limit(20).select('success ip createdAt').lean();
  res.json(items.map(a => ({ id: String(a._id), success: a.success, ip: a.ip, createdAt: a.createdAt })));
}));
// Delete one login record, or clear the whole history. Failed attempts stay (they drive the lockout).
app.delete('/history/:id', wrap(async (req, res) => {
  if (!req.user) throw httpError(401, 'Authentication required');
  const r = await Audit.deleteOne({ _id: oid(req.params.id), userId: req.user.id });
  if (!r.deletedCount) throw httpError(404, 'Login record not found');
  res.status(204).end();
}));
app.delete('/history', wrap(async (req, res) => {
  if (!req.user) throw httpError(401, 'Authentication required');
  const r = await Audit.deleteMany({ userId: req.user.id });
  res.json({ deleted: r.deletedCount });
}));
app.delete('/internal/users/:id', internal, wrap(async (req, res) => {
  const r = await Audit.deleteMany({ userId: req.params.id }); res.json({ deleted: r.deletedCount });
}));
finish(app);
start(app, 'login-service');

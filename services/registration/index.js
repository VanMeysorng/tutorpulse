const cfg = require('../../common/config');
cfg.need('INTERNAL_KEY', 'MONGO_URL');
const { z } = require('zod');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { createApp, finish, start } = require('../../common/app');
const { trustGateway, role, internal } = require('../../common/auth');
const { wrap, httpError, oid } = require('../../common/util');
const { cascade } = require('../../common/clients');

const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'teacher', 'student'], default: 'student' },
}, { timestamps: true }));
const pub = u => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, createdAt: u.createdAt });
const DUMMY = bcrypt.hashSync('timing-equalizer-1', 10);
const Reg = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(120),
  password: z.string().min(8).max(72).regex(/[A-Za-z]/, 'must contain a letter').regex(/\d/, 'must contain a number'),
  role: z.enum(['teacher', 'student']), // admins are never self-registered
});
const Password = Reg.shape.password;
const SelfUpdate = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  currentPassword: z.string().max(72).optional(),
  newPassword: Password.optional(),
}).strict().refine(b => b.name || b.newPassword, 'Nothing to update (send name and/or newPassword)')
  .refine(b => !b.newPassword || b.currentPassword, { message: 'currentPassword is required to set a new password', path: ['currentPassword'] });
const AdminUpdate = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(120),
  role: z.enum(['admin', 'teacher', 'student']),
}).partial().strict().refine(b => Object.keys(b).length > 0, 'Nothing to update');

const app = createApp('registration-service');
app.use(trustGateway);

app.post('/register', wrap(async (req, res) => {
  const b = Reg.parse(req.body);
  const u = await User.create({ name: b.name, email: b.email, role: b.role, passwordHash: await bcrypt.hash(b.password, 10) });
  res.status(201).json(pub(u));
}));

app.post('/internal/verify', internal, wrap(async (req, res) => {
  const { email, password } = z.object({ email: z.string(), password: z.string() }).parse(req.body);
  const u = await User.findOne({ email: email.toLowerCase().trim() });
  const ok = await bcrypt.compare(password, u ? u.passwordHash : DUMMY);
  if (!u || !ok) throw httpError(401, 'Invalid credentials');
  res.json(pub(u));
}));

app.post('/internal/lookup', internal, wrap(async (req, res) => {
  const { ids } = z.object({ ids: z.array(z.string()).max(200) }).parse(req.body);
  const us = await User.find({ _id: { $in: ids.filter(i => mongoose.isValidObjectId(i)) } }).select('name');
  res.json(Object.fromEntries(us.map(u => [String(u._id), u.name])));
}));

// ---- Self-service profile (any logged-in role) ----
app.get('/users/me', role('admin', 'teacher', 'student'), wrap(async (req, res) => {
  const u = await User.findById(oid(req.user.id)); if (!u) throw httpError(404, 'User not found'); res.json(pub(u));
}));
app.put('/users/me', role('admin', 'teacher', 'student'), wrap(async (req, res) => {
  const b = SelfUpdate.parse(req.body);
  const u = await User.findById(oid(req.user.id)); if (!u) throw httpError(404, 'User not found');
  if (b.newPassword) {
    if (!(await bcrypt.compare(b.currentPassword, u.passwordHash))) throw httpError(401, 'Current password is incorrect');
    u.passwordHash = await bcrypt.hash(b.newPassword, 10);
  }
  if (b.name) u.name = b.name;
  res.json(pub(await u.save()));
}));

// ---- Admin user management (full CRUD) ----
app.post('/users', role('admin'), wrap(async (req, res) => {
  const b = Reg.extend({ role: z.enum(['admin', 'teacher', 'student']) }).parse(req.body);
  const u = await User.create({ name: b.name, email: b.email, role: b.role, passwordHash: await bcrypt.hash(b.password, 10) });
  res.status(201).json(pub(u));
}));
app.get('/users', role('admin'), wrap(async (req, res) => {
  const page = Math.max(1, +req.query.page || 1), limit = Math.min(50, Math.max(1, +req.query.limit || 20));
  const q = ['admin', 'teacher', 'student'].includes(req.query.role) ? { role: req.query.role } : {};
  if (typeof req.query.search === 'string' && req.query.search.trim()) {
    const rx = new RegExp(req.query.search.trim().slice(0, 50).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    q.$or = [{ name: rx }, { email: rx }];
  }
  const [items, total] = await Promise.all([User.find(q).sort('-createdAt').skip((page - 1) * limit).limit(limit), User.countDocuments(q)]);
  res.json({ page, limit, total, items: items.map(pub) });
}));
app.get('/users/:id', role('admin'), wrap(async (req, res) => {
  const u = await User.findById(oid(req.params.id)); if (!u) throw httpError(404, 'User not found'); res.json(pub(u));
}));
app.put('/users/:id', role('admin'), wrap(async (req, res) => {
  const b = AdminUpdate.parse(req.body);
  if (req.params.id === req.user.id && b.role && b.role !== 'admin') throw httpError(400, 'You cannot remove your own admin role');
  const u = await User.findByIdAndUpdate(oid(req.params.id), b, { new: true, runValidators: true }); if (!u) throw httpError(404, 'User not found'); res.json(pub(u));
}));
app.patch('/users/:id/role', role('admin'), wrap(async (req, res) => {
  const { role: r } = z.object({ role: z.enum(['admin', 'teacher', 'student']) }).parse(req.body);
  if (req.params.id === req.user.id && r !== 'admin') throw httpError(400, 'You cannot remove your own admin role');
  const u = await User.findByIdAndUpdate(oid(req.params.id), { role: r }, { new: true }); if (!u) throw httpError(404, 'User not found'); res.json(pub(u));
}));
app.delete('/users/:id', role('admin'), wrap(async (req, res) => {
  if (req.params.id === req.user.id) throw httpError(400, 'You cannot delete yourself');
  const u = await User.findByIdAndDelete(oid(req.params.id)); if (!u) throw httpError(404, 'User not found');
  // Remove the user's data in the other services (classes they own, memberships, attempts, events, login history).
  const cleanup = await cascade(['classes', 'practice', 'analytics', 'login'], `/internal/users/${u.id}`);
  res.json({ deleted: pub(u), cleanup });
}));
finish(app);

start(app, 'registration-service', async () => {
  await User.init();
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const email = ADMIN_EMAIL.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
    await User.findOneAndUpdate(
      { email },
      { name: 'Administrator', email, role: 'admin', passwordHash },
      { upsert: true, new: true }
    );
    console.log(`Seeded/Updated admin account: ${email}`);
  }
});

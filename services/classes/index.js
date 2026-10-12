const cfg = require('../../common/config');
cfg.need('INTERNAL_KEY', 'MONGO_URL');
const crypto = require('crypto');
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish, start } = require('../../common/app');
const { trustGateway, role, internal } = require('../../common/auth');
const { wrap, httpError, oid, cleanJson } = require('../../common/util');
const { names } = require('../../common/clients');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  code: { type: String, required: true, unique: true },
  teacherId: { type: String, required: true, index: true },
  studentIds: { type: [String], index: true, default: [] },
}, { timestamps: true });
cleanJson(schema);
const Class = mongoose.model('Class', schema);
const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 6 }, () => A[crypto.randomInt(A.length)]).join('');
async function uniqueCode() { for (let i = 0; i < 8; i++) { const c = genCode(); if (!(await Class.exists({ code: c }))) return c; } throw httpError(500, 'Could not allocate code'); }
const Name = z.object({ name: z.string().trim().min(2).max(100) });

const app = createApp('class-service');
app.use(trustGateway);

async function mine(req, id, { ownerOnly = false } = {}) {
  const c = await Class.findById(oid(id)); if (!c) throw httpError(404, 'Class not found');
  const owner = c.teacherId === req.user.id, member = c.studentIds.includes(req.user.id);
  if (!(req.user.role === 'admin' && !ownerOnly) && !(ownerOnly ? owner : owner || member)) throw httpError(403, 'You do not have access to this class');
  return c;
}
app.post('/classes', role('teacher'), wrap(async (req, res) => {
  const { name } = Name.parse(req.body);
  res.status(201).json(await Class.create({ name, code: await uniqueCode(), teacherId: req.user.id }));
}));
app.get('/classes', role('teacher', 'student', 'admin'), wrap(async (req, res) => {
  const q = req.user.role === 'teacher' ? { teacherId: req.user.id } : req.user.role === 'student' ? { studentIds: req.user.id } : {};
  const items = await Class.find(q).sort('-createdAt');
  res.json(req.user.role === 'student' ? items.map(c => ({ id: c.id, name: c.name, teacherId: c.teacherId })) : items);
}));
app.post('/classes/join', role('student'), wrap(async (req, res) => {
  const { code } = z.object({ code: z.string().trim().toUpperCase().length(6) }).parse(req.body);
  const c = await Class.findOneAndUpdate({ code }, { $addToSet: { studentIds: req.user.id } }, { new: true });
  if (!c) throw httpError(404, 'No class with that code');
  res.json({ id: c.id, name: c.name });
}));
app.get('/classes/:id', wrap(async (req, res) => {
  const c = await mine(req, req.params.id);
  res.json(req.user.role === 'student' ? { id: c.id, name: c.name, teacherId: c.teacherId } : c);
}));
app.put('/classes/:id', role('teacher'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id, { ownerOnly: true }); c.name = Name.parse(req.body).name; res.json(await c.save());
}));
app.post('/classes/:id/regenerate-code', role('teacher'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id, { ownerOnly: true }); c.code = await uniqueCode(); res.json(await c.save());
}));
app.get('/classes/:id/students', role('teacher'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id, { ownerOnly: true }); const n = await names(c.studentIds);
  res.json({ count: c.studentIds.length, studentIds: c.studentIds, students: c.studentIds.map(id => ({ id, name: n[id] || 'Student ' + id.slice(-4) })) });
}));
app.delete('/classes/:id', role('teacher'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id, { ownerOnly: true }); await c.deleteOne(); res.status(204).end();
}));
app.get('/internal/classes/:id', internal, wrap(async (req, res) => {
  const c = await Class.findById(oid(req.params.id)).lean(); if (!c) throw httpError(404, 'Class not found');
  res.json({ id: String(c._id), name: c.name, teacherId: c.teacherId, studentIds: c.studentIds });
}));
finish(app);
start(app, 'class-service', () => Class.init());

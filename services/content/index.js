const cfg = require('../../common/config');
cfg.need('INTERNAL_KEY', 'MONGO_URL');
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish, start } = require('../../common/app');
const { trustGateway, role, internal } = require('../../common/auth');
const { requireClassAccess } = require('../../common/clients');
const { wrap, httpError, oid, cleanJson } = require('../../common/util');
const { generate, Question } = require('./generate');

const schema = new mongoose.Schema({
  classId: { type: String, required: true, index: true },
  teacherId: { type: String, required: true },
  title: { type: String, required: true, maxlength: 120 },
  notes: { type: String, default: '', maxlength: 20000 },
  cheat: { type: [String], default: [] },
  questions: { type: [mongoose.Schema.Types.Mixed], default: [] },
  published: { type: Boolean, default: false },
  source: { type: String, default: 'manual' },
}, { timestamps: true });
cleanJson(schema);
const PracticeSet = mongoose.model('PracticeSet', schema);

// Students never receive answers or clues; those stay server-side.
const forStudent = s => ({ id: s.id, classId: s.classId, title: s.title, cheat: s.cheat, updatedAt: s.updatedAt,
  questions: s.questions.map(q => ({ type: q.type, q: q.q, options: q.options, concept: q.concept })) });

const app = createApp('content-service');
app.use(trustGateway);

async function ownSet(req, id) {
  const s = await PracticeSet.findById(oid(id)); if (!s) throw httpError(404, 'Set not found');
  await requireClassAccess(s.classId, req.user, { ownerOnly: true }); return s;
}
app.post('/content/classes/:classId/sets', role('teacher'), wrap(async (req, res) => {
  await requireClassAccess(req.params.classId, req.user, { ownerOnly: true });
  const b = z.object({ title: z.string().trim().min(2).max(120), notes: z.string().max(20000).default(''), generate: z.boolean().default(true) }).parse(req.body);
  let gen = { cheat: [], questions: [], source: 'manual' };
  if (b.generate && b.notes.trim().length >= 30) gen = await generate(b.notes);
  res.status(201).json(await PracticeSet.create({ classId: req.params.classId, teacherId: req.user.id, title: b.title, notes: b.notes, ...gen }));
}));
app.get('/content/classes/:classId/sets', role('teacher', 'student'), wrap(async (req, res) => {
  const teacher = req.user.role === 'teacher';
  await requireClassAccess(req.params.classId, req.user, { ownerOnly: teacher });
  const items = await PracticeSet.find({ classId: req.params.classId, ...(teacher ? {} : { published: true }) }).sort('-createdAt');
  res.json(teacher ? items : items.map(forStudent));
}));
app.get('/content/sets/:id', role('teacher', 'student'), wrap(async (req, res) => {
  const s = await PracticeSet.findById(oid(req.params.id)); if (!s) throw httpError(404, 'Set not found');
  if (req.user.role === 'teacher') { await requireClassAccess(s.classId, req.user, { ownerOnly: true }); return res.json(s); }
  if (!s.published) throw httpError(404, 'Set not found');
  await requireClassAccess(s.classId, req.user); res.json(forStudent(s));
}));
app.put('/content/sets/:id', role('teacher'), wrap(async (req, res) => {
  const s = await ownSet(req, req.params.id);
  const b = z.object({ title: z.string().trim().min(2).max(120), notes: z.string().max(20000), cheat: z.array(z.string().max(200)).max(8), questions: z.array(Question).max(5) }).partial().parse(req.body);
  Object.assign(s, b); if (b.questions) s.source = s.source === 'ai' ? 'ai-edited' : 'manual';
  if (s.published && s.questions.length === 0) throw httpError(400, 'A published set needs at least one question');
  res.json(await s.save());
}));
app.post('/content/sets/:id/regenerate', role('teacher'), wrap(async (req, res) => {
  const s = await ownSet(req, req.params.id);
  if (s.notes.trim().length < 30) throw httpError(400, 'Add lesson notes first');
  Object.assign(s, await generate(s.notes)); res.json(await s.save());
}));
app.post('/content/sets/:id/publish', role('teacher'), wrap(async (req, res) => {
  const s = await ownSet(req, req.params.id);
  const { published } = z.object({ published: z.boolean() }).parse(req.body);
  if (published && s.questions.length === 0) throw httpError(400, 'Add at least one question before publishing');
  s.published = published; res.json(await s.save());
}));
app.delete('/content/sets/:id', role('teacher'), wrap(async (req, res) => { const s = await ownSet(req, req.params.id); await s.deleteOne(); res.status(204).end(); }));
app.get('/internal/sets/:id', internal, wrap(async (req, res) => {
  const s = await PracticeSet.findById(oid(req.params.id)); if (!s) throw httpError(404, 'Set not found'); res.json(s);
}));
finish(app);
start(app, 'content-service');

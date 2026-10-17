const cfg = require('../../common/config');
cfg.need('INTERNAL_KEY', 'MONGO_URL');
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish, start } = require('../../common/app');
const { trustGateway, role, internal } = require('../../common/auth');
const { requireClassAccess, names } = require('../../common/clients');
const { wrap, oid, httpError, cleanJson } = require('../../common/util');

const schema = new mongoose.Schema({
  classId: { type: String, required: true }, setId: { type: String, required: true }, studentId: { type: String, required: true },
  qIndex: Number, concept: String, type: { type: String, enum: ['attempt', 'clue'] }, correct: Boolean,
}, { timestamps: true });
schema.index({ classId: 1, setId: 1, qIndex: 1 });
schema.index({ studentId: 1 });
const Event = mongoose.model('Event', schema);

// Interventions: the teacher's action plan for a weak concept found by the Gap Radar (full CRUD).
const iv = new mongoose.Schema({
  classId: { type: String, required: true, index: true },
  teacherId: { type: String, required: true },
  concept: { type: String, required: true, trim: true, maxlength: 80 },
  setId: { type: String, default: null },
  action: { type: String, required: true, trim: true, maxlength: 1000 },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  status: { type: String, enum: ['open', 'in_progress', 'done'], default: 'open' },
  dueDate: { type: String, default: '' },
  outcome: { type: String, default: '', maxlength: 1000 },
  snapshot: { attempts: Number, wrongRate: Number, avgClues: Number, flag: String },
}, { timestamps: true });
cleanJson(iv);
const Intervention = mongoose.model('Intervention', iv);
const IvBody = z.object({
  concept: z.string().trim().min(1).max(80),
  setId: z.string().refine(v => mongoose.isValidObjectId(v), 'invalid id').nullable(),
  action: z.string().trim().min(3).max(1000),
  priority: z.enum(['low', 'medium', 'high']),
  status: z.enum(['open', 'in_progress', 'done']),
  dueDate: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'use YYYY-MM-DD'),
  outcome: z.string().trim().max(1000),
});

const app = createApp('analytics-service');
app.use(trustGateway);

// Telemetry stream from the practice service.
app.post('/internal/events', internal, wrap(async (req, res) => {
  const e = z.object({ classId: z.string(), setId: z.string(), studentId: z.string(), qIndex: z.number().int().min(0), concept: z.string().max(80).optional(),
    type: z.enum(['attempt', 'clue']), correct: z.boolean().optional() }).parse(req.body);
  await Event.create(e); res.status(201).json({ ok: true });
}));
// Cleanup when a class, set or user is deleted elsewhere.
const purge = field => wrap(async (req, res) => {
  const r = await Event.deleteMany({ [field]: req.params.id });
  const i = field === 'classId' ? await Intervention.deleteMany({ classId: req.params.id }) : { deletedCount: 0 };
  res.json({ deleted: r.deletedCount + i.deletedCount });
});
app.delete('/internal/classes/:id', internal, purge('classId'));
app.delete('/internal/sets/:id', internal, purge('setId'));
app.delete('/internal/users/:id', internal, purge('studentId'));

const status = (attempts, rate, avgClues) => !attempts ? 'ok' : rate >= .5 || avgClues >= 1.5 ? 'flagged' : rate >= .3 || avgClues >= 1 ? 'watch' : 'ok';
const A = { $cond: [{ $eq: ['$type', 'attempt'] }, 1, 0] };
const W = { $cond: [{ $and: [{ $eq: ['$type', 'attempt'] }, { $eq: ['$correct', false] }] }, 1, 0] };
const C = { $cond: [{ $eq: ['$type', 'clue'] }, 1, 0] };
const match = req => ({ classId: oid(req.params.classId), ...(req.query.setId ? { setId: oid(req.query.setId) } : {}) });
const guard = wrap(async (req, res, next) => { await requireClassAccess(req.params.classId, req.user); next(); });
const ownerGuard = wrap(async (req, res, next) => { await requireClassAccess(req.params.classId, req.user, { ownerOnly: true }); next(); });
const T = role('teacher', 'admin');

app.get('/analytics/classes/:classId/radar', T, guard, wrap(async (req, res) => {
  const rows = await Event.aggregate([{ $match: match(req) }, { $group: { _id: { set: '$setId', q: '$qIndex' }, concept: { $first: '$concept' },
    attempts: { $sum: A }, wrong: { $sum: W }, clues: { $sum: C }, students: { $addToSet: '$studentId' } } }, { $sort: { '_id.set': 1, '_id.q': 1 } }]);
  res.json(rows.map(r => { const rate = r.attempts ? r.wrong / r.attempts : 0, avg = r.clues / r.students.length;
    return { setId: r._id.set, qIndex: r._id.q, concept: r.concept, attempts: r.attempts, wrong: r.wrong, wrongRate: +rate.toFixed(2), clues: r.clues, students: r.students.length, avgClues: +avg.toFixed(2), status: status(r.attempts, rate, avg) }; }));
}));
app.get('/analytics/classes/:classId/students', T, guard, wrap(async (req, res) => {
  const rows = await Event.aggregate([{ $match: match(req) }, { $group: { _id: '$studentId', attempts: { $sum: A }, wrong: { $sum: W }, clues: { $sum: C },
    solved: { $addToSet: { $cond: [{ $eq: ['$correct', true] }, { s: '$setId', q: '$qIndex' }, null] } }, last: { $max: '$createdAt' } } }, { $sort: { last: -1 } }]);
  const n = await names(rows.map(r => r._id));
  res.json(rows.map(r => ({ studentId: r._id, name: n[r._id] || 'Student ' + String(r._id).slice(-4), attempts: r.attempts, correct: r.attempts - r.wrong, clues: r.clues, solvedQuestions: r.solved.filter(x => x !== null).length, lastActive: r.last })));
}));
app.get('/analytics/classes/:classId/matrix', T, guard, wrap(async (req, res) => {
  const rows = await Event.aggregate([{ $match: match(req) }, { $group: { _id: { s: '$studentId', set: '$setId', q: '$qIndex' }, attempts: { $sum: A }, wrong: { $sum: W }, clues: { $sum: C }, solved: { $max: { $cond: [{ $eq: ['$correct', true] }, 1, 0] } } } }]);
  res.json(rows.map(r => ({ studentId: r._id.s, setId: r._id.set, qIndex: r._id.q, attempts: r.attempts, wrong: r.wrong, clues: r.clues, solved: !!r.solved })));
}));
app.get('/analytics/classes/:classId/concepts', T, guard, wrap(async (req, res) => {
  const rows = await Event.aggregate([{ $match: match(req) }, { $group: { _id: '$concept', attempts: { $sum: A }, wrong: { $sum: W }, clues: { $sum: C }, students: { $addToSet: '$studentId' } } }, { $sort: { wrong: -1 } }]);
  res.json(rows.map(r => { const rate = r.attempts ? r.wrong / r.attempts : 0, avg = r.clues / r.students.length;
    return { concept: r._id, attempts: r.attempts, wrongRate: +rate.toFixed(2), avgClues: +avg.toFixed(2), status: status(r.attempts, rate, avg) }; }));
}));
app.get('/analytics/classes/:classId/export.csv', T, guard, wrap(async (req, res) => {
  const rows = await Event.find(match(req)).sort('createdAt').limit(50000).lean();
  const n = await names(rows.map(r => r.studentId));
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.type('text/csv').attachment(`class-${req.params.classId}.csv`)
    .send(['student,set,question,concept,type,correct,time', ...rows.map(r => [n[r.studentId] || r.studentId, r.setId, 'Q' + (r.qIndex + 1), r.concept, r.type, r.correct ?? '', r.createdAt.toISOString()].map(esc).join(','))].join('\n'));
}));
app.get('/analytics/classes/:classId/ranking', guard, wrap(async (req, res) => {
  const rows = await Event.aggregate([
    { $match: match(req) },
    { $group: {
      _id: '$studentId',
      attempts: { $sum: A },
      wrong: { $sum: W },
      clues: { $sum: C },
      solved: { $addToSet: { $cond: [{ $eq: ['$correct', true] }, { s: '$setId', q: '$qIndex' }, null] } }
    } }
  ]);
  const n = await names(rows.map(r => r._id));
  const mapped = rows.map(r => {
    const solvedCount = r.solved.filter(x => x !== null).length;
    const accuracy = r.attempts ? Math.round(((r.attempts - r.wrong) / r.attempts) * 100) : 0;
    const score = (solvedCount * 100) + accuracy - (r.clues * 5);
    return {
      studentId: r._id,
      name: n[r._id] || 'Student ' + String(r._id).slice(-4),
      solved: solvedCount,
      attempts: r.attempts,
      accuracy,
      clues: r.clues,
      score: Math.max(0, score)
    };
  });
  mapped.sort((a, b) => b.score - a.score || b.solved - a.solved || b.accuracy - a.accuracy);
  mapped.forEach((item, idx) => { item.rank = idx + 1; });
  res.json(mapped);
}));

// ---- Interventions CRUD (teacher owns the class; admin can read) ----
const ivFind = async (req) => {
  const d = await Intervention.findOne({ _id: oid(req.params.id), classId: req.params.classId });
  if (!d) throw httpError(404, 'Intervention not found'); return d;
};
async function snapshotFor(classId, concept, setId) {
  const m = { classId, concept, ...(setId ? { setId } : {}) };
  const [r] = await Event.aggregate([{ $match: m }, { $group: { _id: null, attempts: { $sum: A }, wrong: { $sum: W }, clues: { $sum: C }, students: { $addToSet: '$studentId' } } }]);
  if (!r) return { attempts: 0, wrongRate: 0, avgClues: 0, flag: 'ok' };
  const rate = r.attempts ? r.wrong / r.attempts : 0, avg = r.clues / r.students.length;
  return { attempts: r.attempts, wrongRate: +rate.toFixed(2), avgClues: +avg.toFixed(2), flag: status(r.attempts, rate, avg) };
}
app.post('/analytics/classes/:classId/interventions', role('teacher'), ownerGuard, wrap(async (req, res) => {
  const b = IvBody.partial({ setId: true, priority: true, status: true, dueDate: true, outcome: true }).parse(req.body);
  const snapshot = await snapshotFor(oid(req.params.classId), b.concept, b.setId);
  res.status(201).json(await Intervention.create({ ...b, classId: req.params.classId, teacherId: req.user.id, snapshot }));
}));
app.get('/analytics/classes/:classId/interventions', T, guard, wrap(async (req, res) => {
  const q = { classId: oid(req.params.classId) };
  if (['open', 'in_progress', 'done'].includes(req.query.status)) q.status = req.query.status;
  if (['low', 'medium', 'high'].includes(req.query.priority)) q.priority = req.query.priority;
  res.json(await Intervention.find(q).sort('-createdAt'));
}));
app.get('/analytics/classes/:classId/interventions/:id', T, guard, wrap(async (req, res) => res.json(await ivFind(req))));
app.put('/analytics/classes/:classId/interventions/:id', role('teacher'), ownerGuard, wrap(async (req, res) => {
  const b = IvBody.partial().strict().refine(x => Object.keys(x).length > 0, 'Nothing to update').parse(req.body);
  const d = await ivFind(req); Object.assign(d, b);
  if (b.concept || b.setId !== undefined) d.snapshot = await snapshotFor(d.classId, d.concept, d.setId);
  res.json(await d.save());
}));
app.delete('/analytics/classes/:classId/interventions/:id', role('teacher'), ownerGuard, wrap(async (req, res) => {
  const d = await ivFind(req); await d.deleteOne(); res.status(204).end();
}));
finish(app);
start(app, 'analytics-service', () => Promise.all([Event.init(), Intervention.init()]));

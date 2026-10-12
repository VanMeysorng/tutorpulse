const cfg = require('../../common/config');
cfg.need('INTERNAL_KEY', 'MONGO_URL');
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish, start } = require('../../common/app');
const { trustGateway, role, internal } = require('../../common/auth');
const { requireClassAccess, names } = require('../../common/clients');
const { wrap, oid } = require('../../common/util');

const schema = new mongoose.Schema({
  classId: { type: String, required: true }, setId: { type: String, required: true }, studentId: { type: String, required: true },
  qIndex: Number, concept: String, type: { type: String, enum: ['attempt', 'clue'] }, correct: Boolean,
}, { timestamps: true });
schema.index({ classId: 1, setId: 1, qIndex: 1 });
const Event = mongoose.model('Event', schema);

const app = createApp('analytics-service');
app.use(trustGateway);

// Telemetry stream from the practice service.
app.post('/internal/events', internal, wrap(async (req, res) => {
  const e = z.object({ classId: z.string(), setId: z.string(), studentId: z.string(), qIndex: z.number().int().min(0), concept: z.string().max(80).optional(),
    type: z.enum(['attempt', 'clue']), correct: z.boolean().optional() }).parse(req.body);
  await Event.create(e); res.status(201).json({ ok: true });
}));

const status = (attempts, rate, avgClues) => !attempts ? 'ok' : rate >= .5 || avgClues >= 1.5 ? 'flagged' : rate >= .3 || avgClues >= 1 ? 'watch' : 'ok';
const A = { $cond: [{ $eq: ['$type', 'attempt'] }, 1, 0] };
const W = { $cond: [{ $and: [{ $eq: ['$type', 'attempt'] }, { $eq: ['$correct', false] }] }, 1, 0] };
const C = { $cond: [{ $eq: ['$type', 'clue'] }, 1, 0] };
const match = req => ({ classId: oid(req.params.classId), ...(req.query.setId ? { setId: oid(req.query.setId) } : {}) });
const guard = wrap(async (req, res, next) => { await requireClassAccess(req.params.classId, req.user); next(); });
const T = role('teacher', 'admin');

app.get('/analytics/classes/:classId/radar', T, guard, wrap(async (req, res) => {
  const rows = await Event.aggregate([{ $match: match(req) }, { $group: { _id: { set: '$setId', q: '$qIndex' }, concept: { $first: '$concept' },
    attempts: { $sum: A }, wrong: { $sum: W }, clues: { $sum: C }, students: { $addToSet: '$studentId' } } }, { $sort: { '_id.set': 1, '_id.q': 1 } }]);
  res.json(rows.map(r => { const rate = r.attempts ? r.wrong / r.attempts : 0, avg = r.clues / r.students.length;
    return { setId: r._id.set, qIndex: r._id.q, concept: r.concept, attempts: r.attempts, wrong: r.wrong, wrongRate: +rate.toFixed(2), clues: r.clues, students: r.students.length, avgClues: +avg.toFixed(2), status: status(r.attempts, rate, avg) }; }));
}));
app.get('/analytics/classes/:classId/students', T, guard, wrap(async (req, res) => {
  const rows = await Event.aggregate([{ $match: match(req) }, { $group: { _id: '$studentId', attempts: { $sum: A }, wrong: { $sum: W }, clues: { $sum: C },
    solved: { $addToSet: { $cond: [{ $eq: ['$correct', true] }, '$qIndex', null] } }, last: { $max: '$createdAt' } } }, { $sort: { last: -1 } }]);
  const n = await names(rows.map(r => r._id));
  res.json(rows.map(r => ({ studentId: r._id, name: n[r._id] || 'Student ' + String(r._id).slice(-4), attempts: r.attempts, correct: r.attempts - r.wrong, clues: r.clues, solvedQuestions: r.solved.filter(x => x !== null).length, lastActive: r.last })));
}));
app.get('/analytics/classes/:classId/matrix', T, guard, wrap(async (req, res) => {
  const rows = await Event.aggregate([{ $match: match(req) }, { $group: { _id: { s: '$studentId', q: '$qIndex' }, attempts: { $sum: A }, wrong: { $sum: W }, clues: { $sum: C }, solved: { $max: { $cond: [{ $eq: ['$correct', true] }, 1, 0] } } } }]);
  res.json(rows.map(r => ({ studentId: r._id.s, qIndex: r._id.q, attempts: r.attempts, wrong: r.wrong, clues: r.clues, solved: !!r.solved })));
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
finish(app);
start(app, 'analytics-service', () => Event.init());

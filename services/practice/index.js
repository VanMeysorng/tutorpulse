const cfg = require('../../common/config');
cfg.need('INTERNAL_KEY', 'MONGO_URL');
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish, start } = require('../../common/app');
const { trustGateway, role, internal } = require('../../common/auth');
const { call } = require('../../common/http');
const { getClass } = require('../../common/clients');
const { wrap, httpError, oid } = require('../../common/util');

const schema = new mongoose.Schema({
  studentId: { type: String, required: true }, classId: String, setId: { type: String, required: true },
  qIndex: { type: Number, required: true }, type: { type: String, enum: ['attempt', 'clue'], required: true },
  correct: Boolean, clueNo: Number, answer: String,
}, { timestamps: true });
schema.index({ studentId: 1, setId: 1, qIndex: 1 });
schema.index({ classId: 1 });
// A student can receive each clue number only once per question (also blocks races).
schema.index({ studentId: 1, setId: 1, qIndex: 1, clueNo: 1 }, { unique: true, partialFilterExpression: { type: 'clue' } });
const Attempt = mongoose.model('Attempt', schema);

const app = createApp('practice-service');
app.use(trustGateway);

// ---- Internal cleanup (called by class, content and registration services) ----
const purge = field => wrap(async (req, res) => { const r = await Attempt.deleteMany({ [field]: req.params.id }); res.json({ deleted: r.deletedCount }); });
app.delete('/internal/classes/:id', internal, purge('classId'));
app.delete('/internal/sets/:id', internal, purge('setId'));
app.delete('/internal/users/:id', internal, purge('studentId'));

// ---- Student API ----
const student = role('student');
async function load(setId, user) {
  const set = await call(cfg.urls.content, `/internal/sets/${oid(setId)}`);
  if (!set.published) throw httpError(404, 'Set not found');
  const c = await getClass(set.classId);
  if (!c.studentIds.includes(user.id)) throw httpError(403, 'You have not joined this class');
  return set;
}
const qAt = (set, i) => { const n = Number(i); const q = Number.isInteger(n) ? set.questions[n] : null; if (!q) throw httpError(404, 'Question not found'); return [q, n]; };
const emit = (set, studentId, q, n, extra) => call(cfg.urls.analytics, '/internal/events', { method: 'POST',
  body: { classId: set.classId, setId: set.id, studentId, qIndex: n, concept: q.concept, ...extra } }).catch(e => console.error('telemetry failed:', e.message));
async function progress(set, studentId) {
  const rows = await Attempt.find({ setId: set.id, studentId }).sort('createdAt').lean();
  return set.questions.map((q, i) => {
    const r = rows.filter(x => x.qIndex === i), used = r.filter(x => x.type === 'clue').length;
    return { qIndex: i, solved: r.some(x => x.correct), attempts: r.filter(x => x.type === 'attempt').length, cluesUsed: used, clues: q.clues.slice(0, used) };
  });
}
const pubAttempt = a => ({ id: String(a._id), qIndex: a.qIndex, type: a.type, answer: a.answer, correct: a.correct, clueNo: a.clueNo, createdAt: a.createdAt });

app.get('/practice/sets/:setId', student, wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user);
  res.json({ id: s.id, title: s.title, cheat: s.cheat,
    questions: s.questions.map(q => ({ type: q.type, q: q.q, options: q.options, concept: q.concept })), progress: await progress(s, req.user.id) });
}));
app.get('/practice/sets/:setId/progress', student, wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user); const p = await progress(s, req.user.id);
  res.json({ solved: p.filter(x => x.solved).length, total: p.length, questions: p });
}));
// Every attempt and clue the student made on this set (newest first).
app.get('/practice/sets/:setId/attempts', student, wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user);
  const rows = await Attempt.find({ setId: s.id, studentId: req.user.id }).sort('-createdAt').limit(500).lean();
  res.json({ count: rows.length, items: rows.map(pubAttempt) });
}));
app.post('/practice/sets/:setId/questions/:qi/clue', student, wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user); const [q, n] = qAt(s, req.params.qi);
  const key = { setId: s.id, studentId: req.user.id, qIndex: n };
  if (await Attempt.exists({ ...key, correct: true })) throw httpError(409, 'Question already solved');
  const used = await Attempt.countDocuments({ ...key, type: 'clue' });
  const max = Math.min(3, q.clues.length);
  if (used >= max) throw httpError(409, 'No clues left (maximum 3)');
  try { await Attempt.create({ ...key, classId: s.classId, type: 'clue', clueNo: used + 1 }); }
  catch (e) { if (e.code === 11000) throw httpError(409, 'Clue already issued, retry'); throw e; }
  emit(s, req.user.id, q, n, { type: 'clue' });
  res.json({ clueNo: used + 1, clue: q.clues[used], remaining: max - used - 1 });
}));
app.post('/practice/sets/:setId/questions/:qi/attempt', student, wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user); const [q, n] = qAt(s, req.params.qi);
  const { answer } = z.object({ answer: z.union([z.string(), z.number()]).transform(String) }).parse(req.body);
  const key = { setId: s.id, studentId: req.user.id, qIndex: n };
  if (await Attempt.exists({ ...key, correct: true })) throw httpError(409, 'Question already solved');
  const a = answer.trim();
  const correct = q.type === 'num' ? a !== '' && Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(q.answer)) <= 1e-6 * Math.max(1, Math.abs(Number(q.answer))) : a === q.answer;
  const doc = await Attempt.create({ ...key, classId: s.classId, type: 'attempt', correct, answer: a.slice(0, 200) });
  emit(s, req.user.id, q, n, { type: 'attempt', correct });
  res.status(201).json({ id: doc.id, correct });
}));
// Reset: the student wipes their attempts on one question, or on the whole set, and starts again.
// The teacher's analytics keep the full history.
app.delete('/practice/sets/:setId/questions/:qi/attempts', student, wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user); const [, n] = qAt(s, req.params.qi);
  const r = await Attempt.deleteMany({ setId: s.id, studentId: req.user.id, qIndex: n });
  res.json({ deleted: r.deletedCount, qIndex: n });
}));
app.delete('/practice/sets/:setId/progress', student, wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user);
  const r = await Attempt.deleteMany({ setId: s.id, studentId: req.user.id });
  res.json({ deleted: r.deletedCount });
}));
finish(app);
start(app, 'practice-service', () => Attempt.init());

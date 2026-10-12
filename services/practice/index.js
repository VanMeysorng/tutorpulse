const cfg = require('../../common/config');
cfg.need('INTERNAL_KEY', 'MONGO_URL');
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish, start } = require('../../common/app');
const { trustGateway, role } = require('../../common/auth');
const { call } = require('../../common/http');
const { getClass } = require('../../common/clients');
const { wrap, httpError, oid } = require('../../common/util');

const schema = new mongoose.Schema({
  studentId: { type: String, required: true }, classId: String, setId: { type: String, required: true },
  qIndex: { type: Number, required: true }, type: { type: String, enum: ['attempt', 'clue'], required: true },
  correct: Boolean, clueNo: Number, answer: String,
}, { timestamps: true });
schema.index({ studentId: 1, setId: 1, qIndex: 1 });
// A student can receive each clue number only once per question (also blocks races).
schema.index({ studentId: 1, setId: 1, qIndex: 1, clueNo: 1 }, { unique: true, partialFilterExpression: { type: 'clue' } });
const Attempt = mongoose.model('Attempt', schema);

const app = createApp('practice-service');
app.use(trustGateway, role('student'));

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

app.get('/practice/sets/:setId', wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user);
  res.json({ id: s.id, title: s.title, cheat: s.cheat,
    questions: s.questions.map(q => ({ type: q.type, q: q.q, options: q.options, concept: q.concept })), progress: await progress(s, req.user.id) });
}));
app.get('/practice/sets/:setId/progress', wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user); const p = await progress(s, req.user.id);
  res.json({ solved: p.filter(x => x.solved).length, total: p.length, questions: p });
}));
app.post('/practice/sets/:setId/questions/:qi/clue', wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user); const [q, n] = qAt(s, req.params.qi);
  const key = { setId: s.id, studentId: req.user.id, qIndex: n };
  if (await Attempt.exists({ ...key, correct: true })) throw httpError(409, 'Question already solved');
  const used = await Attempt.countDocuments({ ...key, type: 'clue' });
  if (used >= Math.min(3, q.clues.length)) throw httpError(409, 'No clues left (maximum 3)');
  try { await Attempt.create({ ...key, classId: s.classId, type: 'clue', clueNo: used + 1 }); }
  catch (e) { if (e.code === 11000) throw httpError(409, 'Clue already issued, retry'); throw e; }
  emit(s, req.user.id, q, n, { type: 'clue' });
  res.json({ clueNo: used + 1, clue: q.clues[used], remaining: 2 - used });
}));
app.post('/practice/sets/:setId/questions/:qi/attempt', wrap(async (req, res) => {
  const s = await load(req.params.setId, req.user); const [q, n] = qAt(s, req.params.qi);
  const { answer } = z.object({ answer: z.union([z.string(), z.number()]).transform(String) }).parse(req.body);
  const key = { setId: s.id, studentId: req.user.id, qIndex: n };
  if (await Attempt.exists({ ...key, correct: true })) throw httpError(409, 'Question already solved');
  const a = answer.trim();
  const correct = q.type === 'num' ? Number.isFinite(Number(a)) && Math.abs(Number(a) - Number(q.answer)) <= 1e-6 * Math.max(1, Math.abs(Number(q.answer))) : a === q.answer;
  await Attempt.create({ ...key, classId: s.classId, type: 'attempt', correct, answer: a.slice(0, 200) });
  emit(s, req.user.id, q, n, { type: 'attempt', correct });
  res.json({ correct });
}));
finish(app);
start(app, 'practice-service', () => Attempt.init());

const cfg = require('../../common/config');
cfg.need('INTERNAL_KEY', 'MONGO_URL');
const crypto = require('crypto');
const { z } = require('zod');
const mongoose = require('mongoose');
const { createApp, finish, start } = require('../../common/app');
const { trustGateway, role, internal } = require('../../common/auth');
const { wrap, httpError, oid, cleanJson } = require('../../common/util');
const { names, cascade } = require('../../common/clients');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  code: { type: String, required: true, unique: true },
  teacherId: { type: String, required: true, index: true },
  studentIds: { type: [String], index: true, default: [] },
}, { timestamps: true });
cleanJson(schema);
const Class = mongoose.model('Class', schema);
const feedbackSchema = new mongoose.Schema({
  classId: { type: String, required: true, index: true },
  teacherId: { type: String, required: true },
  studentId: { type: String, required: true, index: true },
  studentName: { type: String, default: '' },
  areaToImprove: { type: String, default: '' },
  feedbackText: { type: String, required: true },
  meetingDate: { type: String, default: '' },
  meetingTime: { type: String, default: '' },
  meetingTopic: { type: String, default: '' },
  studentResponse: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'acknowledged', 'rescheduled'], default: 'sent' }
}, { timestamps: true });
cleanJson(feedbackSchema);
feedbackSchema.index({ classId: 1, studentId: 1, createdAt: -1 });
const Feedback = mongoose.model('Feedback', feedbackSchema);

const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const genCode = () => Array.from({ length: 6 }, () => A[crypto.randomInt(A.length)]).join('');
async function uniqueCode() { for (let i = 0; i < 8; i++) { const c = genCode(); if (!(await Class.exists({ code: c }))) return c; } throw httpError(500, 'Could not allocate code'); }
const Name = z.object({ name: z.string().trim().min(2).max(100) });
const Meeting = {
  areaToImprove: z.string().trim().max(200),
  meetingDate: z.string().trim().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'use YYYY-MM-DD'),
  meetingTime: z.string().trim().regex(/^(\d{2}:\d{2})?$/, 'use HH:MM'),
  meetingTopic: z.string().trim().max(200),
};
const FeedbackCreate = z.object({
  studentId: z.string(),
  feedbackText: z.string().trim().min(1).max(2000),
  areaToImprove: Meeting.areaToImprove.default(''),
  meetingDate: Meeting.meetingDate.default(''),
  meetingTime: Meeting.meetingTime.default(''),
  meetingTopic: Meeting.meetingTopic.default(''),
  studentName: z.string().optional(), // ignored: the real name is looked up
  meetingSchedule: z.object({ date: z.string().optional(), time: z.string().optional(), topic: z.string().optional() }).optional(),
});
const FeedbackUpdate = z.object({ feedbackText: z.string().trim().min(1).max(2000), ...Meeting }).partial().strict()
  .refine(b => Object.keys(b).length > 0, 'Nothing to update');
// Delete everything that belongs to a class, here and in the other services.
async function removeClass(c) {
  const fb = await Feedback.deleteMany({ classId: c.id });
  await c.deleteOne();
  const cleanup = await cascade(['content', 'practice', 'analytics'], `/internal/classes/${c.id}`);
  return { feedback: fb.deletedCount, ...cleanup };
}

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
  const c = await mine(req, req.params.id, { ownerOnly: true });
  res.json({ deleted: { id: c.id, name: c.name }, cleanup: await removeClass(c) });
}));
// Teacher removes a student from the roster; the student leaves a class.
app.delete('/classes/:id/students/:studentId', role('teacher'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id, { ownerOnly: true });
  if (!c.studentIds.includes(req.params.studentId)) throw httpError(404, 'Student is not in this class');
  c.studentIds = c.studentIds.filter(s => s !== req.params.studentId); await c.save();
  res.json({ id: c.id, name: c.name, count: c.studentIds.length });
}));
app.post('/classes/:id/leave', role('student'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id);
  c.studentIds = c.studentIds.filter(s => s !== req.user.id); await c.save();
  res.json({ left: { id: c.id, name: c.name } });
}));
app.post('/classes/:id/feedback', role('teacher'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id, { ownerOnly: true });
  const b = FeedbackCreate.parse(req.body);
  if (!c.studentIds.includes(b.studentId)) throw httpError(400, 'That student is not in this class');
  const ms = b.meetingSchedule || {};
  const studentName = (await names([b.studentId]))[b.studentId] || 'Student';
  const fb = await Feedback.create({
    classId: c.id, teacherId: req.user.id, studentId: b.studentId, studentName,
    areaToImprove: b.areaToImprove, feedbackText: b.feedbackText,
    meetingDate: b.meetingDate || ms.date || '', meetingTime: b.meetingTime || ms.time || '', meetingTopic: b.meetingTopic || ms.topic || '',
  });
  res.status(201).json(fb);
}));
app.get('/classes/:id/feedback', role('teacher', 'student', 'admin'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id);
  const q = req.user.role === 'student' ? { classId: c.id, studentId: req.user.id } : { classId: c.id };
  const items = await Feedback.find(q).sort('-createdAt');
  res.json(items);
}));
async function feedbackIn(c, id, req) {
  const fb = await Feedback.findOne({ _id: oid(id), classId: c.id, ...(req.user.role === 'student' ? { studentId: req.user.id } : {}) });
  if (!fb) throw httpError(404, 'Feedback record not found');
  return fb;
}
app.get('/classes/:id/feedback/:feedbackId', role('teacher', 'student', 'admin'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id); res.json(await feedbackIn(c, req.params.feedbackId, req));
}));
app.put('/classes/:id/feedback/:feedbackId', role('teacher'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id, { ownerOnly: true });
  const fb = await feedbackIn(c, req.params.feedbackId, req);
  Object.assign(fb, FeedbackUpdate.parse(req.body)); res.json(await fb.save());
}));
app.delete('/classes/:id/feedback/:feedbackId', role('teacher'), wrap(async (req, res) => {
  const c = await mine(req, req.params.id, { ownerOnly: true });
  const fb = await feedbackIn(c, req.params.feedbackId, req); await fb.deleteOne(); res.status(204).end();
}));
app.post('/classes/:id/feedback/:feedbackId/respond', role('student'), wrap(async (req, res) => {
  const { response, status } = z.object({
    response: z.string().min(1).max(1000),
    status: z.enum(['acknowledged', 'rescheduled']).default('acknowledged')
  }).parse(req.body);
  const c = await mine(req, req.params.id);
  const fb = await feedbackIn(c, req.params.feedbackId, req);
  fb.studentResponse = response;
  fb.status = status;
  await fb.save();
  res.json(fb);
}));
app.get('/internal/classes/:id', internal, wrap(async (req, res) => {
  const c = await Class.findById(oid(req.params.id)).lean(); if (!c) throw httpError(404, 'Class not found');
  res.json({ id: String(c._id), name: c.name, teacherId: c.teacherId, studentIds: c.studentIds });
}));
// Called by registration-service when an admin deletes a user.
app.delete('/internal/users/:id', internal, wrap(async (req, res) => {
  const id = req.params.id;
  const owned = await Class.find({ teacherId: id });
  for (const c of owned) await removeClass(c);
  const left = await Class.updateMany({ studentIds: id }, { $pull: { studentIds: id } });
  const fb = await Feedback.deleteMany({ studentId: id });
  res.json({ deleted: owned.length + left.modifiedCount + fb.deletedCount, classesDeleted: owned.length, classesLeft: left.modifiedCount, feedback: fb.deletedCount });
}));
finish(app);
start(app, 'class-service', () => Class.init());

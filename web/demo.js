/* Demo mode: lets you click through the whole UI with NO backend.
   Active only when index.html is opened directly (file://) or the URL has ?demo.
   Data lives in memory and resets on refresh. Ignored on the real deployment. */
(() => {
if (!(location.protocol === 'file:' || /[?&]demo/.test(location.search))) return;
const NAMES = { s1: 'Dara', s2: 'Lina', s3: 'Sokha', s4: 'Vanna' };
const D = { users: [
  { id: 'u-admin', name: 'Demo Admin', email: 'admin@demo.com', role: 'admin' },
  { id: 'u-t', name: 'Demo Teacher', email: 'teacher@demo.com', role: 'teacher' },
  { id: 'u-s', name: 'Demo Student', email: 'student@demo.com', role: 'student' }], classes: [], sets: [], ev: [], n: 10 };
const QS = () => [
  { type: 'mcq', q: 'What are the roots of x² − 5x + 6 = 0?', options: ['2 and 3', '−2 and −3', '1 and 6', '−1 and −6'], answer: '2 and 3', concept: 'Factoring', clues: ['Find two numbers with product c and sum b.', 'List the factor pairs of 6.', 'Which pair of factors adds up to 5?'] },
  { type: 'num', q: 'Compute the discriminant of 2x² + 3x − 2 = 0.', answer: '25', concept: 'Discriminant', clues: ['D = b² − 4ac.', 'Read off a, b and c with their signs.', 'a = 2, b = 3, c = −2, so 3² − 4(2)(−2).'] },
  { type: 'mcq', q: 'If the discriminant is negative, the quadratic has…', options: ['two real roots', 'one repeated root', 'no real roots', 'infinite roots'], answer: 'no real roots', concept: 'Discriminant', clues: ['The sign of D decides the root count.', 'A negative D means the square root of a negative.', 'The square root of a negative is not real.'] },
  { type: 'num', q: 'What is the sum of the roots of 3x² − 12x + 5 = 0?', answer: '4', concept: "Vieta's formulas", clues: ['Sum of roots = −b/a.', 'You do not need to solve the equation.', 'Compute −(−12)/3.'] },
  { type: 'num', q: 'What is the x-coordinate of the vertex of y = x² − 6x + 8?', answer: '3', concept: 'Vertex', clues: ['Vertex x = −b/(2a).', 'Here a = 1 and b = −6.', 'Compute −(−6)/(2·1).'] }];
const mk = (id, classId, title, published) => ({ id, classId, teacherId: 'u-t', title, notes: 'Quadratics: standard form, factoring, discriminant, Vieta and the vertex.', cheat: ['ax² + bx + c = 0', 'D = b² − 4ac', 'Sum of roots = −b/a', 'Vertex x = −b/(2a)'], questions: QS(), published, source: 'ai', updatedAt: new Date().toISOString() });
D.classes.push({ id: 'c1', name: 'Grade 10 Algebra', code: 'ABC234', teacherId: 'u-t', studentIds: ['u-s', 's1', 's2', 's3', 's4'] });
D.sets.push(mk('set1', 'c1', 'Quadratics', true));
const add = (sid, q, type, correct) => D.ev.push({ sid, q, type, correct, classId: 'c1', setId: 'set1', ts: Date.now() });
[['s1', 0, 1], ['s1', 1, 0], ['s1', 1, 0], ['s1', 3, 1], ['s2', 0, 1], ['s2', 1, 0], ['s2', 1, 0], ['s2', 2, 1], ['s3', 1, 0], ['s3', 1, 0], ['s3', 1, 0], ['s3', 3, 0], ['s4', 0, 1], ['s4', 2, 1], ['s4', 4, 1]].forEach(([s, q, c]) => { if (!c) { add(s, q, 'attempt', false); } else add(s, q, 'attempt', true); });
['s1', 's2', 's3', 's3', 's3'].forEach((s, i) => add(s, 1, 'clue'));
add('s3', 3, 'clue');

const json = (b, s = 200) => s === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const fail = (s, m) => json({ error: m }, s);
const tok = u => 'h.' + btoa(JSON.stringify({ sub: u.id, exp: Math.floor(Date.now() / 1000) + 3600 })) + '.s';
const pub = u => ({ id: u.id, name: u.name, email: u.email, role: u.role });
const nameOf = id => (D.users.find(u => u.id === id) || {}).name || NAMES[id] || 'Student ' + String(id).slice(-4);
const safeStudent = s => ({ id: s.id, classId: s.classId, title: s.title, cheat: s.cheat, updatedAt: s.updatedAt, questions: s.questions.map(q => ({ type: q.type, q: q.q, options: q.options, concept: q.concept })) });
const code = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const status = (a, r, c) => !a ? 'ok' : r >= .5 || c >= 1.5 ? 'flagged' : r >= .3 || c >= 1 ? 'watch' : 'ok';
function validate(qs) {
  const d = [];
  qs.forEach((q, i) => {
    if (!q.q || q.q.length < 3) d.push({ field: `questions.${i}.q`, message: 'String must contain at least 3 character(s)' });
    if (q.type === 'mcq' && !(q.options || []).includes(q.answer)) d.push({ field: `questions.${i}.answer`, message: 'mcq answer must equal one of the options' });
    if (q.type === 'num' && !Number.isFinite(Number(q.answer))) d.push({ field: `questions.${i}.answer`, message: 'numeric answer must be a number' });
    if ((q.clues || []).some(c => !c)) d.push({ field: `questions.${i}.clues`, message: 'all 3 clues are required' });
  });
  return d;
}
const evs = (classId, setId) => D.ev.filter(e => e.classId === classId && (!setId || e.setId === setId));
function agg(list, key) {
  const m = new Map();
  list.forEach(e => { const k = key(e); const r = m.get(k) || { attempts: 0, wrong: 0, clues: 0, students: new Set(), solved: new Set(), concept: e.concept }; r.students.add(e.sid); if (e.type === 'attempt') { r.attempts++; if (!e.correct) r.wrong++; else r.solved.add(e.q); } else r.clues++; m.set(k, r); });
  return m;
}
const progress = (set, uid) => { const qs = set.questions.map((q, i) => { const r = D.ev.filter(e => e.sid === uid && e.setId === set.id && e.q === i); const used = r.filter(e => e.type === 'clue').length; return { qIndex: i, solved: r.some(e => e.correct), attempts: r.filter(e => e.type === 'attempt').length, cluesUsed: used, clues: q.clues.slice(0, used) }; }); return { solved: qs.filter(x => x.solved).length, total: qs.length, questions: qs }; };

const routes = [];
const R = (m, re, fn) => routes.push([m, new RegExp('^' + re + '$'), fn]);
R('POST', '/auth/register', (m, b) => {
  if (!b.name || b.name.length < 2) return fail(400, 'Validation failed');
  if (D.users.find(u => u.email === b.email.toLowerCase())) return fail(409, 'Already exists');
  if (b.password.length < 8 || !/\d/.test(b.password) || !/[A-Za-z]/.test(b.password)) return json({ error: 'Validation failed', details: [{ field: 'password', message: 'must be 8+ characters with a letter and a number' }] }, 400);
  const u = { id: 'u' + D.n++, name: b.name, email: b.email.toLowerCase(), role: b.role }; D.users.push(u); return json(pub(u), 201);
});
R('POST', '/auth/login', (m, b) => {
  let u = D.users.find(x => x.email === String(b.email).toLowerCase());
  if (!u) return fail(401, 'Invalid email or password (demo: use teacher@demo.com, student@demo.com or admin@demo.com, any password)');
  return json({ token: tok(u), tokenType: 'Bearer', expiresIn: '1h', user: pub(u) });
});
R('GET', '/auth/history', () => json([{ success: true, ip: '127.0.0.1', createdAt: new Date().toISOString() }]));
R('GET', '/classes', (m, b, u) => json(u.role === 'student' ? D.classes.filter(c => c.studentIds.includes(u.id)).map(c => ({ id: c.id, name: c.name, teacherId: c.teacherId })) : u.role === 'teacher' ? D.classes.filter(c => c.teacherId === u.id) : D.classes));
R('POST', '/classes', (m, b, u) => { const c = { id: 'c' + D.n++, name: b.name, code: code(), teacherId: u.id, studentIds: [] }; D.classes.push(c); return json(c, 201); });
R('POST', '/classes/join', (m, b, u) => { const c = D.classes.find(x => x.code === String(b.code).toUpperCase()); if (!c) return fail(404, 'No class with that code'); if (!c.studentIds.includes(u.id)) c.studentIds.push(u.id); return json({ id: c.id, name: c.name }); });
R('GET', '/classes/([\\w-]+)', (m, b, u) => { const c = D.classes.find(x => x.id === m[1]); return c ? json(u.role === 'student' ? { id: c.id, name: c.name } : c) : fail(404, 'Class not found'); });
R('PUT', '/classes/([\\w-]+)', (m, b) => { const c = D.classes.find(x => x.id === m[1]); c.name = b.name; return json(c); });
R('DELETE', '/classes/([\\w-]+)', m => { D.classes = D.classes.filter(c => c.id !== m[1]); return json(null, 204); });
R('POST', '/classes/([\\w-]+)/regenerate-code', m => { const c = D.classes.find(x => x.id === m[1]); c.code = code(); return json(c); });
R('GET', '/classes/([\\w-]+)/students', m => { const c = D.classes.find(x => x.id === m[1]); return json({ count: c.studentIds.length, studentIds: c.studentIds, students: c.studentIds.map(id => ({ id, name: nameOf(id) })) }); });
R('GET', '/content/classes/([\\w-]+)/sets', (m, b, u) => { const l = D.sets.filter(s => s.classId === m[1]); return json(u.role === 'teacher' ? l : l.filter(s => s.published).map(safeStudent)); });
R('POST', '/content/classes/([\\w-]+)/sets', (m, b, u) => { const gen = b.generate && (b.notes || '').trim().length >= 30; const s = { ...mk('set' + D.n++, m[1], b.title, false), notes: b.notes || '', teacherId: u.id }; if (!gen) { s.questions = []; s.cheat = []; s.source = 'manual'; } D.sets.push(s); return json(s, 201); });
R('GET', '/content/sets/([\\w-]+)', (m, b, u) => { const s = D.sets.find(x => x.id === m[1]); return s ? json(u.role === 'teacher' ? s : safeStudent(s)) : fail(404, 'Set not found'); });
R('PUT', '/content/sets/([\\w-]+)', (m, b) => { const s = D.sets.find(x => x.id === m[1]); if (b.questions) { const d = validate(b.questions); if (d.length) return json({ error: 'Validation failed', details: d }, 400); } Object.assign(s, b); return json(s); });
R('POST', '/content/sets/([\\w-]+)/publish', (m, b) => { const s = D.sets.find(x => x.id === m[1]); if (b.published && !s.questions.length) return fail(400, 'Add at least one question before publishing'); s.published = b.published; return json(s); });
R('POST', '/content/sets/([\\w-]+)/regenerate', m => { const s = D.sets.find(x => x.id === m[1]); s.questions = QS(); s.cheat = mk().cheat; s.source = 'ai'; return json(s); });
R('DELETE', '/content/sets/([\\w-]+)', m => { D.sets = D.sets.filter(s => s.id !== m[1]); return json(null, 204); });
R('GET', '/practice/sets/([\\w-]+)', (m, b, u) => { const s = D.sets.find(x => x.id === m[1]); return s && s.published ? json({ ...safeStudent(s), progress: progress(s, u.id).questions }) : fail(404, 'Set not found'); });
R('GET', '/practice/sets/([\\w-]+)/progress', (m, b, u) => json(progress(D.sets.find(x => x.id === m[1]), u.id)));
R('POST', '/practice/sets/([\\w-]+)/questions/(\\d+)/attempt', (m, b, u) => {
  const s = D.sets.find(x => x.id === m[1]), i = +m[2], q = s.questions[i]; if (!q) return fail(404, 'Question not found');
  if (progress(s, u.id).questions[i].solved) return fail(409, 'Question already solved');
  const a = String(b.answer).trim(), correct = q.type === 'num' ? Number(a) === Number(q.answer) : a === q.answer;
  D.ev.push({ sid: u.id, q: i, type: 'attempt', correct, classId: s.classId, setId: s.id, concept: q.concept, ts: Date.now() }); return json({ correct });
});
R('POST', '/practice/sets/([\\w-]+)/questions/(\\d+)/clue', (m, b, u) => {
  const s = D.sets.find(x => x.id === m[1]), i = +m[2], q = s.questions[i], p = progress(s, u.id).questions[i];
  if (p.solved) return fail(409, 'Question already solved'); if (p.cluesUsed >= 3) return fail(409, 'No clues left (maximum 3)');
  D.ev.push({ sid: u.id, q: i, type: 'clue', classId: s.classId, setId: s.id, concept: q.concept, ts: Date.now() }); return json({ clueNo: p.cluesUsed + 1, clue: q.clues[p.cluesUsed], remaining: 2 - p.cluesUsed });
});
const A = (m, re, fn) => R('GET', '/analytics/classes/([\\w-]+)/' + re, (mm, b, u, q) => fn(evs(mm[1], q.get('setId'))));
A(0, 'radar', l => { const g = agg(l, e => e.q); return json([...g].sort((a, b) => a[0] - b[0]).map(([q, r]) => { const rate = r.attempts ? r.wrong / r.attempts : 0, avg = r.clues / r.students.size; return { qIndex: q, concept: r.concept, attempts: r.attempts, wrong: r.wrong, wrongRate: +rate.toFixed(2), clues: r.clues, students: r.students.size, avgClues: +avg.toFixed(2), status: status(r.attempts, rate, avg) }; })); });
A(0, 'students', l => json([...agg(l, e => e.sid)].map(([id, r]) => ({ studentId: id, name: nameOf(id), attempts: r.attempts, correct: r.attempts - r.wrong, clues: r.clues, solvedQuestions: r.solved.size, lastActive: new Date().toISOString() }))));
A(0, 'concepts', l => json([...agg(l, e => e.concept)].map(([c, r]) => { const rate = r.attempts ? r.wrong / r.attempts : 0, avg = r.clues / r.students.size; return { concept: c, attempts: r.attempts, wrongRate: +rate.toFixed(2), avgClues: +avg.toFixed(2), status: status(r.attempts, rate, avg) }; })));
A(0, 'matrix', l => json([...agg(l, e => e.sid + '|' + e.q)].map(([k, r]) => ({ studentId: k.split('|')[0], qIndex: +k.split('|')[1], attempts: r.attempts, wrong: r.wrong, clues: r.clues, solved: r.solved.size > 0 }))));
A(0, 'export.csv', l => new Response(['student,question,concept,type,correct', ...l.map(e => [nameOf(e.sid), 'Q' + (e.q + 1), e.concept, e.type, e.correct ?? ''].join(','))].join('\n'), { status: 200, headers: { 'Content-Type': 'text/csv' } }));
R('GET', '/admin/users', (m, b, u, q) => { const role = q.get('role'), l = D.users.filter(x => !role || x.role === role), page = +q.get('page') || 1, lim = +q.get('limit') || 20; return json({ page, limit: lim, total: l.length, items: l.slice((page - 1) * lim, page * lim) }); });
R('PATCH', '/admin/users/([\\w-]+)/role', (m, b) => { const u = D.users.find(x => x.id === m[1]); u.role = b.role; return json(pub(u)); });
R('DELETE', '/admin/users/([\\w-]+)', m => { D.users = D.users.filter(x => x.id !== m[1]); return json(null, 204); });

const realFetch = window.fetch.bind(window);
window.fetch = async (url, o = {}) => {
  if (!String(url).startsWith('/api')) return realFetch(url, o);
  await new Promise(r => setTimeout(r, 120));
  const [path, qs] = String(url).slice(4).split('?'), method = (o.method || 'GET').toUpperCase(), q = new URLSearchParams(qs || '');
  const h = o.headers || {}, auth = h.Authorization || h.authorization || '';
  let u = null; try { u = D.users.find(x => x.id === JSON.parse(atob(auth.slice(7).split('.')[1])).sub); } catch (e) {}
  const pubRoute = path === '/auth/login' || path === '/auth/register';
  if (!pubRoute && !u) return fail(401, 'Invalid token');
  const body = o.body ? JSON.parse(o.body) : {};
  for (const [m, re, fn] of routes) { if (m !== method) continue; const mm = path.match(re); if (mm) { try { return fn(mm, body, u, q); } catch (e) { return fail(500, 'Demo error: ' + e.message); } } }
  return fail(404, 'Not found');
};
document.addEventListener('DOMContentLoaded', () => {
  const b = document.createElement('div');
  b.textContent = 'Demo mode, no backend. Log in as teacher@demo.com, student@demo.com or admin@demo.com (any password). Data resets on refresh.';
  b.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:60;max-width:300px;padding:10px 14px;border-radius:14px;background:#16142af2;border:1px solid #ffc43d;color:#ffc43d;font:12px/1.4 system-ui,sans-serif';
  document.body.appendChild(b);
});
})();

const http = require('http');
const BASE = (process.argv[2] || 'http://localhost').replace(/\/$/, '');
const ADMIN = { email: process.env.ADMIN_EMAIL || 'admin@tutorpulse.dev', password: process.env.ADMIN_PASSWORD || 'ChangeMe123' };
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const req = async (method, path, { token, body } = {}) => {
  if (path.includes('..') || path.includes('%2e')) {
    return new Promise((resolve) => {
      const u = new URL(BASE);
      const options = { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path, method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) } };
      const r = http.request(options, res => {
        let data = ''; res.on('data', chunk => data += chunk);
        res.on('end', () => { let json; try { json = JSON.parse(data); } catch { json = data; } resolve({ status: res.statusCode, body: json, served: res.headers['x-served-by'] }); });
      });
      if (body) r.write(JSON.stringify(body));
      r.end();
    });
  }
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json, served: r.headers.get('x-served-by') };
};
const check = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const eq = (name, r, status) => check(name, r.status === status, `expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);

(async () => {
  const T = { name: 'Test Teacher', email: `t_${run}@test.dev`, password: 'Passw0rdT', role: 'teacher' };
  const S = { name: 'Test Student', email: `s_${run}@test.dev`, password: 'Passw0rdS', role: 'student' };
  console.log('--- Registration & Login');
  eq('register teacher', await req('POST', '/api/auth/register', { body: T }), 201);
  eq('register student', await req('POST', '/api/auth/register', { body: S }), 201);
  eq('duplicate email rejected', await req('POST', '/api/auth/register', { body: T }), 409);
  eq('cannot self-register as admin', await req('POST', '/api/auth/register', { body: { ...T, email: `a_${run}@t.dev`, role: 'admin' } }), 400);
  eq('weak password rejected', await req('POST', '/api/auth/register', { body: { ...S, email: `w_${run}@t.dev`, password: 'short' } }), 400);
  eq('wrong password -> 401', await req('POST', '/api/auth/login', { body: { email: T.email, password: 'WrongPass1' } }), 401);
  eq('unknown email -> 401', await req('POST', '/api/auth/login', { body: { email: `nobody_${run}@t.dev`, password: 'Whatever1' } }), 401);
  const tl = await req('POST', '/api/auth/login', { body: { email: T.email, password: T.password } }); eq('teacher login', tl, 200);
  const sl = await req('POST', '/api/auth/login', { body: { email: S.email, password: S.password } }); eq('student login', sl, 200);
  const tt = tl.body.token, st = sl.body.token;
  console.log('--- JWT & RBAC at the gateway');
  eq('no token -> 401', await req('GET', '/api/classes'), 401);
  eq('invalid token -> 401', await req('GET', '/api/classes', { token: 'abc.def.ghi' }), 401);
  eq('tampered token -> 401', await req('GET', '/api/classes', { token: tt.slice(0, -3) + 'xyz' }), 401);
  eq('student cannot create class -> 403', await req('POST', '/api/classes', { token: st, body: { name: 'Hack' } }), 403);
  eq('teacher cannot use practice -> 403', await req('GET', '/api/practice/sets/000000000000000000000000', { token: tt }), 403);
  eq('student cannot read analytics -> 403', await req('GET', '/api/analytics/classes/000000000000000000000000/radar', { token: st }), 403);
  eq('teacher cannot list users (admin only) -> 403', await req('GET', '/api/admin/users', { token: tt }), 403);
  eq('unknown route denied -> 403', await req('GET', '/api/secret', { token: tt }), 403);
  eq('path traversal blocked -> 400', await req('GET', '/api/classes/../admin/users', { token: tt }), 400);
  eq('internal routes not exposed through gateway -> 404', await req('GET', '/api/classes/internal/classes/x', { token: tt }), 404);
  console.log('--- Admin');
  const al = await req('POST', '/api/auth/login', { body: ADMIN });
  if (al.status === 200) { eq('admin lists users', await req('GET', '/api/admin/users', { token: al.body.token }), 200); } else console.log('SKIP  admin tests (admin login failed)');
  console.log('--- Classes');
  const c = await req('POST', '/api/classes', { token: tt, body: { name: 'Algebra ' + run } }); eq('teacher creates class', c, 201);
  check('class code is 6 chars', /^[A-Z2-9]{6}$/.test(c.body.code || ''));
  eq('student wrong code -> 404', await req('POST', '/api/classes/join', { token: st, body: { code: 'ZZZZZZ' } }), 404);
  eq('student joins class', await req('POST', '/api/classes/join', { token: st, body: { code: c.body.code } }), 200);
  const sc = await req('GET', '/api/classes', { token: st }); check('student sees class without code', sc.body[0] && !('code' in sc.body[0]));
  eq('teacher updates class', await req('PUT', `/api/classes/${c.body.id}`, { token: tt, body: { name: 'Algebra II ' + run } }), 200);
  console.log('--- Content');
  const set = await req('POST', `/api/content/classes/${c.body.id}/sets`, { token: tt, body: { title: 'Quadratics', notes: '', generate: false } }); eq('teacher creates set', set, 201);
  eq('cannot publish empty set -> 400', await req('POST', `/api/content/sets/${set.body.id}/publish`, { token: tt, body: { published: true } }), 400);
  const qs = [
    { type: 'mcq', q: 'Roots of x^2-5x+6=0?', options: ['2 and 3', '-2 and -3', '1 and 6', '-1 and -6'], answer: '2 and 3', concept: 'Factoring', clues: ['Rule: product=c, sum=b', 'List factors of 6', 'Which pair adds to 5?'] },
    { type: 'num', q: 'Discriminant of 2x^2+3x-2?', answer: '25', concept: 'Discriminant', clues: ['D=b^2-4ac', 'Find a, b, c', '3^2-4(2)(-2)'] }];
  eq('invalid question rejected -> 400', await req('PUT', `/api/content/sets/${set.body.id}`, { token: tt, body: { questions: [{ ...qs[0], answer: 'not an option' }] } }), 400);
  eq('teacher saves questions', await req('PUT', `/api/content/sets/${set.body.id}`, { token: tt, body: { cheat: ['D=b^2-4ac'], questions: qs } }), 200);
  eq('student cannot see unpublished -> 404', await req('GET', `/api/content/sets/${set.body.id}`, { token: st }), 404);
  eq('teacher publishes', await req('POST', `/api/content/sets/${set.body.id}/publish`, { token: tt, body: { published: true } }), 200);
  const sv = await req('GET', `/api/content/sets/${set.body.id}`, { token: st });
  check('student view hides answers and clues', sv.status === 200 && !JSON.stringify(sv.body).includes('"answer"') && !JSON.stringify(sv.body).includes('clues'));
  console.log('--- Practice');
  const base = `/api/practice/sets/${set.body.id}/questions`;
  const outsider = { name: 'Outsider', email: `o_${run}@test.dev`, password: 'Passw0rdO', role: 'student' };
  await req('POST', '/api/auth/register', { body: outsider });
  const ot = (await req('POST', '/api/auth/login', { body: outsider })).body.token;
  eq('student outside class -> 403', await req('GET', `/api/practice/sets/${set.body.id}`, { token: ot }), 403);
  eq('wrong answer', await req('POST', `${base}/1/attempt`, { token: st, body: { answer: '24' } }), 200);
  for (let i = 1; i <= 3; i++) eq(`clue ${i}`, await req('POST', `${base}/1/clue`, { token: st }), 200);
  eq('4th clue blocked -> 409', await req('POST', `${base}/1/clue`, { token: st }), 409);
  const ok = await req('POST', `${base}/1/attempt`, { token: st, body: { answer: 25 } }); check('correct answer graded', ok.body.correct === true);
  eq('re-attempt after solved -> 409', await req('POST', `${base}/1/attempt`, { token: st, body: { answer: 25 } }), 409);
  eq('question out of range -> 404', await req('POST', `${base}/9/attempt`, { token: st, body: { answer: 1 } }), 404);
  const pr = await req('GET', `/api/practice/sets/${set.body.id}/progress`, { token: st }); check('progress shows 1 solved', pr.body.solved === 1, JSON.stringify(pr.body));
  console.log('--- Analytics');
  await new Promise(r => setTimeout(r, 800));
  const radar = await req('GET', `/api/analytics/classes/${c.body.id}/radar`, { token: tt }); eq('teacher radar', radar, 200);
  const q1 = (radar.body || []).find(x => x.qIndex === 1); check('radar reflects telemetry', q1 && q1.attempts === 2 && q1.clues === 3, JSON.stringify(radar.body));
  eq('students summary', await req('GET', `/api/analytics/classes/${c.body.id}/students`, { token: tt }), 200);
  eq('matrix', await req('GET', `/api/analytics/classes/${c.body.id}/matrix`, { token: tt }), 200);
  eq('csv export', await req('GET', `/api/analytics/classes/${c.body.id}/export.csv`, { token: tt }), 200);
  const other = { name: 'Other Teacher', email: `t2_${run}@test.dev`, password: 'Passw0rdX', role: 'teacher' };
  await req('POST', '/api/auth/register', { body: other });
  const t2 = (await req('POST', '/api/auth/login', { body: { email: other.email, password: other.password } })).body.token;
  eq("other teacher cannot read someone else's analytics -> 403", await req('GET', `/api/analytics/classes/${c.body.id}/radar`, { token: t2 }), 403);
  eq("other teacher cannot delete someone else's class -> 403", await req('DELETE', `/api/classes/${c.body.id}`, { token: t2 }), 403);
  console.log('--- Load balancing');
  const seen = new Set(); for (let i = 0; i < 8; i++) { const r = await req('GET', '/health'); if (r.served) seen.add(r.served); }
  console.log('X-Served-By values seen:', [...seen].join(', ') || '(none)');
  check('requests served by 2 gateway replicas (needs the load balancer URL)', seen.size >= 2, 'only ' + seen.size + ' instance seen');
  eq('cleanup: teacher deletes class', await req('DELETE', `/api/classes/${c.body.id}`, { token: tt }), 204);
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

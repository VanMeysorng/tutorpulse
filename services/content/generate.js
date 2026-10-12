const { z } = require('zod');
const Question = z.object({
  type: z.enum(['mcq', 'num']),
  q: z.string().trim().min(3).max(500),
  options: z.array(z.string().trim().min(1).max(200)).length(4).optional(),
  answer: z.string().trim().min(1).max(200),
  concept: z.string().trim().min(1).max(80),
  clues: z.array(z.string().trim().min(1).max(400)).length(3),
}).superRefine((q, ctx) => {
  if (q.type === 'mcq' && (!q.options || !q.options.includes(q.answer))) ctx.addIssue({ code: 'custom', message: 'mcq answer must equal one of the options', path: ['answer'] });
  if (q.type === 'num' && !Number.isFinite(Number(q.answer))) ctx.addIssue({ code: 'custom', message: 'numeric answer must be a number', path: ['answer'] });
});
const PROMPT = `You are a STEM teaching assistant. From the lesson notes, return ONLY JSON:
{"cheat":[3-6 short formula or key-term lines],"questions":[exactly 5 items]}
Each question: {"type":"mcq"|"num","q":string,"options":[4 strings, mcq only],"answer":string (mcq: exactly one option; num: plain number),"concept":string,"clues":[rule recall, strategy focus, first-step setup]}.
Clues must never state the final answer.\n\nNOTES:\n`;

function generateFallback(notes) {
  const lines = notes.split('\n').map(s => s.trim()).filter(s => s.length > 5);
  const cheat = lines.slice(0, 5);
  const questions = [];
  const candidates = lines.filter(s => s.length >= 10 && s.length <= 250);
  for (let i = 0; i < Math.min(5, candidates.length); i++) {
    const text = candidates[i];
    const words = text.split(/\s+/);
    const concept = words.slice(0, 3).join(' ') || 'Key Concept';
    const numMatch = text.match(/-?\d+(\.\d+)?/);
    if (numMatch && i % 2 === 1) {
      const ansVal = numMatch[0];
      const qText = text.replace(ansVal, '___');
      questions.push({
        type: 'num',
        q: `Numerical check: ${qText}`,
        answer: String(ansVal),
        concept: concept.slice(0, 40),
        clues: [`Review the section on ${concept}`, `Check equation: ${text.slice(0, 50)}`, `Value is ${ansVal}`]
      });
    } else {
      const targetWord = words.find(w => w.length > 4 && !/^(the|this|that|with|from|where|which|about)$/i.test(w)) || words[0] || 'term';
      const cleanWord = targetWord.replace(/[^\w]/g, '');
      if (!cleanWord) continue;
      const qText = text.replace(targetWord, '___');
      const options = Array.from(new Set([cleanWord, 'Inverse relation', 'Constant factor', 'Null set'])).slice(0, 4);
      while (options.length < 4) options.push(`Option ${options.length + 1}`);
      options.sort(() => Math.random() - 0.5);
      questions.push({
        type: 'mcq',
        q: `Fill in the missing concept: ${qText}`,
        options,
        answer: cleanWord,
        concept: concept.slice(0, 40),
        clues: [`Recall key definition for ${concept}`, `Starts with '${cleanWord[0].toUpperCase()}'`, `Correct answer is ${cleanWord}`]
      });
    }
  }
  return { cheat: cheat.length ? cheat : ['Key concepts from notes'], questions, source: 'fallback' };
}

async function generate(notes) {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + groqKey },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are a STEM teaching assistant. Always output valid JSON.' },
            { role: 'user', content: PROMPT + notes.slice(0, 8000) }
          ]
        })
      });
      if (r.ok) {
        const j = await r.json();
        const text = (j.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(text);
        const questions = z.array(Question).max(5).parse(parsed.questions);
        return { cheat: z.array(z.string()).max(8).parse(parsed.cheat || []), questions, source: 'ai' };
      } else {
        console.error('Groq API returned status:', r.status);
      }
    } catch (e) {
      console.error('Groq AI error:', e.message);
    }
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (key) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: AbortSignal.timeout(60000),
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5', max_tokens: 3000, messages: [{ role: 'user', content: PROMPT + notes.slice(0, 8000) }] }),
      });
      if (r.ok) {
        const j = await r.json();
        const text = (j.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(text);
        const questions = z.array(Question).max(5).parse(parsed.questions);
        return { cheat: z.array(z.string()).max(8).parse(parsed.cheat || []), questions, source: 'ai' };
      }
    } catch (e) {
      console.error('Anthropic AI error:', e.message);
    }
  }

  return generateFallback(notes);
}
module.exports = { generate, Question };

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
const PROMPT = `You are an expert STEM teaching assistant. From the lesson notes, return ONLY valid JSON:
{"cheat":[3-8 short formula or key-term lines],"questions":[between 10 and 15 items, exactly 15 if notes permit]}
Each question item: {"type":"mcq"|"num","q":string,"options":[4 strings, mcq only],"answer":string (mcq: exactly one option; num: plain number),"concept":string,"clues":[rule recall, strategy focus, first-step setup]}.
Clues must never state the final answer. Questions should be scaffolded from foundational to advanced application.\n\nNOTES:\n`;

// Used when no AI key is configured: builds simple fill-in-the-blank questions from the notes.
// Clues guide the student but never reveal the answer.
const STOP = /^(the|this|that|with|from|where|which|about|there|their|these|those|when|then|than|into|over|under|between|because)$/i;
function generateFallback(notes) {
  const lines = notes.split(/\n|(?<=[.;])\s+/).map(s => s.trim()).filter(s => s.length > 5);
  const cheat = lines.slice(0, 8).map(l => l.slice(0, 200));
  const candidates = lines.filter(s => s.length >= 8 && s.length <= 250);
  const vocab = [...new Set(notes.split(/\s+/).map(w => w.replace(/[^\w-]/g, '')).filter(w => w.length > 4 && /^[A-Za-z][A-Za-z-]+$/.test(w) && !STOP.test(w)))];
  const questions = [];
  candidates.slice(0, 15).forEach((text, i) => {
    const concept = (text.split(/[:=,]/)[0].split(/\s+/).slice(0, 4).join(' ') || 'Key concept').slice(0, 60);
    const num = text.match(/-?\d+(\.\d+)?/);
    if (num && i % 2 === 1) {
      questions.push({ type: 'num', q: `Fill in the missing number: ${text.replace(num[0], '___')}`.slice(0, 500), answer: num[0], concept,
        clues: [`Recall the rule or value for "${concept}" from the lesson notes.`, 'Check the units and what quantity the blank represents.', 'Write out the full statement and solve for the blank.'] });
      return;
    }
    const words = text.split(/\s+/);
    const target = words.find(w => w.replace(/[^\w-]/g, '').length > 4 && !STOP.test(w.replace(/[^\w-]/g, '')));
    const answer = target && target.replace(/[^\w-]/g, '');
    if (!answer) return;
    const distractors = vocab.filter(w => w.toLowerCase() !== answer.toLowerCase()).sort(() => Math.random() - 0.5).slice(0, 3);
    if (distractors.length < 3) return;
    const options = [answer, ...distractors].sort(() => Math.random() - 0.5);
    questions.push({ type: 'mcq', q: `Which term completes the statement? ${text.replace(target, '___')}`.slice(0, 500), options, answer, concept,
      clues: [`Think about the definition of "${concept}".`, 'Eliminate options that do not fit the grammar or units of the sentence.', `The missing term has ${answer.length} letters.`] });
  });
  return { cheat: cheat.length ? cheat : ['Key concepts from notes'], questions, source: 'fallback' };
}

function parseQuestions(arr) {
  if (!Array.isArray(arr)) throw new Error('questions missing');
  const ok = [];
  for (const item of arr) {
    const r = Question.safeParse(item);
    if (r.success) ok.push(r.data);
  }
  console.log('AI questions valid: ' + ok.length + ' of ' + arr.length);
  if (ok.length < 10) throw new Error('only ' + ok.length + ' valid questions');
  return ok.slice(0, 15);
}

async function generate(notes) {
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(45000),
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + groqKey },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are an expert STEM teaching assistant. Generate exactly up to 15 scaffolded questions and a cheatsheet based on lesson notes. Output ONLY valid JSON.' },
            { role: 'user', content: PROMPT + notes.slice(0, 8000) }
          ]
        })
      });
      if (r.ok) {
        const j = await r.json();
        const text = (j.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(text);
        const questions = parseQuestions(parsed.questions);
        return { cheat: z.array(z.string()).max(10).parse(parsed.cheat || []), questions, source: 'ai' };
      } else {
        console.error('Groq API returned status:', r.status);
      }
    } catch (e) {
      console.error('Groq AI error:', e.message);
    }
  }

  return generateFallback(notes);
}

async function askAssistant(prompt) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return 'AI Assistant is currently offline. Please configure GROQ_API_KEY.';
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + groqKey },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: 'You are TutorPulse AI Study Buddy. Help students understand STEM concepts, study methods, formulas, and conceptual intuition. Be encouraging, concise, and pedagogical. Never solve active exam questions directly; instead, guide their thinking with analogies.' },
          { role: 'user', content: prompt }
        ]
      })
    });
    if (r.ok) {
      const j = await r.json();
      return j.choices?.[0]?.message?.content || 'I am ready to help you with your STEM studies!';
    }
  } catch (err) {
    return 'Could not reach AI Assistant: ' + err.message;
  }
  return 'AI Assistant is temporarily unavailable.';
}

async function generateFeedbackTemplate(studentName, areaToImprove) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return `Hi ${studentName}, great effort on your recent practice. I noticed you might benefit from reviewing ${areaToImprove || 'core fundamentals'}. Let's connect during our upcoming check-in to walk through a few problems together!`;
  }
  try {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + groqKey },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: 'You are an encouraging STEM teacher writing brief, actionable feedback to a student. Keep it warm, constructive, and under 3 sentences.' },
          { role: 'user', content: `Write personalized teacher feedback for student "${studentName}" who needs improvement in "${areaToImprove || 'problem-solving strategy'}". Mention arranging a brief meeting to support them.` }
        ]
      })
    });
    if (r.ok) {
      const j = await r.json();
      return j.choices?.[0]?.message?.content?.trim() || `Hi ${studentName}, let's work together on ${areaToImprove}!`;
    }
  } catch (e) {}
  return `Hi ${studentName}, you did solid work on your practice set! I noticed some areas to improve in ${areaToImprove || 'recent concepts'}. Let's set up a quick 1-on-1 check-in to strengthen this topic.`;
}

module.exports = { generate, askAssistant, generateFeedbackTemplate, Question };

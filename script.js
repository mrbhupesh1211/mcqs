
// ── State ──
let allQuestions = [];
let quizQuestions = [];
let answers = [];
let currentIdx = 0;
let score = 0;
let timerInterval = null;
let timeLeft = 0;
let cfg = {};

// ── URL Rows ──
function addUrlRow(val = '') {
  const list = document.getElementById('url-list');
  const idx = list.children.length;
  const row = document.createElement('div');
  row.className = 'url-row';
  row.innerHTML = `
    <input type="text" placeholder="https://raw.githubusercontent.com/user/repo/main/quiz.json" value="${val}" />
    <button class="btn-icon danger" onclick="removeUrlRow(this)" title="Remove" ${idx === 0 ? 'style="display:none"' : ''}>✕</button>
  `;
  list.appendChild(row);
}
function removeUrlRow(btn) { btn.parentElement.remove(); }

function getURLs() {
  return [...document.querySelectorAll('#url-list input')]
    .map(i => i.value.trim()).filter(Boolean);
}

// ── Fetch ──
async function fetchAllURLs() {
  const urls = getURLs();
  if (!urls.length) { showErr('fetch-error', 'Please enter at least one JSON URL.'); return; }
  clearErr('fetch-error');

  const bar = document.getElementById('fetch-status');
  bar.style.display = 'flex';
  bar.innerHTML = '';
  allQuestions = [];

  for (const url of urls) {
    const tag = document.createElement('span');
    tag.className = 'tag loading';
    tag.textContent = shortURL(url) + ' …';
    bar.appendChild(tag);

    try {
      let data;
      // Try direct first, then corsproxy.io fallback
      async function tryFetch(u) {
        const res = await fetch(u);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      }
      let raw;
      try {
        raw = await tryFetch(url);
      } catch {
        raw = await tryFetch(`https://corsproxy.io/?${encodeURIComponent(url)}`);
      }
      data = JSON.parse(raw);

      if (!data.questions || !Array.isArray(data.questions)) throw new Error('Invalid schema');
      const topic = data.topic || data.quiz_title || 'General';
      const valid = data.questions.filter(q => q.question && Array.isArray(q.options) && typeof q.correct_option === 'number');
      valid.forEach(q => { q._topic = topic; });
      allQuestions.push(...valid);
      tag.className = 'tag success';
      tag.textContent = `✓ ${topic} (${valid.length}q)`;
    } catch (e) {
      tag.className = 'tag error';
      tag.textContent = `✗ ${shortURL(url)}: ${e.message}`;
    }
  }

  if (allQuestions.length === 0) {
    showErr('fetch-error', 'No valid questions loaded. Check your URLs and JSON schema.');
    return;
  }

  document.getElementById('params-card').style.display = 'block';
  document.getElementById('q-count').placeholder = `All (${allQuestions.length})`;
  document.getElementById('loaded-info').classList.remove('hidden');
  document.getElementById('loaded-info').textContent = `✓ ${allQuestions.length} questions loaded from ${urls.length} source(s). Configure parameters and start.`;
}

function shortURL(url) {
  try { const u = new URL(url); return u.pathname.split('/').pop() || u.hostname; } catch { return url.slice(0, 30); }
}

// ── Advanced Toggle ──
function toggleAdv(btn) {
  const pane = document.getElementById('adv-settings');
  const caret = btn.querySelector('.adv-caret');
  pane.classList.toggle('hidden');
  caret.classList.toggle('open');
}

// ── Build Quiz ──
function startQuiz() {
  if (!allQuestions.length) return;

  cfg = {
    count: parseInt(document.getElementById('q-count').value) || allQuestions.length,
    randQ: document.getElementById('rand-q').checked,
    randA: document.getElementById('rand-a').checked,
    timePerQ: parseInt(document.getElementById('time-per-q').value) || 30,
    marksPerQ: parseFloat(document.getElementById('marks-per-q').value) || 4,
    negPct: parseFloat(document.getElementById('neg-mark').value) / 100 || 0.25,
    allowSkip: document.getElementById('allow-skip').checked,
    allowBack: document.getElementById('allow-back').checked,
    showResult: document.getElementById('show-result').checked,
    showCorrect: document.getElementById('show-correct').checked,
  };

  let pool = [...allQuestions];
  if (cfg.randQ) pool = shuffle(pool);
  cfg.count = Math.min(cfg.count, pool.length);
  quizQuestions = pool.slice(0, cfg.count).map(q => {
    const opts = q.options.map((o, i) => ({ text: o, origIdx: i }));
    if (cfg.randA) shuffleInPlace(opts);
    const correctShuffled = opts.findIndex(o => o.origIdx === q.correct_option);
    return { question: q.question, topic: q._topic, options: opts, correctShuffled };
  });

  answers = new Array(cfg.count).fill(null);
  currentIdx = 0;
  score = 0;

  document.getElementById('setup-screen').style.display = 'none';
  document.getElementById('quiz-screen').style.display = 'block';
  renderQuestion();
  startGlobalTimer();
}

// ── Quiz Logic ──
function renderQuestion() {
  const q = quizQuestions[currentIdx];
  const total = quizQuestions.length;

  document.getElementById('quiz-progress').textContent = `Question ${currentIdx + 1} of ${total}`;
  document.getElementById('progress-fill').style.width = `${(currentIdx / total) * 100}%`;
  document.getElementById('q-topic').textContent = q.topic;
  document.getElementById('q-text').textContent = q.question;

  const optsCont = document.getElementById('q-options');
  optsCont.innerHTML = '';
  const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
  q.options.forEach((opt, i) => {
    const div = document.createElement('div');
    div.className = 'option';
    const saved = answers[currentIdx];
    if (saved !== null && saved === i) div.classList.add('selected');
    div.innerHTML = `<span class="opt-key">${keys[i]}</span><span class="opt-text">${opt.text}</span>`;
    div.addEventListener('click', () => selectOption(i));
    optsCont.appendChild(div);
  });

  document.getElementById('btn-back').style.display = (cfg.allowBack && currentIdx > 0) ? 'inline-flex' : 'none';
  document.getElementById('btn-skip').style.display = cfg.allowSkip ? 'inline-flex' : 'none';
  document.getElementById('btn-next').textContent = currentIdx === total - 1 ? 'Finish ✓' : 'Next →';

  updateLiveScore();
}

function selectOption(idx) {
  answers[currentIdx] = idx;
  document.querySelectorAll('.option').forEach((el, i) => {
    el.classList.toggle('selected', i === idx);
  });
}

function startGlobalTimer() {
  clearInterval(timerInterval);
  const totalSec = cfg.timePerQ * quizQuestions.length;
  timeLeft = totalSec;
  const fmt = s => `${Math.floor(s/60)}:${(s%60).toString().padStart(2,'0')}`;
  document.getElementById('timer-total').textContent = `of ${fmt(totalSec)}`;
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) { clearInterval(timerInterval); finishQuiz(); }
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('timer');
  const m = Math.floor(timeLeft / 60);
  const s = timeLeft % 60;
  el.textContent = `${m}:${(s).toString().padStart(2, '0')}`;
  const totalSec = cfg.timePerQ * quizQuestions.length;
  const pct = timeLeft / totalSec;
  el.className = 'timer' + (pct <= 0.1 ? ' danger' : pct <= 0.25 ? ' warn' : '');
}

function navNext() {
  if (currentIdx < quizQuestions.length - 1) { currentIdx++; renderQuestion(); }
  else finishQuiz();
}
function navBack() {
  if (!cfg.allowBack || currentIdx === 0) return;
  currentIdx--; renderQuestion();
}
function navSkip() {
  if (!cfg.allowSkip) return;
  navNext();
}

function updateLiveScore() {
  let s = 0;
  answers.forEach((a, i) => {
    if (a === null) return;
    if (quizQuestions[i] && a === quizQuestions[i].correctShuffled) s += cfg.marksPerQ;
    else s -= cfg.marksPerQ * cfg.negPct;
  });
  document.getElementById('live-score').textContent = `Score: ${s.toFixed(1)}`;
}

// ── Results ──
function finishQuiz() {
  clearInterval(timerInterval);
  if (!cfg.showResult) { restartToSetup(); return; }

  let correct = 0, wrong = 0, skipped = 0, rawScore = 0;
  answers.forEach((a, i) => {
    if (a === null) { skipped++; return; }
    if (a === quizQuestions[i].correctShuffled) { correct++; rawScore += cfg.marksPerQ; }
    else { wrong++; rawScore -= cfg.marksPerQ * cfg.negPct; }
  });

  const maxScore = quizQuestions.length * cfg.marksPerQ;
  const pct = maxScore > 0 ? Math.round((rawScore / maxScore) * 100) : 0;

  document.getElementById('quiz-screen').style.display = 'none';
  document.getElementById('result-screen').style.display = 'block';
  document.getElementById('res-score').textContent = rawScore.toFixed(1);
  document.getElementById('res-label').textContent = `out of ${maxScore.toFixed(1)} marks · ${pct}%`;

  const totalSec = cfg.timePerQ * quizQuestions.length;
  const usedSec = totalSec - timeLeft;
  const fmt = s => `${Math.floor(s/60)}m ${s%60}s`;
  const stats = [
    { key: 'Correct', val: correct, cls: 'pos' },
    { key: 'Wrong', val: wrong, cls: 'neg' },
    { key: 'Skipped', val: skipped, cls: '' },
    { key: 'Accuracy', val: correct + wrong > 0 ? Math.round(correct / (correct + wrong) * 100) + '%' : '—', cls: 'pos' },
    { key: 'Time Used', val: fmt(usedSec), cls: '' },
    { key: 'Time Left', val: fmt(Math.max(0, timeLeft)), cls: 'pos' },
  ];
  document.getElementById('res-stats').innerHTML = stats.map(s =>
    `<div class="result-stat ${s.cls}"><span class="val">${s.val}</span><span class="key">${s.key}</span></div>`
  ).join('');

  if (cfg.showCorrect) {
    const sec = document.getElementById('review-section');
    sec.classList.remove('hidden');
    const list = document.getElementById('review-list');
    list.innerHTML = quizQuestions.map((q, i) => {
      const a = answers[i];
      const corr = q.options[q.correctShuffled]?.text || '?';
      const isCorrect = a !== null && a === q.correctShuffled;
      const isSkip = a === null;
      let cls = isSkip ? 'skipped-q' : isCorrect ? 'correct-q' : 'wrong-q';
      let ansHtml = '';
      if (isSkip) ansHtml = `<span class="skip">Skipped</span><span class="correct-a">Correct: ${corr}</span>`;
      else if (isCorrect) ansHtml = `<span class="correct-match">✓ ${corr}</span>`;
      else ansHtml = `<span class="your">✗ ${q.options[a]?.text}</span><span class="correct-a">Correct: ${corr}</span>`;
      return `<div class="review-item ${cls}">
        <div class="review-q">${i + 1}. ${q.question}</div>
        <div class="review-ans">${ansHtml}</div>
      </div>`;
    }).join('');
  }
}

function restartToSetup() {
  clearInterval(timerInterval);
  document.getElementById('result-screen').style.display = 'none';
  document.getElementById('quiz-screen').style.display = 'none';
  document.getElementById('setup-screen').style.display = 'block';
  allQuestions = [];
  document.getElementById('params-card').style.display = 'none';
  document.getElementById('fetch-status').style.display = 'none';
  document.getElementById('loaded-info').classList.add('hidden');
}

// ── Helpers ──
function shuffle(arr) { return [...arr].sort(() => Math.random() - 0.5); }
function shuffleInPlace(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function showErr(id, msg) { const el = document.getElementById(id); el.textContent = msg; el.classList.remove('hidden'); }
function clearErr(id) { const el = document.getElementById(id); el.textContent = ''; el.classList.add('hidden'); }

// ── Init ──
addUrlRow('https://raw.githubusercontent.com/mrbhupesh1211/codes/refs/heads/main/pak.json');

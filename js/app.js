/* ============================================================
 * app.js - 出題ロジックと画面制御
 * ============================================================ */
(function () {
  'use strict';

  var KO = window.KO, NOUNS = window.DATA.NOUNS, PREDS = window.DATA.PREDS;
  var $ = function (id) { return document.getElementById(id); };

  /* ============================================================
   * ログ（イベント確認用・AIに渡しやすいようコピーボタン付き）
   * ============================================================ */
  var logLines = [];
  function log(msg, level) {
    var t = new Date().toTimeString().slice(0, 8);
    logLines.push('[' + t + '] ' + msg);
    var el = $('log');
    if (el) {
      var div = document.createElement('div');
      if (level) div.className = level;
      div.innerHTML = '<span class="t">' + t + '</span> ' + escapeHtml(msg);
      el.appendChild(div);
      el.scrollTop = el.scrollHeight;
      while (el.childNodes.length > 400) el.removeChild(el.firstChild);
    }
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  window.addEventListener('error', function (e) { log('JS ERROR: ' + e.message + ' @' + e.filename + ':' + e.lineno, 'err'); });

  /* ============================================================
   * ユーティリティ
   * ============================================================ */
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function uniq(a) {
    var seen = {}, out = [];
    a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
    return out;
  }
  function norm(s) { return String(s).replace(/\s+/g, ''); }
  function syllables(s) { return norm(s).split(''); }

  /* ============================================================
   * 効果音（WebAudio）
   * ============================================================ */
  var actx = null;
  function beep(type) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var seq = type === 'ok' ? [[660, 0], [990, 0.09]] : [[220, 0], [160, 0.11]];
      seq.forEach(function (n) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = type === 'ok' ? 'sine' : 'square';
        o.frequency.value = n[0];
        var t0 = actx.currentTime + n[1];
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
        o.connect(g); g.connect(actx.destination);
        o.start(t0); o.stop(t0 + 0.2);
      });
    } catch (e) { /* 音が出せない環境は無視 */ }
  }

  /* ============================================================
   * 設定・進捗の保存
   * ============================================================ */
  var OPT = { count: 15, scope: 'basic', speak: 'on', rate: 0.95, autoSpeak: 'on' };
  var SAVE = { xp: 0, lessons: 0, right: 0, total: 0 };
  function loadSave() {
    try {
      var s = JSON.parse(localStorage.getItem('hantore') || '{}');
      Object.keys(SAVE).forEach(function (k) { if (typeof s[k] === 'number') SAVE[k] = s[k]; });
      var o = JSON.parse(localStorage.getItem('hantore_opt') || '{}');
      Object.keys(OPT).forEach(function (k) { if (o[k] !== undefined) OPT[k] = o[k]; });
    } catch (e) { log('保存データの読み込みに失敗: ' + e.message, 'warn'); }
  }
  function persist() {
    try {
      localStorage.setItem('hantore', JSON.stringify(SAVE));
      localStorage.setItem('hantore_opt', JSON.stringify(OPT));
    } catch (e) { /* ignore */ }
  }
  function renderStats() {
    $('st-xp').textContent = SAVE.xp;
    $('st-lesson').textContent = SAVE.lessons;
    $('st-acc').textContent = SAVE.total ? Math.round(SAVE.right / SAVE.total * 100) + '%' : '-';
  }

  /* ============================================================
   * 音声設定の反映
   * ============================================================ */
  function applySpeech() {
    var on = OPT.speak !== 'off' && SPEECH.supported;
    SPEECH.enabled = on;
    SPEECH.rate = +OPT.rate || 0.95;
    document.body.classList.toggle('no-speak', !on);
  }
  function speakNow(text, btn) { if (text) SPEECH.speak(text, btn || null); }

  /* ============================================================
   * 出題（生成ロジックは js/quiz.js。管理画面のプレビューと共有している）
   * ============================================================ */
  /** 現在の設定＋デッキから QUIZ に渡すオプションを作る */
  function quizOpts(deck) {
    var o = { scope: OPT.scope };
    if (deck) {
      o.nouns = deck.nouns; o.preds = deck.preds; o.others = deck.others; o.meta = deck.meta;
      o.videoId = deck.videoId;
      o.scope = 'basic';        // デッキの用言は手作りの skip 情報が無いので基本5形に固定
    }
    return o;
  }
  function buildQueue(mode, n, deck) {
    return QUIZ.buildQueue(mode, n, quizOpts(deck));
  }
  /** 'deck:<videoId>:<コース>' を解釈する */
  function parseMode(mode) {
    var m = /^deck:([A-Za-z0-9_-]{11}):(.+)$/.exec(mode);
    if (!m) return { course: mode, deck: null };
    var deck = window.DECKS ? DECKS.pool(m[1]) : null;
    return { course: m[2], deck: deck };
  }

  /* ============================================================
   * レッスンの状態
   * ============================================================ */
  var S = null;

  function startLesson(mode) {
    var pm = parseMode(mode);
    S = {
      mode: mode, deck: pm.deck, queue: buildQueue(pm.course, OPT.count, pm.deck), idx: 0,
      total: OPT.count,
      right: 0, asked: 0, combo: 0, bestCombo: 0,
      wrong: [], selected: null, bank: [], answered: false, requeued: 0
    };
    show('lesson');
    log('レッスン開始: mode=' + pm.course + (pm.deck ? '（動画: ' + pm.deck.title + '）' : '') +
      ' / ' + OPT.count + '問 / 活用範囲=' + quizOpts(pm.deck).scope);
    renderQuestion();
  }

  /** 動画のその単語が出てくる位置へのリンク（デッキ由来の問題だけ） */
  function seekLinks(q) {
    if (!q.seek || !q.seek.at || !q.seek.at.length) return '';
    var links = q.seek.at.map(function (ms) {
      var sec = Math.max(0, Math.floor((ms || 0) / 1000) - 1);   // 1秒手前から再生する
      var label = Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
      return '<a class="seek" target="_blank" rel="noopener" href="https://www.youtube.com/watch?v=' +
        encodeURIComponent(q.seek.v) + '&t=' + sec + 's">▶ ' + label + '</a>';
    }).join('');
    return '<div class="seek-row"><span>動画で聞く</span>' + links + '</div>';
  }

  /** 進捗カウンタ（何問目 / 全問）と連続正解 */
  function renderCounter() {
    $('counter').innerHTML =
      '<b>' + (S.idx + 1) + '</b> / ' + S.queue.length +
      (S.combo >= 2 ? '<span class="combo">🔥' + S.combo + '</span>' : '');
  }

  function renderQuestion() {
    var q = S.queue[S.idx];
    S.selected = null; S.bank = []; S.answered = false;

    $('bar').style.width = Math.round(S.idx / S.queue.length * 100) + '%';
    renderCounter();
    $('q-title').textContent = q.title;

    var mascot = q.kind === 'bank' ? '🧩' : (q.kind === 'listen' ? '👂' : '🦉');
    var head = q.kind === 'listen'
      ? '<div class="word listen-word">' + SPEECH.btn(q.speakTarget, 'big') +
        '<span>音声を聞いてハングルを組み立てよう</span></div>'
      : '<div class="word">' + escapeHtml(q.word_main) + SPEECH.btn(q.word_main) + '</div>';
    var html = '<div class="bubble-row">' +
      '<div class="mascot">' + mascot + '</div>' +
      '<div class="bubble">' + head +
      (q.word_sub ? '<div class="sub">' + escapeHtml(q.word_sub) + '</div>' : '') +
      (q.tag ? '<div class="tag">' + escapeHtml(q.tag) + '</div>' : '') +
      '</div></div>';

    if (q.kind === 'mc') {
      html += '<div class="choices' + (q.longChoices ? ' long' : '') + '" id="choices">';
      q.choices.forEach(function (c, i) {
        html += '<div class="choice" role="button" tabindex="0" data-i="' + i + '">' +
          '<span class="num">' + (i + 1) + '</span>' +
          '<span class="ctext"><span>' + escapeHtml(c) + '</span></span>' +
          SPEECH.btn(c, 'sm') + '</div>';
      });
      html += '</div>';
    } else {
      html += '<div class="hint-mini">' +
        (q.kind === 'listen' ? '聞こえたとおりに音節を並べよう' : 'タイルを並べて正しい形を作ろう') + '</div>' +
        '<div class="answer-line" id="answer-line"></div>' +
        '<div class="answer-line-actions" id="bank-actions"></div>' +
        '<div class="bank" id="bank"></div>';
    }
    $('q-body').innerHTML = html;

    if (q.kind === 'mc') {
      Array.prototype.forEach.call($('q-body').querySelectorAll('.choice'), function (b) {
        b.addEventListener('click', function () { selectChoice(+b.dataset.i); });
      });
    } else {
      renderBank();
    }
    resetFooter();
    var autoTarget = q.speakTarget || q.word_main;
    if (SPEECH.isKorean(autoTarget) && (OPT.autoSpeak !== 'off' || q.kind === 'listen')) {
      setTimeout(function () { speakNow(autoTarget); }, 250);   // 聞き取り問題は設定に関わらず再生する
    }
    log('Q' + (S.idx + 1) + '/' + S.queue.length + ' [' + q.kind + '] ' + q.word_main +
      (q.form ? ' → ' + q.form.label : '') + ' / 正解: ' + q.answer);
  }

  function selectChoice(i) {
    if (S.answered) return;
    S.selected = i;
    Array.prototype.forEach.call($('q-body').querySelectorAll('.choice'), function (b) {
      b.classList.toggle('sel', +b.dataset.i === i);
    });
    $('btn-main').disabled = false;
    log('選択: ' + S.queue[S.idx].choices[i]);
  }

  function renderBank() {
    var q = S.queue[S.idx];
    var line = $('answer-line'), bank = $('bank');
    line.innerHTML = ''; bank.innerHTML = '';
    var built = S.bank.map(function (t) { return t.ch; }).join('');
    S.bank.forEach(function (t, i) {
      var b = document.createElement('button');
      b.className = 'tile'; b.textContent = t.ch;
      b.addEventListener('click', function () {
        if (S.answered) return;
        S.bank.splice(i, 1); renderBank();
        log('タイルを戻す: ' + t.ch);
      });
      line.appendChild(b);
    });
    var act = $('bank-actions');
    if (act) act.innerHTML = built ? SPEECH.btn(built) +
      '<span style="font-size:12px;color:#afafaf;font-weight:700">組み立てた形を聞く</span>' : '';
    q.tiles.forEach(function (ch, i) {
      var used = S.bank.some(function (t) { return t.i === i; });
      var b = document.createElement('button');
      b.className = 'tile' + (used ? ' used' : '');
      b.textContent = ch;
      b.addEventListener('click', function () {
        if (S.answered || used) return;
        S.bank.push({ i: i, ch: ch }); renderBank();
        log('タイル選択: ' + ch + ' → ' + S.bank.map(function (t) { return t.ch; }).join(''));
      });
      bank.appendChild(b);
    });
    $('btn-main').disabled = S.bank.length === 0;
  }

  function resetFooter() {
    var f = $('footer');
    f.classList.remove('ok', 'ng');
    $('footer-spacer').style.display = '';
    $('btn-main').textContent = 'チェック';
    $('btn-main').disabled = true;
    $('btn-main').dataset.act = 'check';
  }

  function check() {
    var q = S.queue[S.idx], given, correct;
    if (q.kind === 'mc') {
      if (S.selected === null) return;
      given = q.choices[S.selected];
      correct = norm(given) === norm(q.answer);
    } else {
      given = S.bank.map(function (t) { return t.ch; }).join('');
      correct = norm(given) === norm(q.answer);
    }
    S.answered = true;
    S.asked++;
    SAVE.total++;

    if (correct) {
      S.right++; SAVE.right++; S.combo++;
      S.bestCombo = Math.max(S.bestCombo, S.combo);
      beep('ok');
    } else {
      S.combo = 0;
      S.wrong.push(q);
      if (S.requeued < 4) {                    // 間違えた問題は最後にもう一度
        S.queue.push(q); S.requeued++;
      }
      beep('ng');
    }
    log((correct ? '✅ 正解' : '❌ 不正解') + ' 回答=「' + given + '」 正解=「' + q.answer + '」',
      correct ? null : 'warn');

    // 表示更新
    if (q.kind === 'mc') {
      Array.prototype.forEach.call($('q-body').querySelectorAll('.choice'), function (b) {
        var i = +b.dataset.i;
        b.classList.add('disabled');
        b.classList.remove('sel');
        if (norm(q.choices[i]) === norm(q.answer)) b.classList.add('ok');
        else if (i === S.selected) b.classList.add('ng');
        // 選ばなかった選択肢が何だったのかも見せる
        var note = q.choiceInfo && q.choiceInfo[q.choices[i]];
        var box = b.querySelector('.ctext');
        if (note && box && !box.querySelector('.note')) {
          box.insertAdjacentHTML('beforeend',
            '<span class="note">' + escapeHtml(note) + SPEECH.btn(note, 'sm') + '</span>');
        }
      });
    } else {
      Array.prototype.forEach.call($('answer-line').querySelectorAll('.tile'), function (b) {
        b.classList.add(correct ? 'ok' : 'ng');
      });
    }
    renderCounter();

    var f = $('footer');
    f.classList.add(correct ? 'ok' : 'ng');
    var spoken = q.speakTarget || (SPEECH.isKorean(q.answer) ? q.answer
      : (SPEECH.isKorean(q.word_main) ? q.word_main : q.word.ko));
    $('verdict-head').innerHTML = (correct ? '✅ 正解！' : '❌ 正解はこちら') + SPEECH.btn(spoken);
    $('verdict-detail').innerHTML = (correct
      ? escapeHtml(q.explain)
      : '<b>' + escapeHtml(q.answer) + '</b>' + SPEECH.btn(q.answer, 'sm') + '<br>' + escapeHtml(q.explain))
      + seekLinks(q);
    if (!correct && OPT.autoSpeak !== 'off') setTimeout(function () { speakNow(spoken); }, 150);
    $('footer-spacer').style.display = 'none';
    $('btn-main').textContent = 'つづける';
    $('btn-main').disabled = false;
    $('btn-main').dataset.act = 'next';
    if (S.idx >= S.queue.length - 1) $('btn-main').textContent = '結果を見る';
    persist();
  }

  function next() {
    S.idx++;
    if (S.idx >= S.queue.length) { finish(true); return; }
    renderQuestion();
  }

  function finish(cleared) {
    var acc = S.asked ? Math.round(S.right / S.asked * 100) : 0;
    var xp = cleared ? (10 + S.right * 2 + (acc === 100 ? 10 : 0)) : S.right;
    SAVE.xp += xp;
    if (cleared) SAVE.lessons++;
    persist(); renderStats();

    $('res-emoji').textContent = cleared ? (acc === 100 ? '🏆' : '🎉') : '👋';
    $('res-title').textContent = cleared ? 'レッスン完了！' : 'ここまでの結果';
    $('res-title').className = cleared ? '' : 'ng';
    $('res-sub').textContent = cleared
      ? (acc === 100 ? 'パーフェクト！すごい！' : 'おつかれさま！この調子で続けよう')
      : '途中でやめました。続きはいつでもどうぞ';
    $('res-xp').textContent = '+' + xp;
    $('res-acc').textContent = acc + '%';
    $('res-combo').textContent = S.bestCombo;

    var seen = {}, items = [];
    S.wrong.forEach(function (q) {
      var key = q.word.ko + '|' + (q.form ? q.form.key : q.answer);
      if (seen[key]) return; seen[key] = 1;
      var sp = q.speakTarget || (SPEECH.isKorean(q.answer) ? q.answer
        : (SPEECH.isKorean(q.word_main) ? q.word_main : q.word.ko));
      var headword = SPEECH.isKorean(q.answer) ? q.answer
        : (q.kind === 'listen' ? q.answer : q.word_main + ' → ' + q.answer);
      items.push('<div class="review-item"><b>' + escapeHtml(headword) + '</b> ' +
        SPEECH.btn(sp, 'sm') + ' <span class="ja">' + escapeHtml(q.explain) + '</span>' +
        seekLinks(q) + '</div>');
    });
    $('res-review').innerHTML = items.length
      ? '<h3>復習しよう（' + items.length + '）</h3>' + items.join('')
      : '';
    show('result');
    log('レッスン終了: 正解 ' + S.right + '/' + S.asked + ' (' + acc + '%) XP+' + xp);
  }

  /* ============================================================
   * 動画から作ったデッキ（ホーム画面）
   * ============================================================ */
  function fmtDur(sec) {
    sec = Math.round(sec || 0);
    return sec ? Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2) : '';
  }
  function renderDecks() {
    var box = $('deck-list');
    if (!box || !window.DECKS) return;
    var items = DECKS.list();
    if (!items.length) {
      log('動画デッキ: 0件');
      box.innerHTML = '<div class="deck-empty">' + (document.body.classList.contains('no-admin')
        ? 'ここには動画から作ったデッキが並びます。作るには手元で <code>uv run server.py</code> を起動して' +
          ' 問題作成管理画面（admin.html）を開いてください。'
        : 'まだ動画デッキがありません。<a href="admin.html">📺 問題作成管理画面</a> で YouTube の URL を' +
          '指定すると、字幕に出てきた単語だけのレッスンが作れます。') + '</div>';
      return;
    }
    box.innerHTML = items.map(function (it) {
      var p = DECKS.pool(it.id) || { nouns: [], preds: [], others: [] };
      var btns = DECKS.courses(it.id).map(function (c) {
        return '<button class="deck-course' + (c.ok ? '' : ' off') + '"' +
          (c.ok ? ' data-mode="deck:' + it.id + ':' + c.mode + '"' : ' disabled') +
          ' title="' + (c.ok ? '' : '語が足りません（' + c.count + '語）') + '">' +
          escapeHtml(c.label) + '<span class="n">' + c.count + '</span></button>';
      }).join('');
      return '<div class="deck-card">' +
        '<div class="deck-head">' +
        '<span class="ic">📺</span>' +
        '<div class="tt"><strong><a class="deck-title" target="_blank" rel="noopener" ' +
        'title="YouTube で開く" href="https://www.youtube.com/watch?v=' + encodeURIComponent(it.id) + '">' +
        '<span class="yt">▶</span>' + escapeHtml(it.title) + '</a></strong>' +
        '<span>' + (p.nouns.length + p.preds.length + p.others.length) + '語（名詞 ' + p.nouns.length +
        ' / 用言 ' + p.preds.length + (p.others.length ? ' / 副詞など ' + p.others.length : '') + '）' +
        (it.unknown ? '・辞書外 ' + it.unknown + '語' : '') +
        (it.durationSec ? '・' + fmtDur(it.durationSec) : '') + '</span></div>' +
        '<a class="deck-edit" href="admin.html?v=' + it.id + '" title="管理画面で編集">✎</a>' +
        '</div><div class="deck-courses">' + btns + '</div></div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.deck-course[data-mode]'), function (b) {
      b.addEventListener('click', function () { startLesson(b.dataset.mode); });
    });
    log('動画デッキ ' + items.length + '件を読み込みました');
  }

  /* ============================================================
   * 活用表
   * ============================================================ */
  function renderTable(filter) {
    filter = (filter || '').trim();
    var list = PREDS.filter(function (w) {
      return !filter || w.ko.indexOf(filter) >= 0 || w.ja.indexOf(filter) >= 0;
    });
    $('tv-list').innerHTML = list.map(function (w) {
      var rows = KO.table(w).map(function (r) {
        return '<tr><th>' + escapeHtml(r.label) + '</th><td><div class="cellwrap">' +
          escapeHtml(r.value) + SPEECH.btn(r.value, 'sm') + '</div></td></tr>';
      }).join('');
      var cls = w.type === 'verb' ? 'v' : 'a';
      return '<details class="tv-word"><summary>' + escapeHtml(w.ko) + SPEECH.btn(w.ko, 'sm') +
        ' <span class="ja">' + escapeHtml(w.ja) + '</span>' +
        '<span class="badge ' + cls + '">' + (w.type === 'verb' ? '動詞' : '形容詞') + '</span>' +
        '<span class="badge">' + escapeHtml(KO.irrLabel(w)) + '</span></summary>' +
        '<table class="tv-table">' + rows + '</table></details>';
    }).join('') || '<p style="color:#afafaf;font-weight:700">見つかりませんでした</p>';
  }

  /* ============================================================
   * 画面遷移
   * ============================================================ */
  function show(id) {
    ['home', 'lesson', 'result', 'tableview'].forEach(function (s) {
      $(s).classList.toggle('active', s === id);
    });
    log('画面: ' + id);
  }

  /* ============================================================
   * イベント登録
   * ============================================================ */
  function init() {
    loadSave(); renderStats();

    // 読み上げボタンはキャプチャ段階で処理する
    //（選択肢や <summary> の中にあっても、選択・開閉を発生させない）
    document.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.spk') : null;
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      SPEECH.speak(b.dataset.speak, b);
    }, true);

    SPEECH.onlog = log;
    SPEECH.init();
    applySpeech();
    if (!SPEECH.supported) log('読み上げ非対応のブラウザです（🔊 ボタンは非表示）', 'warn');

    // 設定チップの反映
    Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
      if (String(OPT[c.dataset.opt]) === c.dataset.val) {
        Array.prototype.forEach.call(document.querySelectorAll('.chip[data-opt="' + c.dataset.opt + '"]'),
          function (o) { o.classList.remove('on'); });
        c.classList.add('on');
      }
      c.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.chip[data-opt="' + c.dataset.opt + '"]'),
          function (o) { o.classList.remove('on'); });
        c.classList.add('on');
        var v = c.dataset.val;
        OPT[c.dataset.opt] = /^-?\d+(\.\d+)?$/.test(v) ? +v : v;
        applySpeech();
        persist();
        log('設定変更: ' + c.dataset.opt + ' = ' + v);
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.mode-card'), function (b) {
      b.addEventListener('click', function () { startLesson(b.dataset.mode); });
    });

    $('btn-main').addEventListener('click', function () {
      if ($('btn-main').dataset.act === 'check') check(); else next();
    });
    $('btn-quit').addEventListener('click', function () {
      if (S && S.asked > 0) { finish(false); } else { show('home'); }
      log('レッスン中断');
    });
    $('btn-again').addEventListener('click', function () { startLesson(S ? S.mode : 'mix'); });
    $('btn-home').addEventListener('click', function () { renderStats(); show('home'); });
    $('btn-table').addEventListener('click', function () { renderTable(''); show('tableview'); });
    $('btn-tv-close').addEventListener('click', function () { show('home'); });
    $('tv-search').addEventListener('input', function () { renderTable(this.value); });

    // キーボード操作
    document.addEventListener('keydown', function (e) {
      if (!$('lesson').classList.contains('active')) return;
      if (e.key >= '1' && e.key <= '4') {
        var q = S.queue[S.idx], i = +e.key - 1;
        if (q.kind === 'mc' && !S.answered && i < q.choices.length) { selectChoice(i); e.preventDefault(); }
      } else if (e.key === 'Enter' || e.key === ' ') {
        if (!$('btn-main').disabled) { $('btn-main').click(); e.preventDefault(); }
      } else if (e.key === 'Backspace') {
        var q2 = S.queue[S.idx];
        if (q2.kind !== 'mc' && !S.answered && S.bank.length) { S.bank.pop(); renderBank(); e.preventDefault(); }
      }
    });

    // ログパネル
    $('log-copy').addEventListener('click', function () {
      var text = logLines.join('\n');
      var done = function () {
        $('log-copy').textContent = 'COPIED!';
        setTimeout(function () { $('log-copy').textContent = 'COPY'; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, fallback);
      } else fallback();
      function fallback() {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { log('コピー失敗: ' + e.message, 'err'); }
        document.body.removeChild(ta);
      }
    });
    $('log-clear').addEventListener('click', function () { logLines = []; $('log').innerHTML = ''; });
    $('log-toggle').addEventListener('click', function () {
      $('logpanel').classList.toggle('collapsed');
      $('log-toggle').textContent = $('logpanel').classList.contains('collapsed') ? '▲' : '_';
    });

    log('起動しました（名詞 ' + NOUNS.length + '語 / 動詞・形容詞 ' + PREDS.length + '語）');

    // 管理画面はローカルサーバー（uv run server.py）専用。
    // API が無い環境（GitHub Pages など）ではリンクを出さない
    fetch('api/decks', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function () {
        document.body.classList.remove('no-admin');
        log('ローカルサーバーで動作中（問題作成管理画面が使えます）');
      }, function () {
        log('静的配信で動作中（問題を解く機能のみ。管理画面はローカル専用）');
      });

    // 動画デッキ（decks/index.json）を読み込む。無くても学習アプリは動く
    if (window.DECKS) {
      DECKS.init().then(renderDecks, function (e) {
        log('動画デッキはまだありません（' + e.message + '）');
        renderDecks();
      });
    }
  }

  // デバッグ用フック（コンソールから出題ロジックを直接叩ける）
  //   出題の生成そのものは window.QUIZ を直接使う
  window.HT = {
    buildQueue: buildQueue, quizOpts: quizOpts, parseMode: parseMode,
    startLesson: startLesson, renderDecks: renderDecks,
    OPT: OPT, log: log, speak: speakNow,
    state: function () { return S; }
  };

  document.addEventListener('DOMContentLoaded', init);
})();

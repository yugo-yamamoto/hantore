/* ============================================================
 * admin.js - 問題作成管理画面
 *   URL → 字幕取得(SSE) → 単語抽出 → 採否 → 問題プレビュー → 保存
 * ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var IDX = null;                 // 逆引き索引（初回に作る）
  var ST = { caps: null, words: [], unknown: [], stats: null, filter: 'on', pv: 'mix' };

  /* ---------- ログ（学習アプリと同じ作り） ---------- */
  var logLines = [];
  function log(msg, level) {
    var t = new Date().toTimeString().slice(0, 8);
    logLines.push('[' + t + '] ' + msg);
    var el = $('log');
    var div = document.createElement('div');
    if (level) div.className = level;
    div.innerHTML = '<span class="t">' + t + '</span> ' + esc(msg);
    el.appendChild(div);
    el.scrollTop = el.scrollHeight;
    while (el.childNodes.length > 400) el.removeChild(el.firstChild);
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  window.addEventListener('error', function (e) {
    log('JS ERROR: ' + e.message + ' @' + e.filename + ':' + e.lineno, 'err');
  });

  function fmtDur(sec) {
    sec = Math.round(sec || 0);
    return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
  }
  function ytLink(t) {
    var sec = Math.floor((t || 0) / 1000);
    return 'https://www.youtube.com/watch?v=' + ST.caps.id + '&t=' + sec + 's';
  }

  /* ============================================================
   * 字幕の取得（SSE）
   * ============================================================ */
  function fetchSubs() {
    var url = $('url').value.trim();
    if (!url) { log('URL を入力してください', 'warn'); return; }
    var q = 'url=' + encodeURIComponent(url) + ($('refresh').checked ? '&refresh=1' : '');
    $('btn-fetch').disabled = true;
    $('fetch-note').classList.remove('err');
    $('fetch-note').textContent = '取得中… （初回は10〜30秒かかります）';
    log('字幕を取得します: ' + url);

    var es = new EventSource('/api/subtitles?' + q);
    es.addEventListener('log', function (ev) { log('sv: ' + JSON.parse(ev.data).msg); });
    es.addEventListener('error', function (ev) {
      if (!ev.data) return;                       // 接続切れは onerror で処理
      var d = JSON.parse(ev.data);
      es.close();
      $('btn-fetch').disabled = false;
      $('fetch-note').classList.add('err');
      $('fetch-note').textContent = '✕ ' + d.msg + (d.hint ? '　（' + d.hint + '）' : '');
      log('取得失敗: ' + d.msg, 'err');
    });
    es.addEventListener('result', function (ev) {
      es.close();
      $('btn-fetch').disabled = false;
      $('fetch-note').textContent = '取得できました。下の一覧で出題する単語を確認してください。';
      onSubtitles(JSON.parse(ev.data));
    });
    es.onerror = function () {
      es.close();
      $('btn-fetch').disabled = false;
      log('サーバーとの接続が切れました（uv run server.py で起動していますか？）', 'err');
    };
  }

  /* ============================================================
   * 抽出
   * ============================================================ */
  function onSubtitles(caps) {
    ST.caps = caps;
    if (!IDX) {
      IDX = EXTRACT.buildIndex();
      log('逆引き索引: 名詞 ' + IDX.noun.size + ' / 用言14形 ' + IDX.form.size + ' / 拡張語尾 ' + IDX.ext.size);
    }
    var r = EXTRACT.run(caps.lines, IDX);
    ST.words = r.words; ST.unknown = r.unknown; ST.stats = r.stats;
    log('抽出: 既知語 ' + r.words.length + '語（名詞 ' + r.stats.nouns + ' / 用言 ' + r.stats.preds +
      '）・辞書外 ' + r.unknown.length + '語・カバー率 ' + (r.stats.coverage * 100).toFixed(1) + '%');
    renderInfo(); renderWords(); renderUnknown(); renderPreview();
    ['info-card', 'words-card', 'unknown-card', 'preview-card', 'save-card'].forEach(function (id) {
      $(id).hidden = false;
    });
  }

  function renderInfo() {
    var c = ST.caps, s = c.captions;
    $('v-title').innerHTML = '<a href="' + esc(c.source.url || ('https://www.youtube.com/watch?v=' + c.id)) +
      '" target="_blank" rel="noopener">' + esc(c.source.title) + ' ▶</a>';
    $('v-meta').textContent = [c.source.channel, fmtDur(c.source.durationSec),
      c.id].filter(Boolean).join('　・　');
    $('v-badges').innerHTML =
      '<span class="bdg ' + (s.manual ? 'good' : 'warn') + '">' +
      (s.manual ? '手動字幕（高品質）' : '自動字幕（誤認識の可能性あり）') + '</span>' +
      '<span class="bdg ' + (s.jaTrack ? 'info' : '') + '">' +
      (s.jaTrack ? '日本語訳あり（自動翻訳）' : '日本語訳なし') + '</span>' +
      '<span class="bdg">ハングル ' + Math.round(s.hangulRatio * 100) + '%</span>';
    var st = ST.stats;
    var quiz = ST.words.filter(function (w) { return w.include; }).length;
    var cov = st.coverage * 100;

    // 主指標は「この動画で練習できる語数」。カバー率は補助指標として内訳つきで見せる
    var stats = [
      ['この動画で練習できる語', quiz + '語', 'main'],
      ['名詞', st.nouns + '語', ''], ['動詞・形容詞', st.preds + '語', ''],
      ['副詞・代名詞など', st.others + '語', ''],
      ['字幕', st.lines + '行 / ' + st.tokens + '語', ''],
      ['辞書でわかる割合', cov.toFixed(1) + '%', '']
    ];
    $('v-stats').innerHTML = stats.map(function (p) {
      return '<div class="ad-stat' + (p[2] ? ' main' : '') + '"><b>' + p[1] + '</b><span>' + p[0] + '</span></div>';
    }).join('') + verdict(quiz, cov, st);
  }

  /** カバー率の意味と、その動画が語彙的に向いているかを説明する */
  function verdict(quiz, cov, st) {
    var msgs = [], cls = 'ok';
    if (quiz >= 100) msgs.push('練習できる語が' + quiz + '語あります。十分レッスンが作れます。');
    else if (quiz >= 30) msgs.push('練習できる語は' + quiz + '語です。短めのレッスンなら作れます。');
    else { cls = 'warn'; msgs.push('練習できる語が' + quiz + '語しかありません。別の動画のほうが向いています。'); }

    if (cov < 40) {
      cls = cls === 'ok' ? 'warn' : cls;
      msgs.push('字幕の' + (100 - cov).toFixed(0) + '%は辞書に無い語です。' +
        '専門用語・固有名詞・くだけた言い回しが多い動画だと、この割合は下がります。');
    }
    if (st.unknownOnceRatio > 0.7) {
      msgs.push('辞書外の語の' + (st.unknownOnceRatio * 100).toFixed(0) +
        '%は動画中に1回しか出てきません（覚える価値が低い語）。');
    }
    msgs.push('※「辞書でわかる割合」は字幕の単語のうち辞書に載っている割合です。' +
      '低くても、練習できる語数が足りていればレッスンは作れます。');
    return '<div class="ad-verdict ' + cls + '">' + msgs.map(function (m) {
      return '<div>' + esc(m) + '</div>';
    }).join('') + '</div>';
  }

  function typeTag(w) {
    if (typeof w === 'string') w = { type: w };
    return w.pos || (w.type === 'noun' ? '名詞' : (w.type === 'verb' ? '動詞' : '形容詞'));
  }

  function renderWords() {
    var f = ST.filter;
    var list = ST.words.filter(function (w) {
      return f === 'all' || (f === 'on' && w.include) ||
        (f === 'check' && w.needsCheck) || (f === 'off' && !w.include);
    });
    var on = ST.words.filter(function (w) { return w.include; }).length;
    $('w-count').textContent = '出題 ' + on + ' / 検出 ' + ST.words.length;
    $('w-list').innerHTML = list.map(function (w, i) {
      var surfaces = Object.keys(w.surfaces).map(function (s) {
        return s + '(' + w.surfaces[s] + ')';
      }).join('　');
      var forms = Object.keys(w.forms).map(function (k) {
        return (KO.FORM_MAP[k] || {}).label || k;
      }).concat(Object.keys(w.exts)).join('・');
      var lines = ST.caps.lines || [];
      var ex = (w.ex || []).slice(0, 2).map(function (li) {
        var l = lines[li];
        if (!l) return '';
        return '<div>' + esc(l.ko) + SPEECH.btn(l.ko, 'sm') +
          '<a href="' + ytLink(l.t) + '" target="_blank">▶ ' + fmtDur(l.t / 1000) + '</a>' +
          (l.ja ? '<br><span class="jat">' + esc(l.ja) + '</span>' : '') + '</div>';
      }).join('');
      return '<label class="ad-item' + (w.include ? '' : ' excluded') + (w.needsCheck ? ' check' : '') + '">' +
        '<input type="checkbox" data-ko="' + esc(w.ko) + '"' + (w.include ? ' checked' : '') + '>' +
        '<div class="body">' +
        '<div><span class="ko">' + esc(w.ko) + '</span>' + SPEECH.btn(w.ko, 'sm') +
        '<span class="ja">' + esc(w.ja) + '</span></div>' +
        '<div class="tags"><span class="bdg">' + typeTag(w) + '</span>' +
        '<span class="bdg">' + w.count + '回</span>' +
        (w.needsCheck ? '<span class="bdg warn">⚠ 要確認' +
          (w.ambiguous ? '（同じ綴りの語あり）' : '（拡張語尾でのみ検出）') + '</span>' : '') +
        (w.weak ? '<span class="bdg">索引専用（出題しない）</span>' : '') +
        '</div>' +
        '<div class="meta">出た形: ' + esc(surfaces) + (forms ? '　／　' + esc(forms) : '') + '</div>' +
        (ex ? '<div class="ex">' + ex + '</div>' : '') +
        '</div></label>';
    }).join('') || '<div class="ad-note">該当する語がありません</div>';

    Array.prototype.forEach.call($('w-list').querySelectorAll('input[type=checkbox]'), function (cb) {
      cb.addEventListener('change', function () {
        var w = ST.words.filter(function (x) { return x.ko === cb.dataset.ko; })[0];
        if (!w) return;
        w.include = cb.checked;
        log((cb.checked ? '出題する: ' : '除外: ') + w.ko);
        cb.closest('.ad-item').classList.toggle('excluded', !cb.checked);
        renderCount(); renderPreview();
      });
    });
  }
  function renderCount() {
    var on = ST.words.filter(function (w) { return w.include; }).length;
    $('w-count').textContent = '出題 ' + on + ' / 検出 ' + ST.words.length;
  }

  function renderUnknown() {
    var once = ST.unknown.filter(function (u) { return u.count === 1; }).length;
    $('u-count').textContent = ST.unknown.length + '語（1回だけ ' +
      (ST.unknown.length ? Math.round(once / ST.unknown.length * 100) : 0) + '%）';
    $('u-list').innerHTML = ST.unknown.slice(0, 80).map(function (u) {
      return '<span class="ad-tag">' + esc(u.ko) + '<i>×' + u.count + '</i></span>';
    }).join('');
  }

  /* ============================================================
   * 問題プレビュー（学習アプリと同じ js/quiz.js を使う）
   * ============================================================ */
  function pool() {
    var nouns = [], preds = [], others = [], meta = {};
    ST.words.forEach(function (w) {
      if (!w.include) return;
      var d = DECK_WORD(w.ko);
      if (!d || d.weak) return;
      (d.type === 'noun' ? nouns : (d.type === 'other' ? others : preds)).push(d);
      meta[d.ko] = {
        forms: w.forms,
        at: w.at || [],
        ex: (w.ex || []).map(function (i) { return (ST.caps.lines || [])[i]; }).filter(Boolean)
      };
    });
    return { nouns: nouns, preds: preds, others: others, meta: meta,
             videoId: ST.caps && ST.caps.id, scope: 'basic' };
  }
  var BY_KO = {};
  DATA.NOUNS.concat(DATA.PREDS, DATA.OTHERS || []).forEach(function (w) { BY_KO[w.ko] = w; });
  function DECK_WORD(ko) { return BY_KO[ko]; }

  function renderPreview() {
    var p = pool();
    if (!p.nouns.length && !p.preds.length && !p.others.length) {
      $('pv-list').innerHTML = '<div class="ad-note">出題する単語がありません</div>';
      return;
    }
    var qs;
    try {
      qs = QUIZ.buildQueue(ST.pv, 5, p);
    } catch (e) {
      $('pv-list').innerHTML = '<div class="ad-note err">プレビューの生成に失敗: ' + esc(e.message) + '</div>';
      log('プレビュー生成に失敗: ' + e.message, 'err');
      return;
    }
    $('pv-list').innerHTML = qs.map(function (q) {
      var head = q.kind === 'listen'
        ? '🔊 <span class="k">' + esc(q.answer) + '</span> を聞いて綴る'
        : '<span class="k">' + esc(q.word_main) + '</span>' + (q.tag ? '　→　' + esc(q.tag) : '');
      var body = q.kind === 'mc'
        ? '<div class="cs">' + q.choices.map(function (c) {
            return '<span class="c' + (c === q.answer ? ' ok' : '') + '">' + esc(c) + '</span>';
          }).join('') + '</div>'
        : '<div class="cs">' + q.tiles.map(function (t) {
            return '<span class="c">' + esc(t) + '</span>';
          }).join('') + '<span class="c ok">＝ ' + esc(q.answer) + '</span></div>';
      return '<div class="pv-item"><div class="q">[' + q.title + '] ' + head + '</div>' +
        body + '<div class="ex">' + esc(q.explain) + '</div></div>';
    }).join('');
  }

  /* ============================================================
   * 保存とデッキ一覧
   * ============================================================ */
  function deckJSON() {
    var c = ST.caps;
    return {
      schema: 1, id: c.id, source: c.source, captions: c.captions,
      generated: Object.assign({}, c.generated, {
        coverage: +(ST.stats.coverage.toFixed(3)),
        tokens: ST.stats.tokens, savedAt: new Date().toISOString()
      }),
      lines: c.lines,
      words: ST.words.map(function (w) {
        return {
          ko: w.ko, count: w.count, surfaces: w.surfaces, forms: w.forms,
          ex: w.ex, at: w.at || [], include: !!w.include, needsCheck: !!w.needsCheck
        };
      }),
      unknown: ST.unknown.slice(0, 200)
    };
  }

  function save() {
    var d = deckJSON();
    $('btn-save').disabled = true;
    fetch('/api/decks/' + d.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(d)
    }).then(function (r) { return r.json(); }).then(function (res) {
      $('btn-save').disabled = false;
      if (res.error) throw new Error(res.error);
      var on = d.words.filter(function (w) { return w.include; }).length;
      $('save-note').textContent = '✓ decks/' + d.id + '.json に保存しました（出題 ' + on + '語）' +
        (d.lines && d.lines.length ? '　字幕本文は decks/lines/ に分けて保存（公開対象外）' : '');
      log('保存しました: decks/' + d.id + '.json（出題 ' + on + '語）');
      renderDecks(res.index);
    }).catch(function (e) {
      $('btn-save').disabled = false;
      $('save-note').textContent = '✕ 保存に失敗: ' + e.message;
      log('保存に失敗: ' + e.message, 'err');
    });
  }

  function renderDecks(index) {
    $('d-count').textContent = index.length + '件';
    $('d-list').innerHTML = index.map(function (it) {
      return '<div class="ad-item dk-item"><div class="body">' +
        '<div><span class="ko" style="font-size:15px">' + esc(it.title) + '</span></div>' +
        '<div class="meta">' + it.id + '　・　出題 ' + it.words + '語　・　辞書外 ' + it.unknown + '語' +
        (it.durationSec ? '　・　' + fmtDur(it.durationSec) : '') + '</div>' +
        '</div><div class="btns">' +
        '<button class="btn ghost small" data-open="' + it.id + '">読み込む</button>' +
        '<button class="btn ghost small" data-del="' + it.id + '">削除</button>' +
        '</div></div>';
    }).join('') || '<div class="ad-note">まだデッキがありません</div>';

    Array.prototype.forEach.call($('d-list').querySelectorAll('[data-open]'), function (b) {
      b.addEventListener('click', function () { openDeck(b.dataset.open); });
    });
    Array.prototype.forEach.call($('d-list').querySelectorAll('[data-del]'), function (b) {
      b.addEventListener('click', function () {
        if (!confirm(b.dataset.del + ' のデッキを削除します。よろしいですか？')) return;
        fetch('/api/decks/' + b.dataset.del, { method: 'DELETE' })
          .then(function (r) { return r.json(); })
          .then(function (res) { log('削除しました: ' + b.dataset.del); renderDecks(res.index || []); });
      });
    });
  }

  /** 保存済みデッキの語彙データから統計を組み立てる（字幕本文が無いとき用） */
  function statsFromDeck(d, words) {
    var cap = d.captions || {}, gen = d.generated || {};
    var by = function (t) { return words.filter(function (w) { return w.type === t; }).length; };
    return {
      lines: cap.lines || 0, tokens: gen.tokens || 0,
      hits: 0, coverage: gen.coverage || 0,
      nouns: by('noun'), preds: by('verb') + by('adj'), others: by('other'),
      quizzable: words.filter(function (w) { return w.include; }).length,
      unknownOnceRatio: 0
    };
  }

  /** 保存済みデッキを読み込んで編集する（字幕は取り直さない） */
  function openDeck(id) {
    var deck = null;
    fetch('decks/' + id + '.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        deck = d;
        // 字幕本文は別ファイル。手元に無ければ語彙データだけで開く
        return fetch('decks/lines/' + id + '.json', { cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
      })
      .then(function (lf) {
        var d = deck;
        d.lines = (lf && lf.lines) || [];
        ST.caps = { id: d.id, source: d.source, captions: d.captions, generated: d.generated, lines: d.lines };
        if (!IDX) IDX = EXTRACT.buildIndex();
        var saved = {};
        (d.words || []).forEach(function (w) { saved[w.ko] = w; });
        if (d.lines.length) {
          var r = EXTRACT.run(d.lines, IDX);       // 抽出をやり直し、保存済みの採否を反映する
          r.words.forEach(function (w) { if (saved[w.ko]) w.include = saved[w.ko].include !== false; });
          ST.words = r.words; ST.unknown = r.unknown; ST.stats = r.stats;
        } else {
          // 字幕本文が無いので抽出はやり直せない。保存済みの語彙データをそのまま使う
          var byKo = BY_KO;
          ST.words = (d.words || []).map(function (w) {
            var dic = byKo[w.ko] || {};
            return {
              ko: w.ko, ja: dic.ja || '?', type: dic.type || 'noun', cat: dic.cat, pos: dic.pos || null,
              weak: !!dic.weak, count: w.count || 0, surfaces: w.surfaces || {}, forms: w.forms || {},
              exts: {}, ex: w.ex || [], at: w.at || [], certain: true, ambiguous: false,
              needsCheck: !!w.needsCheck, include: w.include !== false
            };
          });
          ST.unknown = d.unknown || [];
          ST.stats = statsFromDeck(d, ST.words);
          log('字幕本文（decks/lines/' + id + '.json）が無いため、保存済みの語彙データで開きました', 'warn');
        }
        $('url').value = d.source.url || '';
        renderInfo(); renderWords(); renderUnknown(); renderPreview();
        ['info-card', 'words-card', 'unknown-card', 'preview-card', 'save-card'].forEach(function (x) {
          $(x).hidden = false;
        });
        $('save-note').textContent = 'decks/' + d.id + '.json を編集しています' +
          (d.lines.length ? '' : '（字幕本文なし・語彙データのみ）');
        log('デッキを読み込みました: ' + d.id + '（' + ST.words.length + '語）');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
      .catch(function (e) { log('デッキの読み込みに失敗: ' + e.message, 'err'); });
  }

  /* ============================================================
   * 初期化
   * ============================================================ */
  function init() {
    $('n-nouns').textContent = DATA.NOUNS.length;
    $('n-preds').textContent = DATA.PREDS.length;
    $('n-others').textContent = (DATA.OTHERS || []).length;

    SPEECH.onlog = log;
    SPEECH.init();
    SPEECH.enabled = true;
    document.addEventListener('click', function (e) {          // 🔊（キャプチャ段階）
      var b = e.target.closest ? e.target.closest('.spk') : null;
      if (!b) return;
      e.preventDefault(); e.stopPropagation();
      SPEECH.speak(b.dataset.speak, b);
    }, true);

    $('btn-fetch').addEventListener('click', fetchSubs);
    $('url').addEventListener('keydown', function (e) { if (e.key === 'Enter') fetchSubs(); });
    $('btn-save').addEventListener('click', save);
    $('btn-preview').addEventListener('click', renderPreview);
    $('btn-all').addEventListener('click', function () {
      ST.words.forEach(function (w) { w.include = true; });
      log('すべての語を出題対象にしました'); renderWords(); renderPreview();
    });
    $('btn-safe').addEventListener('click', function () {
      ST.words.forEach(function (w) { w.include = !w.needsCheck; });
      log('要確認の語を出題から外しました'); renderWords(); renderPreview();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-filter]'), function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('[data-filter]').forEach(function (o) { o.classList.remove('on'); });
        c.classList.add('on'); ST.filter = c.dataset.filter; renderWords();
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-pv]'), function (c) {
      c.addEventListener('click', function () {
        document.querySelectorAll('[data-pv]').forEach(function (o) { o.classList.remove('on'); });
        c.classList.add('on'); ST.pv = c.dataset.pv; renderPreview();
      });
    });

    $('log-copy').addEventListener('click', function () {
      var text = logLines.join('\n');
      var done = function () {
        $('log-copy').textContent = 'COPIED!';
        setTimeout(function () { $('log-copy').textContent = 'COPY'; }, 1200);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fb);
      else fb();
      function fb() {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { }
        document.body.removeChild(ta);
      }
    });
    $('log-clear').addEventListener('click', function () { logLines = []; $('log').innerHTML = ''; });
    $('log-toggle').addEventListener('click', function () {
      $('logpanel').classList.toggle('collapsed');
      $('log-toggle').textContent = $('logpanel').classList.contains('collapsed') ? '▲' : '_';
    });

    fetch('/api/decks').then(function (r) { return r.json(); })
      .then(renderDecks)
      .catch(function (e) { log('デッキ一覧を取得できません（サーバー未起動？）: ' + e.message, 'warn'); });

    var v = new URLSearchParams(location.search).get('v');
    if (v) openDeck(v);
    log('管理画面を起動しました');
  }

  document.addEventListener('DOMContentLoaded', init);
})();

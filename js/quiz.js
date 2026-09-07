/* ============================================================
 * quiz.js - 問題の生成（学習アプリと管理画面プレビューで共有）
 *
 *   QUIZ.buildQueue(mode, n, opts)   出題キューを作る
 *   QUIZ.meaningQuestion / conjQuestion / conjMeaningQuestion / listenQuestion
 *
 * opts:
 *   { nouns, preds }  出題する単語プール（省略時は辞書全体）
 *   scope: 'basic' | 'all'   活用形の範囲
 *   meta: { '먹다': { forms: {past:2}, ex: [{ko, ja, t}] } }   動画デッキの情報
 * ============================================================ */
(function (root, factory) {
  var KO = root.KO || (typeof require === 'function' ? require('./hangul.js') : null);
  var DATA = root.DATA || (typeof require === 'function' ? require('./data.js') : null);
  var api = factory(KO, DATA);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.QUIZ = api;
})(typeof window !== 'undefined' ? window : globalThis, function (KO, DATA) {
  'use strict';

  var NOUNS = DATA.NOUNS, PREDS = DATA.PREDS, OTHERS = DATA.OTHERS || [];

  /** 品詞の表示名（機能語は pos に副詞・代名詞などが入っている） */
  function posLabel(w) {
    return w.pos || (w.type === 'noun' ? '名詞' : (w.type === 'verb' ? '動詞' : '形容詞'));
  }
  /** その語の基準プール（選択肢が足りないときの補充元） */
  function basePool(w) {
    return w.type === 'noun' ? NOUNS : (w.type === 'other' ? OTHERS : PREDS);
  }

  /* ---------- ユーティリティ ---------- */
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

  /* ---------- 出題する活用形の範囲 ---------- */
  var BASIC_FORMS = ['polite', 'past', 'formal', 'neg', 'future'];
  function formsForWord(w, opts) {
    var fs = KO.formsFor(w);
    if ((opts && opts.scope) === 'basic') {
      var b = fs.filter(function (f) { return BASIC_FORMS.indexOf(f.key) >= 0; });
      if (b.length) return b;
    }
    return fs;
  }
  /** 動画で実際に出た活用形を優先して選ぶ */
  function pickForm(w, opts) {
    var seen = opts && opts.meta && opts.meta[w.ko] && opts.meta[w.ko].forms;
    if (seen) {
      // 字幕に実際に出た形は、活用範囲の設定に関係なく出題してよい（不自然な形が混じらないため）
      var hit = KO.formsFor(w).filter(function (f) { return seen[f.key]; });
      if (hit.length && Math.random() < 0.75) return pick(hit);
    }
    return pick(formsForWord(w, opts));
  }
  /** 動画デッキの例文（1件） */
  function exampleOf(w, opts) {
    var m = opts && opts.meta && opts.meta[w.ko];
    return (m && m.ex && m.ex.length) ? m.ex[0] : null;
  }
  function withExample(text, w, opts) {
    var ex = exampleOf(w, opts);
    if (!ex) return text;
    return text + '　／　字幕: ' + ex.ko + (ex.ja ? '（' + ex.ja + '）' : '');
  }

  /* ============================================================
   * 誤答（ディストラクタ）の生成
   * ============================================================ */
  var FLIP = { 'ㅏ': 'ㅓ', 'ㅓ': 'ㅏ', 'ㅘ': 'ㅝ', 'ㅝ': 'ㅘ', 'ㅐ': 'ㅔ', 'ㅔ': 'ㅐ' };
  function flipHarmony(w, correct) {
    var stem = KO.stemOf(w.ko);
    for (var i = stem.length - 1; i < correct.length; i++) {
      var ch = correct[i];
      if (!KO.isSyllable(ch)) continue;
      var d = KO.decompose(ch), v = KO.JUNG[d.jung];
      if (FLIP[v]) {
        return correct.slice(0, i) + KO.compose(d.cho, KO.JUNG.indexOf(FLIP[v]), d.jong) + correct.slice(i + 1);
      }
    }
    return null;
  }
  function endingMistake(w, key, correct) {
    var stem = KO.stemOf(w.ko), out = [];
    function t(fn) { try { var v = fn(); if (v) out.push(v); } catch (e) { } }
    if (key === 'cond')     t(function () { return correct === stem + '으면' ? stem + '면' : stem + '으면'; });
    if (key === 'seyo')     t(function () { return correct === stem + '으세요' ? stem + '세요' : stem + '으세요'; });
    if (key === 'future') {
      t(function () { return stem + '을 거예요'; });
      t(function () { return KO.addJong(stem, 'ㄹ') + ' 거예요'; });
    }
    if (key === 'modifier') {
      t(function () { return stem + '은'; });
      t(function () { return KO.addJong(stem, 'ㄴ'); });
      t(function () { return stem + '는'; });
    }
    if (key === 'formal') {
      t(function () { return stem + '습니다'; });
      t(function () { return KO.addJong(stem, 'ㅂ') + '니다'; });
    }
    if (key === 'polite')   t(function () { return stem + '어요'; });
    if (key === 'past')     t(function () { return stem + '었어요'; });
    if (key === 'aseo')     t(function () { return stem + '어서'; });
    return out;
  }
  function conjDistractors(w, key, correct) {
    var out = [];
    if (w.irr) {
      var plain = {}; Object.keys(w).forEach(function (k) { plain[k] = w[k]; }); plain.irr = null;
      try { out.push(KO.conjugate(plain, key)); } catch (e) { }
    }
    var f = flipHarmony(w, correct); if (f) out.push(f);
    out = out.concat(endingMistake(w, key, correct));
    KO.formsFor(w).forEach(function (fm) {
      if (fm.key !== key) { try { out.push(fm.fn(w)); } catch (e) { } }
    });
    return uniq(out).filter(function (s) { return norm(s) !== norm(correct); });
  }

  /** 選択肢を4つに満たすまで埋める（デッキが小さいときの保険） */
  function padChoices(choices, correct, word, dir, pool, sameCatOnly) {
    var base = basePool(word);
    var val = function (x) { return dir === 'ko2ja' ? x.ja : x.ko; };
    var sources = [
      pool.filter(function (x) { return x.cat === word.cat; }),   // 同カテゴリのデッキ語
      base.filter(function (x) { return x.cat === word.cat; }),   // 同カテゴリの辞書語
      base.filter(function (x) { return x.type === word.type; })  // 同じ品詞の辞書語
    ];
    for (var s = 0; s < sources.length && choices.length < 4; s++) {
      shuffle(sources[s]).forEach(function (x) {
        if (choices.length >= 4) return;
        if (!usableAsWrong(x, word)) return;                      // 訳が同じ語・同義語は「もう一つの正解」になる
        var v = val(x);
        if (choices.indexOf(v) < 0) choices.push(v);
      });
    }
    return choices;
  }

  /* ============================================================
   * 問題の生成
   * ============================================================ */
  /** その語の誤答に使ってよいか（同義語・同じ訳の語を除く） */
  function usableAsWrong(x, word) {
    if (x.ko === word.ko || x.ja === word.ja) return false;
    if (word.syn && word.syn.indexOf(x.ko) >= 0) return false;
    if (x.syn && x.syn.indexOf(word.ko) >= 0) return false;
    return true;
  }

  function meaningQuestion(word, pool, dir, opts) {
    opts = opts || {};
    var same = pool.filter(function (x) { return x.cat === word.cat && usableAsWrong(x, word); });
    var others = pool.filter(function (x) { return usableAsWrong(x, word); });
    var src = shuffle(same.length >= 3 ? same : others).slice(0, 3);
    var typeTag = posLabel(word);
    var ko2ja = dir === 'ko2ja';
    var choices = [ko2ja ? word.ja : word.ko].concat(src.map(function (x) { return ko2ja ? x.ja : x.ko; }));
    padChoices(choices, ko2ja ? word.ja : word.ko, word, dir, pool);

    return {
      kind: 'mc', word: word,
      title: ko2ja ? '意味を選ぼう' : '韓国語を選ぼう',
      word_main: ko2ja ? word.ko : word.ja,
      word_sub: typeTag, tag: null,
      answer: ko2ja ? word.ja : word.ko,
      choices: shuffle(choices),
      explain: withExample(word.ko + ' ＝ ' + word.ja + '（' + typeTag + '）', word, opts),
      small: ko2ja
    };
  }

  function conjQuestion(word, kindHint, opts) {
    opts = opts || {};
    var form = pickForm(word, opts);
    var correct = KO.conjugate(word, form.key);
    var typeTag = word.type === 'verb' ? '動詞' : '形容詞';
    var base = {
      word: word, form: form,
      title: 'この形に活用しよう',
      word_main: word.ko, word_sub: word.ja + '・' + typeTag + '・' + KO.irrLabel(word),
      tag: form.label + '　' + form.ja,
      answer: correct,
      explain: withExample(KO.explain(word, form.key), word, opts)
    };
    var kind = kindHint || (Math.random() < 0.55 ? 'mc' : 'bank');
    if (kind === 'mc') {
      var ds = shuffle(conjDistractors(word, form.key, correct)).slice(0, 3);
      // 予備：他の単語の同じ活用形（辞書全体から借りる。試行上限つき）
      var cands = PREDS.filter(function (x) { return x.type === word.type && x.ko !== word.ko; });
      for (var tries = 0; ds.length < 3 && tries < 40; tries++) {
        try {
          var v = KO.conjugate(pick(cands), form.key);
          if (v && ds.indexOf(v) < 0 && v !== correct) ds.push(v);
        } catch (e) { }
      }
      base.kind = 'mc';
      base.choices = shuffle([correct].concat(ds));
      return base;
    }
    base.kind = 'bank';
    base.tiles = makeTiles(correct, conjDistractors(word, form.key, correct));
    return base;
  }

  /** 音節タイル（正解の音節＋紛らわしい音節2つ） */
  function makeTiles(correct, wrongForms) {
    var tiles = syllables(correct), extra = [];
    shuffle(wrongForms || []).some(function (d) {
      syllables(d).forEach(function (s) {
        if (tiles.indexOf(s) < 0 && extra.indexOf(s) < 0) extra.push(s);
      });
      return extra.length >= 2;
    });
    return shuffle(tiles.concat(extra.slice(0, 2)));
  }

  function conjMeaningQuestion(word, opts) {
    opts = opts || {};
    var form = pickForm(word, opts);
    var shown = KO.conjugate(word, form.key);
    var label = function (w, f) { return w.ja + '／' + f.label; };
    var correct = label(word, form);

    var wrong = [];
    shuffle(KO.formsFor(word)).forEach(function (f) {
      if (f.key === form.key || wrong.length >= 2) return;
      try { if (KO.conjugate(word, f.key) !== shown) wrong.push(label(word, f)); } catch (e) { }
    });
    var poolPreds = (opts.preds && opts.preds.length > 3 ? opts.preds : PREDS).filter(function (x) {
      if (x.type !== word.type || x.ko === word.ko || x.ja === word.ja) return false;
      if (!KO.formsFor(x).some(function (f) { return f.key === form.key; })) return false;
      try { return KO.conjugate(x, form.key) !== shown; } catch (e) { return false; }
    });
    while (wrong.length < 3 && poolPreds.length) {
      var o = poolPreds.splice(Math.floor(Math.random() * poolPreds.length), 1)[0];
      var l = label(o, form);
      if (wrong.indexOf(l) < 0 && l !== correct) wrong.push(l);
    }
    shuffle(KO.FORMS).forEach(function (f) {
      if (wrong.length >= 3 || f.types.indexOf(word.type) < 0) return;
      var l2 = label(word, f);
      if (l2 === correct || wrong.indexOf(l2) >= 0) return;
      try { if (KO.conjugate(word, f.key) !== shown) wrong.push(l2); } catch (e) { }
    });

    return {
      kind: 'mc', word: word, form: form, longChoices: true,
      title: '意味と活用形を選ぼう',
      word_main: shown,
      word_sub: word.type === 'verb' ? '動詞' : '形容詞',
      tag: null,
      answer: correct,
      choices: shuffle([correct].concat(wrong.slice(0, 3))),
      explain: withExample(KO.explain(word, form.key), word, opts)
    };
  }

  /** 聞き取り：音声を聞いて音節タイルで綴る */
  function listenQuestion(word, opts) {
    opts = opts || {};
    var typeTag = posLabel(word);
    var pool = word.type === 'noun' ? (opts.nouns || NOUNS)
      : (word.type === 'other' ? (opts.others || OTHERS) : (opts.preds || PREDS));
    var others = shuffle(pool.filter(function (x) { return x.ko !== word.ko; })).slice(0, 4)
      .map(function (x) { return x.ko; });
    return {
      kind: 'listen', word: word,
      title: '聞いて綴ろう',
      word_main: '🔊 音声を聞いて、ハングルを組み立てよう',
      word_sub: typeTag, tag: null,
      speakTarget: word.ko,
      answer: word.ko,
      tiles: makeTiles(word.ko, others),
      explain: withExample(word.ko + ' ＝ ' + word.ja + '（' + typeTag + '）', word, opts)
    };
  }

  /* ============================================================
   * 出題キュー
   * ============================================================ */
  var COURSES = ['noun-k2j', 'noun-j2k', 'pred-k2j', 'pred-j2k',
    'conj-k2j', 'conj-j2k', 'other-k2j', 'other-j2k', 'listen'];

  function buildQueue(mode, n, opts) {
    opts = opts || {};
    var nouns = (opts.nouns && opts.nouns.length) ? opts.nouns : NOUNS;
    var preds = (opts.preds && opts.preds.length) ? opts.preds : PREDS;
    var others = (opts.others && opts.others.length) ? opts.others : OTHERS;
    others = others.filter(function (w) { return !w.weak; });   // 索引専用の語は出題しない
    // 聞き取りは1音節の語を除く（音だけでは綴りを決められないため）
    var all = nouns.concat(preds, others).filter(function (w) { return w.ko.length >= 2; });
    var qs = [], bagN = [], bagP = [], bagO = [], bagA = [];

    function next(bag, src) {
      if (!bag.length) { Array.prototype.push.apply(bag, shuffle(src)); }
      return bag.shift();
    }
    var nextNoun = function () { return next(bagN, nouns); };
    var nextPred = function () { return next(bagP, preds); };
    var nextOther = function () { return next(bagO, others); };
    var nextAny = function () { return next(bagA, all); };

    var GEN = {
      'noun-k2j': function () { return meaningQuestion(nextNoun(), nouns, 'ko2ja', opts); },
      'noun-j2k': function () { return meaningQuestion(nextNoun(), nouns, 'ja2ko', opts); },
      'pred-k2j': function () { return meaningQuestion(nextPred(), preds, 'ko2ja', opts); },
      'pred-j2k': function () { return meaningQuestion(nextPred(), preds, 'ja2ko', opts); },
      'conj-k2j': function () { return conjMeaningQuestion(nextPred(), opts); },
      'conj-j2k': function () { return conjQuestion(nextPred(), null, opts); },
      'other-k2j': function () { return meaningQuestion(nextOther(), others, 'ko2ja', opts); },
      'other-j2k': function () { return meaningQuestion(nextOther(), others, 'ja2ko', opts); },
      'listen':   function () { return listenQuestion(nextAny(), opts); }
    };
    // ミックスの内訳。聞き取りは動画デッキのときだけ混ぜる（辞書コースの挙動を変えないため）
    var available = COURSES.filter(function (c) {
      if (c === 'listen') return !!opts.meta && all.length > 0;
      if (c.indexOf('noun') === 0) return nouns.length > 0;
      if (c.indexOf('other') === 0) return others.length > 0;
      return preds.length > 0;
    });

    for (var i = 0; i < n; i++) {
      var gen = GEN[mode] || GEN[pick(available)];
      qs.push(gen());
    }
    return qs;
  }

  return {
    COURSES: COURSES, BASIC_FORMS: BASIC_FORMS, posLabel: posLabel,
    shuffle: shuffle, pick: pick, norm: norm, syllables: syllables,
    formsForWord: formsForWord, conjDistractors: conjDistractors, makeTiles: makeTiles,
    meaningQuestion: meaningQuestion, conjQuestion: conjQuestion,
    conjMeaningQuestion: conjMeaningQuestion, listenQuestion: listenQuestion,
    buildQueue: buildQueue
  };
});

/* ============================================================
 * hangul.js - ハングルの分解・合成と韓国語用言の活用エンジン
 * 依存なし。ブラウザ(window.KO)とNode(module.exports)の両対応。
 * ============================================================ */
(function (root) {
  'use strict';

  var BASE = 0xac00;
  var CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  var JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  var JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

  function isSyllable(ch) {
    if (!ch) return false;
    var c = ch.charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3;
  }
  function decompose(ch) {
    var c = ch.charCodeAt(0) - BASE;
    return { cho: Math.floor(c / 588), jung: Math.floor((c % 588) / 28), jong: c % 28 };
  }
  function compose(cho, jung, jong) {
    return String.fromCharCode(BASE + cho * 588 + jung * 28 + (jong || 0));
  }
  function jungIdx(v) { return JUNG.indexOf(v); }
  function jongIdx(v) { return JONG.indexOf(v); }

  /** 末尾音節のパッチム文字を返す（無ければ ''） */
  function finalOf(s) {
    var ch = s.slice(-1);
    if (!isSyllable(ch)) return '';
    return JONG[decompose(ch).jong];
  }
  /** 末尾音節の母音を返す */
  function vowelOf(s) {
    var ch = s.slice(-1);
    if (!isSyllable(ch)) return '';
    return JUNG[decompose(ch).jung];
  }
  /** 末尾音節にパッチムを付ける（既存のパッチムは置換） */
  function addJong(s, jamo) {
    var d = decompose(s.slice(-1));
    return s.slice(0, -1) + compose(d.cho, d.jung, jongIdx(jamo));
  }
  /** 末尾音節のパッチムを外す */
  function dropJong(s) {
    var d = decompose(s.slice(-1));
    return s.slice(0, -1) + compose(d.cho, d.jung, 0);
  }
  /** 末尾音節の母音を差し替える */
  function replaceJung(s, vowel) {
    var d = decompose(s.slice(-1));
    return s.slice(0, -1) + compose(d.cho, jungIdx(vowel), d.jong);
  }

  /** 語幹（辞書形から다を除いたもの） */
  function stemOf(dict) { return dict.slice(0, -1); }

  /** 陽母音(ㅏ/ㅗ)かどうか → 아 を取るなら true */
  function isBright(vowel) { return vowel === 'ㅏ' || vowel === 'ㅗ' || vowel === 'ㅑ'; }

  /* ---------- 不規則の判定ヘルパ ---------- */
  function irrOf(w) { return w.irr || null; }

  /* ============================================================
   * 1) 아/어 形（해요体の語基）
   * ============================================================ */
  function stemA(w) {
    var stem = stemOf(w.ko);
    var irr = irrOf(w);

    // 하다 → 해
    if (stem.slice(-1) === '하') return stem.slice(0, -1) + '해';

    var last = stem.slice(-1);
    var d = decompose(last);
    var jong = JONG[d.jong];
    var jung = JUNG[d.jung];

    // 르 不規則 : 모르다 → 몰라 / 부르다 → 불러
    if (irr === '르' && last === '르') {
      var head = stem.slice(0, -1);              // 모
      var pd = decompose(head.slice(-1));
      var newHead = head.slice(0, -1) + compose(pd.cho, pd.jung, jongIdx('ㄹ'));
      var bright = isBright(JUNG[pd.jung]);
      return newHead + (bright ? '라' : '러');
    }

    // ㅎ 不規則 : 그렇다 → 그래 / 빨갛다 → 빨개 / 하얗다 → 하얘
    if (irr === 'ㅎ' && jong === 'ㅎ') {
      var bare = dropJong(stem);
      var v = vowelOf(bare);
      return replaceJung(bare, v === 'ㅑ' ? 'ㅒ' : 'ㅐ');
    }

    // ㅂ 不規則 : 덥다 → 더워 / 돕다 → 도와
    if (irr === 'ㅂ' && jong === 'ㅂ') {
      var b = dropJong(stem);
      if (w.ko === '돕다' || w.ko === '곱다') return b + '와';
      return b + '워';
    }

    // ㅅ 不規則 : 짓다 → 지어（縮約しない）
    if (irr === 'ㅅ' && jong === 'ㅅ') {
      var s2 = dropJong(stem);
      return s2 + (isBright(vowelOf(s2)) ? '아' : '어');
    }

    // ㄷ 不規則 : 듣다 → 들어
    if (irr === 'ㄷ' && jong === 'ㄷ') {
      stem = stem.slice(0, -1) + compose(d.cho, d.jung, jongIdx('ㄹ'));
      return stem + (isBright(jung) ? '아' : '어');
    }

    // ㅡ 脱落 : 쓰다 → 써 / 바쁘다 → 바빠 / 예쁘다 → 예뻐
    if (jung === 'ㅡ' && d.jong === 0) {
      if (stem.length === 1) return compose(d.cho, jungIdx('ㅓ'), 0);
      var prevV = vowelOf(stem.slice(0, -1));
      return stem.slice(0, -1) + compose(d.cho, jungIdx(isBright(prevV) ? 'ㅏ' : 'ㅓ'), 0);
    }

    // パッチムあり（ㄹ語幹含む）→ そのまま 아/어
    if (d.jong !== 0) return stem + (isBright(jung) ? '아' : '어');

    // パッチムなし → 縮約
    var map = {
      'ㅏ': 'ㅏ',  // 가 + 아 → 가
      'ㅓ': 'ㅓ',  // 서 + 어 → 서
      'ㅐ': 'ㅐ',  // 보내 + 어 → 보내
      'ㅔ': 'ㅔ',  // 세 + 어 → 세
      'ㅕ': 'ㅕ',  // 켜 + 어 → 켜
      'ㅗ': 'ㅘ',  // 오 + 아 → 와
      'ㅜ': 'ㅝ',  // 주 + 어 → 줘
      'ㅣ': 'ㅕ',  // 마시 + 어 → 마셔
      'ㅚ': 'ㅙ',  // 되 + 어 → 돼
      'ㅟ': null,  // 뛰 + 어 → 뛰어（縮約なし）
      'ㅢ': null
    };
    if (Object.prototype.hasOwnProperty.call(map, jung)) {
      var to = map[jung];
      if (to === null) return stem + '어';
      return stem.slice(0, -1) + compose(d.cho, jungIdx(to), 0);
    }
    return stem + (isBright(jung) ? '아' : '어');
  }

  /* ============================================================
   * 2) 으 系語尾の語基（으면 / 을 거예요 / 은・ㄴ / 으세요）
   * ============================================================ */
  function euBase(w) {
    var stem = stemOf(w.ko);
    var irr = irrOf(w);
    var jong = finalOf(stem);

    if (irr === 'ㅂ' && jong === 'ㅂ') return { base: dropJong(stem) + '우', eu: false, l: false };
    if (irr === 'ㅎ' && jong === 'ㅎ') return { base: dropJong(stem), eu: false, l: false };
    if (irr === 'ㄷ' && jong === 'ㄷ') {
      var d = decompose(stem.slice(-1));
      return { base: stem.slice(0, -1) + compose(d.cho, d.jung, jongIdx('ㄹ')), eu: true, l: false };
    }
    if (irr === 'ㅅ' && jong === 'ㅅ') return { base: dropJong(stem), eu: true, l: false };
    if (jong === 'ㄹ') return { base: stem, eu: false, l: true };
    return { base: stem, eu: jong !== '', l: false };
  }

  /** ending: 'ㄴ' | 'ㄹ' | '면' | '세요' | '니까' */
  function attachEu(w, ending) {
    var e = euBase(w), b = e.base;
    if (ending === 'ㄴ') return e.l ? addJong(dropJong(b), 'ㄴ') : (e.eu ? b + '은' : addJong(b, 'ㄴ'));
    if (ending === 'ㄹ') return e.l ? b : (e.eu ? b + '을' : addJong(b, 'ㄹ'));
    if (ending === '면') return b + (e.eu ? '으면' : '면');
    if (ending === '세요') return e.l ? dropJong(b) + '세요' : b + (e.eu ? '으세요' : '세요');
    if (ending === '니까') return b + (e.eu ? '으니까' : '니까');
    return b + ending;
  }

  /* ============================================================
   * 3) 各活用形
   * ============================================================ */
  function polite(w)  { return stemA(w) + '요'; }                    // 해요体
  function past(w)    { return addJong(stemA(w), 'ㅆ') + '어요'; }    // 過去
  function pastPlain(w){ return addJong(stemA(w), 'ㅆ') + '다'; }     // 過去（辞書調・内部用）
  function formal(w) {                                              // 합니다体
    var stem = stemOf(w.ko), jong = finalOf(stem);
    if (jong === 'ㄹ') return addJong(dropJong(stem), 'ㅂ') + '니다';
    if (jong === '')   return addJong(stem, 'ㅂ') + '니다';
    return stem + '습니다';
  }
  function formalPast(w) { return addJong(stemA(w), 'ㅆ') + '습니다'; }
  function neg(w) {                                                 // 안 否定
    // 「名詞＋하다」型の動詞は 名詞 안 해요（공부 안 해요）。それ以外は 안 ＋ 해요体
    if (w.negSplit) return stemOf(w.ko).slice(0, -1) + ' 안 해요';
    return '안 ' + polite(w);
  }
  function jiAnayo(w) { return stemOf(w.ko) + '지 않아요'; }          // 長い否定
  function future(w)  { return attachEu(w, 'ㄹ') + ' 거예요'; }       // 意志・推量
  function cond(w)    { return attachEu(w, '면'); }                  // 仮定
  function seyo(w)    { return attachEu(w, '세요'); }                // 尊敬・依頼
  function go(w)      { return stemOf(w.ko) + '고'; }                // 並列
  function aseo(w)    { return stemA(w) + '서'; }                    // 理由・順序
  function want(w)    { return stemOf(w.ko) + '고 싶어요'; }          // 〜したい（動詞）
  function modifier(w) {                                            // 現在連体形
    // 맛있다 / 재미있다 / 맛없다 は形容詞でも「-는」を取る
    if (w.type === 'adj' && /[있없]$/.test(stemOf(w.ko))) return stemOf(w.ko) + '는';
    if (w.type === 'adj') return attachEu(w, 'ㄴ');
    var stem = stemOf(w.ko);
    if (finalOf(stem) === 'ㄹ') return dropJong(stem) + '는';
    return stem + '는';
  }
  function ing(w)     { return stemOf(w.ko) + '고 있어요'; }          // 〜している（動詞）

  /* 活用形の定義テーブル（出題に使う） */
  var FORMS = [
    { key: 'polite',     label: '해요体（現在）',        ja: '〜します／〜です',    fn: polite,     types: ['verb', 'adj'] },
    { key: 'past',       label: '過去形（해요体）',      ja: '〜しました／〜でした', fn: past,       types: ['verb', 'adj'] },
    { key: 'formal',     label: '합니다体（現在）',      ja: '〜します／〜です',    fn: formal,     types: ['verb', 'adj'] },
    { key: 'formalPast', label: '합니다体（過去）',      ja: '〜しました',          fn: formalPast, types: ['verb', 'adj'] },
    { key: 'neg',        label: '否定（안）',            ja: '〜しません',          fn: neg,        types: ['verb', 'adj'] },
    { key: 'jiAnayo',    label: '否定（지 않아요）',      ja: '〜しません',          fn: jiAnayo,    types: ['verb', 'adj'] },
    { key: 'future',     label: '未来・意志（을 거예요）', ja: '〜するつもりです',    fn: future,     types: ['verb', 'adj'] },
    { key: 'cond',       label: '仮定（으면）',          ja: '〜すれば',            fn: cond,       types: ['verb', 'adj'] },
    { key: 'seyo',       label: '尊敬・依頼（으세요）',   ja: '〜してください',      fn: seyo,       types: ['verb'] },
    { key: 'go',         label: '並列（고）',            ja: '〜して、〜くて',      fn: go,         types: ['verb', 'adj'] },
    { key: 'aseo',       label: '理由（아서/어서）',      ja: '〜なので',            fn: aseo,       types: ['verb', 'adj'] },
    { key: 'modifier',   label: '現在連体形',            ja: '〜する〜／〜い〜',    fn: modifier,   types: ['verb', 'adj'] },
    { key: 'want',       label: '希望（고 싶어요）',      ja: '〜したいです',        fn: want,       types: ['verb'] },
    { key: 'ing',        label: '進行（고 있어요）',      ja: '〜しています',        fn: ing,        types: ['verb'] }
  ];
  var FORM_MAP = {};
  FORMS.forEach(function (f) { FORM_MAP[f.key] = f; });

  function conjugate(w, key) { return FORM_MAP[key].fn(w); }

  /** その単語で出題してよい活用形（品詞 + 語ごとの skip を考慮） */
  function formsFor(w) {
    var skip = (w.skip || '').split(/\s+/);
    return FORMS.filter(function (f) {
      return f.types.indexOf(w.type) >= 0 && skip.indexOf(f.key) < 0;
    });
  }

  /** 不規則の説明ラベル */
  function irrLabel(w) {
    switch (w.irr) {
      case 'ㅂ': return 'ㅂ不規則';
      case 'ㄷ': return 'ㄷ不規則';
      case 'ㅅ': return 'ㅅ不規則';
      case 'ㅎ': return 'ㅎ不規則';
      case '르': return '르不規則';
      default:
        var stem = stemOf(w.ko);
        if (finalOf(stem) === 'ㄹ') return 'ㄹ語幹';
        if (vowelOf(stem) === 'ㅡ' && finalOf(stem) === '') return 'ㅡ脱落';
        if (stem.slice(-1) === '하') return '하다用言';
        return '規則活用';
    }
  }

  /** 解説文（不正解時に表示） */
  function explain(w, key) {
    var f = FORM_MAP[key];
    return w.ko + '（' + w.ja + '）の' + f.label + '：語幹「' + stemOf(w.ko) + '」＋語尾 → ' +
      f.fn(w) + '　［' + irrLabel(w) + '］';
  }

  /** 1語の活用表 */
  function table(w) {
    return formsFor(w)
      .map(function (f) { return { key: f.key, label: f.label, value: f.fn(w) }; });
  }

  var API = {
    CHO: CHO, JUNG: JUNG, JONG: JONG,
    isSyllable: isSyllable, decompose: decompose, compose: compose,
    finalOf: finalOf, vowelOf: vowelOf, addJong: addJong, dropJong: dropJong,
    stemOf: stemOf, stemA: stemA, attachEu: attachEu,
    FORMS: FORMS, FORM_MAP: FORM_MAP,
    conjugate: conjugate, explain: explain, table: table, irrLabel: irrLabel,
    formsFor: formsFor
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.KO = API;
})(typeof window !== 'undefined' ? window : globalThis);

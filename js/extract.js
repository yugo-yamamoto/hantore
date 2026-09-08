/* ============================================================
 * extract.js - 字幕から「既存辞書に載っている単語」を取り出す
 *
 *   EXTRACT.buildIndex()        逆引き索引を作る（辞書の全語 → 表層形）
 *   EXTRACT.run(lines, idx)     字幕行を走査して単語と未知語を集計
 *
 * 出題するのは既存辞書（data.js）にある語だけなので、
 * 形態素解析器は使わず hangul.js の活用エンジンを逆向きに使う。
 * ブラウザと Node の両方で動く（Node ではロジックの単体検証に使う）。
 * ============================================================ */
(function (root, factory) {
  var KO = root.KO || (typeof require === 'function' ? require('./hangul.js') : null);
  var DATA = root.DATA || (typeof require === 'function' ? require('./data.js') : null);
  var api = factory(KO, DATA);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.EXTRACT = api;
})(typeof window !== 'undefined' ? window : globalThis, function (KO, DATA) {
  'use strict';

  /* 名詞に付く助詞（長いものから順に照合する） */
  var PARTICLES = [
    '에서는', '에서도', '으로는', '이라고', '에게서',
    '에서', '으로', '부터', '까지', '에게', '한테', '처럼', '보다', '마다',
    '이나', '라고', '이랑', '에는', '에도', '하고', '이야', '이다',
    '은', '는', '이', '가', '을', '를', '에', '도', '만', '과', '와', '의', '로', '나', '랑', '야'
  ];

  /* 用言の「拡張語尾」。14活用形の外だが字幕によく出る形。
     バラエティや会話の動画は반말（タメ口）が中心なので、ここが効く。
     誤検出しやすいので、これでしか見つからなかった語は「要確認」にする。
     -기（名詞化）は 자기(自己) を 자다 と誤認するため意図的に入れない。 */
  function extForms(w) {
    var out = [];
    function add(s, label) { if (s) out.push({ s: s, label: label }); }
    try {
      var st = KO.stemOf(w.ko);
      var a = KO.stemA(w);                 // 아/어 形
      var pa = KO.addJong(a, 'ㅆ');        // 았/었
      var hon = KO.attachEu(w, '세요').replace(/세요$/, '');   // 敬語の語基（하시/드시…）
      // ---- 반말（해体）----
      add(a, '반말（해体）');                      // 같아 / 있어 / 돼 / 가
      add(pa + '어', '반말の過去');                // 갔어 / 했어
      add(a + '야지', '-아/어야지');
      add(a + '봐', '-아/어 봐');
      add(a + '서요', '-아/어서요');
      // ---- よく出る接続・終結 ----
      add(st + '지', '-지');                       // 그렇지 / 좋지
      add(st + '게', '-게');                       // 이렇게 / 부드럽게
      add(st + '네', '-네');
      add(st + '구나', '-구나');
      add(st + '잖아', '-잖아');
      add(st + '거든', '-거든');
      add(st + '나', '-나');
      add(st + '나요', '-나요');
      add(st + '는데요', '-는데요');
      add(st + '겠어', '-겠어');
      add(st + '겠어요', '-겠어요');
      add(st + '겠습니다', '-겠습니다');
      add(pa + '지', '-았/었지');
      add(KO.attachEu(w, '니까').replace(/까$/, ''), '-으니');
      add(KO.attachEu(w, '면').replace(/면$/, '') + '면서', '-으면서');
      // ---- 連体形（過去・未来）----
      add(KO.attachEu(w, 'ㄴ'), '連体形（-은/-ㄴ）');   // 한 / 먹은 / 좋은
      add(KO.attachEu(w, 'ㄹ'), '連体形（-을/-ㄹ）');   // 할 / 먹을
      // ---- 敬語 ----
      add(hon + '셨어요', '-셨어요');
      add(hon + '십니다', '-십니다');
      add(hon + '셔서', '-셔서');
      add(hon + '시면', '-시면')
      add(st + '고', '-고');
      add(st + '고요', '-고요');
      add(st + '지만', '-지만');
      add(st + '네요', '-네요');
      add(st + '거든요', '-거든요');
      add(st + '잖아요', '-잖아요');
      add(st + '지요', '-지요');
      add(st + '죠', '-죠');
      add(st + '자', '-자');
      add(st + '더라', '-더라');
      add(a + '도', '-아/어도');
      add(a + '야', '-아/어야');
      add(a + '라', '-아/어라');
      add(a + '야죠', '-아/어야죠');
      add(pa + '지만', '-았/었지만');
      add(pa + '는데', '-았/었는데');
      add(pa + '으면', '-았/었으면');
      add(pa + '던', '-았/었던');
      add(KO.attachEu(w, 'ㄹ') + '게요', '-을게요');
      add(KO.attachEu(w, 'ㄹ') + '까요', '-을까요');
      add(KO.attachEu(w, 'ㄹ') + '래요', '-을래요');
      add(KO.attachEu(w, 'ㄹ') + '수', '-을 수');
      add(KO.attachEu(w, '니까'), '-으니까');
      add(KO.attachEu(w, '려고'), '-으려고');
      add(KO.attachEu(w, '러'), '-으러');
      add(w.type === 'verb' ? st + '는데' : KO.attachEu(w, 'ㄴ') + '데', '-는데/-ㄴ데');
    } catch (e) { /* 活用できない語は諦める */ }
    return out;
  }

  /** 逆引き索引を作る。同じ表層形が複数の語から作られたら ambiguous を立てる */
  function buildIndex(nouns, preds, others) {
    nouns = nouns || DATA.NOUNS;
    preds = preds || DATA.PREDS;
    others = others || DATA.OTHERS || [];
    // other  = 機能語の見出し形（名詞＋助詞より優先する。「별로」は「별＋로」ではない）
    // otherP = 機能語＋助詞（こちらは名詞の見出し形に譲る。「나이」は「나＋이」ではない）
    var idx = { noun: new Map(), other: new Map(), otherP: new Map(), form: new Map(), ext: new Map(), size: 0 };

    function put(map, surface, entry) {
      if (!surface) return;
      var cur = map.get(surface);
      if (cur) {
        if (cur.w.ko !== entry.w.ko) cur.ambiguous = true;   // 사다/살다 → 삽니다 など
        return;
      }
      map.set(surface, entry);
      idx.size++;
    }

    nouns.forEach(function (w) {
      put(idx.noun, w.ko, { w: w, kind: 'noun', label: 'そのまま' });
      PARTICLES.forEach(function (p) {
        put(idx.noun, w.ko + p, { w: w, kind: 'noun', label: '＋' + p });
      });
    });

    // 機能語（副詞・接続・代名詞・感嘆詞・依存名詞）
    // 副詞・接続・感嘆詞は助詞を取らないので付けない（「너무는」とは言わない）
    var WITH_PARTICLE = { '代名詞': 1, '依存名詞': 1 };
    // 対比の助詞だけは副詞にも付く（다시는 / 이제는 / 너무도）
    var ADV_PARTICLES = ['는', '도', '만', '까지', '부터'];
    others.forEach(function (w) {                       // 1パス目: 見出し形と縮約形
      [w.ko].concat(w.alt || []).forEach(function (sf) {
        put(idx.other, sf, { w: w, kind: 'other', label: w.cat });
      });
    });
    others.forEach(function (w) {                       // 2パス目: 助詞つき
      var ps = WITH_PARTICLE[w.cat] ? PARTICLES : (w.cat === '副詞' ? ADV_PARTICLES : []);
      if (!ps.length) return;
      [w.ko].concat(w.alt || []).forEach(function (sf) {
        ps.forEach(function (p) {
          if (idx.other.has(sf + p)) return;
          put(idx.otherP, sf + p, { w: w, kind: 'other', label: w.cat + '＋' + p });
        });
      });
    });

    preds.forEach(function (w) {
      KO.formsFor(w).forEach(function (f) {
        try { put(idx.form, KO.conjugate(w, f.key), { w: w, kind: 'form', key: f.key, label: f.label }); }
        catch (e) { }
      });
    });
    // 拡張語尾は最後に作る。名詞・機能語・14活用形が既に取っている表層形は登録しない
    //（例: 입은 は「口＋은」、물은 は「水＋은」として読むほうが自然）
    preds.forEach(function (w) {
      extForms(w).forEach(function (e) {
        if (idx.noun.has(e.s) || idx.other.has(e.s) || idx.otherP.has(e.s) || idx.form.has(e.s)) return;
        put(idx.ext, e.s, { w: w, kind: 'ext', label: e.label });
      });
    });
    return idx;
  }

  /** 字幕1行 → トークン列（前後の記号を落とし、ハングルを含まないものは捨てる） */
  function tokenize(line) {
    return String(line || '').split(/\s+/)
      .map(function (t) { return t.replace(/^[^가-힣]+/, '').replace(/[^가-힣]+$/, ''); })
      .filter(function (t) { return /^[가-힣]+$/.test(t); });
  }

  /** 未知語から助詞を剥がして見出しらしくする（参考表示用） */
  function stripParticle(tok) {
    for (var i = 0; i < PARTICLES.length; i++) {
      var p = PARTICLES[i];
      if (tok.length - p.length >= 2 && tok.slice(-p.length) === p) return tok.slice(0, -p.length);
    }
    return tok;
  }

  /** 字幕行を走査して単語・未知語を集計する */
  function run(lines, idx) {
    idx = idx || buildIndex();
    var words = new Map(), unknown = new Map();
    var stats = { tokens: 0, hits: 0, lines: lines.length };

    lines.forEach(function (line) {
      tokenize(line.ko).forEach(function (tok) {
        stats.tokens++;
        // 照合順: 機能語の見出し → 名詞(＋助詞) → 機能語＋助詞 → 14活用形 → 拡張語尾
        var hit = idx.other.get(tok) || idx.noun.get(tok) || idx.otherP.get(tok) ||
          idx.form.get(tok) || idx.ext.get(tok);
        if (!hit) {
          var key = stripParticle(tok);
          var u = unknown.get(key);
          if (!u) unknown.set(key, (u = { ko: key, count: 0, ex: [] }));
          u.count++;
          if (u.ex.length < 2 && u.ex.indexOf(line.i) < 0) u.ex.push(line.i);
          return;
        }
        stats.hits++;
        var w = hit.w, e = words.get(w.ko);
        if (!e) {
          words.set(w.ko, (e = {
            ko: w.ko, type: w.type, ja: w.ja, cat: w.cat, pos: w.pos || null,
            weak: !!w.weak,
            count: 0, surfaces: {}, forms: {}, exts: {}, ex: [], at: [],
            certain: false, ambiguous: false
          }));
        }
        e.count++;
        e.surfaces[tok] = (e.surfaces[tok] || 0) + 1;
        if (hit.kind === 'form') { e.forms[hit.key] = (e.forms[hit.key] || 0) + 1; e.certain = true; }
        else if (hit.kind === 'noun' || hit.kind === 'other') { e.certain = true; }
        else { e.exts[hit.label] = (e.exts[hit.label] || 0) + 1; }
        if (hit.ambiguous) e.ambiguous = true;
        if (e.ex.length < 3 && e.ex.indexOf(line.i) < 0) {
          e.ex.push(line.i);
          e.at.push(line.t || 0);      // 動画のその位置へ飛ぶためのミリ秒。字幕本文が無くても使える
        }
      });
    });

    var list = Array.from(words.values());
    list.forEach(function (e) {
      // 確実な照合が1度も無い（拡張語尾だけ）／同綴りの語がある → 要確認
      e.needsCheck = !e.certain || e.ambiguous;
      // 「거」「수」のような索引専用の語は出題しない（カバー率の計算には数える）
      e.include = !e.needsCheck && !e.weak;
    });
    list.sort(function (a, b) { return b.count - a.count || a.ko.localeCompare(b.ko); });

    var unk = Array.from(unknown.values())
      .filter(function (u) { return u.ko.length >= 2; })
      .sort(function (a, b) { return b.count - a.count; });

    stats.coverage = stats.tokens ? stats.hits / stats.tokens : 0;
    stats.nouns = list.filter(function (e) { return e.type === 'noun'; }).length;
    stats.preds = list.filter(function (e) { return e.type === 'verb' || e.type === 'adj'; }).length;
    stats.others = list.filter(function (e) { return e.type === 'other'; }).length;
    stats.quizzable = list.filter(function (e) { return e.include; }).length;
    // 未知語の性質（この動画が語彙的に難しいかどうかの判断材料）
    var unkTokens = 0, once = 0;
    unknown.forEach(function (u) { unkTokens += u.count; if (u.count === 1) once++; });
    stats.unknownTokens = unkTokens;
    stats.unknownOnceRatio = unknown.size ? once / unknown.size : 0;
    return { words: list, unknown: unk, stats: stats };
  }

  return {
    PARTICLES: PARTICLES, extForms: extForms, buildIndex: buildIndex,
    tokenize: tokenize, stripParticle: stripParticle, run: run
  };
});

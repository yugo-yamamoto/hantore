/* ============================================================
 * deck.js - 動画から作ったデッキの読み込み
 *
 *   DECKS.init()      decks/index.json と各デッキを読み込む（Promise）
 *   DECKS.list()      デッキ一覧
 *   DECKS.pool(id)    出題プール { nouns, preds, meta, title }
 *
 * デッキは「単語のキー（ko）」しか持たない。訳・品詞・不規則は
 * 常に js/data.js（手作り辞書）を正本として引く。
 * ============================================================ */
(function (root) {
  'use strict';

  var DATA = root.DATA, byKo = {};
  (DATA.NOUNS.concat(DATA.PREDS, DATA.OTHERS || [])).forEach(function (w) { byKo[w.ko] = w; });

  var index = [], decks = {};

  function fetchJSON(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  function init() {
    return fetchJSON('decks/index.json').then(function (list) {
      index = Array.isArray(list) ? list : [];
      return Promise.all(index.map(function (it) {
        return fetchJSON('decks/' + it.id + '.json')
          .then(function (d) { decks[it.id] = d; })
          .catch(function (e) { console.warn('デッキ読み込み失敗', it.id, e); });
      }));
    }).then(function () { return index; }, function (e) {
      index = [];                       // decks/index.json が無い＝デッキ未作成
      return Promise.reject(e);
    });
  }

  function list() { return index.filter(function (it) { return decks[it.id]; }); }
  function get(id) { return decks[id]; }

  /** 出題プールを作る（辞書に載っている語だけ・include が false の語は除く） */
  function pool(id) {
    var d = decks[id];
    if (!d) return null;
    var out = { id: id, title: (d.source || {}).title || id, nouns: [], preds: [], others: [], meta: {} };
    var lines = d.lines || [];
    (d.words || []).forEach(function (e) {
      if (e.include === false) return;
      var w = byKo[e.ko];
      if (!w || w.weak) return;                         // 辞書から消えた語・索引専用の語は除く
      (w.type === 'noun' ? out.nouns : (w.type === 'other' ? out.others : out.preds)).push(w);
      out.meta[w.ko] = {
        count: e.count || 0,
        forms: e.forms || {},
        surfaces: e.surfaces || {},
        ex: (e.ex || []).map(function (i) { return lines[i]; }).filter(Boolean)
      };
    });
    return out;
  }

  /** そのデッキで開けるコースと語数 */
  function courses(id) {
    var p = pool(id);
    if (!p) return [];
    var n = p.nouns.length, v = p.preds.length, o = p.others.length, all = n + v + o;
    return [
      { mode: 'noun-k2j', label: '名詞 韓→日', count: n, ok: n >= 4 },
      { mode: 'noun-j2k', label: '名詞 日→韓', count: n, ok: n >= 4 },
      { mode: 'pred-k2j', label: '用言 韓→日', count: v, ok: v >= 4 },
      { mode: 'pred-j2k', label: '用言 日→韓', count: v, ok: v >= 4 },
      { mode: 'conj-k2j', label: '活用 韓→日', count: v, ok: v >= 1 },
      { mode: 'conj-j2k', label: '活用 日→韓', count: v, ok: v >= 1 },
      { mode: 'other-k2j', label: '副詞など 韓→日', count: o, ok: o >= 4 },
      { mode: 'other-j2k', label: '副詞など 日→韓', count: o, ok: o >= 4 },
      { mode: 'listen', label: '🔊 聞き取り', count: all, ok: all >= 4 },
      { mode: 'mix', label: '🎯 ミックス', count: all, ok: all >= 4 }
    ];
  }

  root.DECKS = { init: init, list: list, get: get, pool: pool, courses: courses, byKo: byKo };
})(window);

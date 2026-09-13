/* ============================================================
 * themes.js - テーマ別にまとめて覚えるための語のグループ
 *
 *   THEMES.list()      テーマ一覧
 *   THEMES.pool(id)    出題プール { nouns, preds, others, words, ... }
 *   THEMES.courses(id) そのテーマで開けるコース
 *
 * テーマは「語の並び順つきの ko リスト」だけを持ち、訳・品詞・不規則は
 * js/data.js を正本として引く（動画デッキと同じ考え方）。
 * 並び順には意味がある（曜日は月→日、数字は 0→10、方角は東西南北）。
 *
 * gloss は「そのテーマの中だけの訳」。일(日・仕事)・팔(腕)・열(熱) のように
 * 既存の語と綴りが同じ数詞を、辞書を汚さずに数として出題するために使う。
 * ============================================================ */
(function (root, factory) {
  var DATA = root.DATA || (typeof require === 'function' ? require('./data.js') : null);
  var api = factory(DATA);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.THEMES = api;
})(typeof window !== 'undefined' ? window : globalThis, function (DATA) {
  'use strict';

  var DEFS = [
    { id: 'days', label: '曜日', icon: '📅', hint: '月曜から日曜まで',
      words: ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일',
              '요일', '평일', '주말'] },

    { id: 'num-native', label: '固有数詞', icon: '1️⃣', hint: 'ひとつ・ふたつ…（数えるときの数）',
      gloss: { '열': 'とお（10）' },
      words: ['하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉', '열'] },

    { id: 'num-sino', label: '漢数詞', icon: '🔢', hint: '値段・電話番号・日付で使う数',
      gloss: { '일': '1（イル）', '팔': '8（パル）' },
      words: ['영', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구', '십',
              '백', '천', '만'] },

    { id: 'counters', label: '助数詞・単位', icon: '🔟', hint: '～個・～人・～時間の数え方',
      words: ['번', '명', '살', '권', '장', '마리', '시', '분', '초',
              '월', '년', '원', '숫자', '번호'] },

    { id: 'direction', label: '方向・位置', icon: '🧭', hint: '東西南北・上下前後左右',
      words: ['동쪽', '서쪽', '남쪽', '북쪽', '왼쪽', '오른쪽',
              '앞', '뒤', '위', '아래', '옆', '안쪽', '밖', '사이', '방향'] },

    { id: 'sports', label: 'スポーツ', icon: '⚽', hint: '球技から登山まで',
      words: ['운동', '축구', '야구', '농구', '배구', '탁구', '테니스', '골프',
              '수영', '스키', '등산', '달리기', '낚시', '경기', '선수', '팀', '우승'] },

    { id: 'transport', label: '交通', icon: '🚌', hint: '乗り物と道',
      words: ['자동차', '택시', '버스', '지하철', '기차', '비행기', '자전거', '오토바이',
              '교통', '길', '거리', '신호등', '횡단보도', '표지판', '출발', '도착'] },

    { id: 'school', label: '学校・勉強', icon: '🏫', hint: '授業・宿題・試験',
      words: ['학교', '공부', '수업', '숙제', '시험', '문제', '답', '점수', '성적',
              '질문', '대답', '연습', '복습', '예습', '학년', '학기', '반', '졸업', '입학'] },

    { id: 'subjects', label: '教科・学校の種類', icon: '📚', hint: '数学・科学…／小学校〜大学',
      words: ['수학', '과학', '역사', '미술', '체육', '외국어', '전공',
              '유치원', '초등학교', '중학교', '고등학교', '대학교', '학원'] },

    { id: 'family', label: '家族', icon: '👨‍👩‍👧', hint: '呼び方は話し手の性別で変わる',
      words: ['가족', '아버지', '어머니', '아빠', '엄마', '부모님',
              '형', '누나', '오빠', '언니', '동생', '형제', '자매',
              '아들', '딸', '아내', '남편', '할아버지', '할머니', '아기'] },

    { id: 'body', label: 'からだ', icon: '🖐', hint: '頭から足まで',
      words: ['몸', '머리', '얼굴', '눈', '코', '입', '귀', '목',
              '어깨', '팔', '손', '손가락', '가슴', '등', '허리',
              '무릎', '발', '피부', '뼈', '힘'] },

    { id: 'fruit-veg', label: '果物・野菜', icon: '🍎', hint: '市場で使う言葉',
      words: ['과일', '사과', '포도', '수박', '딸기', '바나나', '오렌지', '귤', '복숭아', '감',
              '채소', '배추', '무', '오이', '당근', '양파', '마늘', '파', '고추', '감자', '고구마'] },

    { id: 'weather', label: '季節・天気', icon: '🌤', hint: '四季と空模様',
      words: ['계절', '봄', '여름', '가을', '겨울',
              '날씨', '비', '눈', '바람', '구름', '안개', '천둥', '무지개', '태풍', '기온'] },

    { id: 'colors', label: '色', icon: '🎨', hint: '色は形容詞（ㅎ不規則）',
      words: ['색', '빨갛다', '파랗다', '노랗다', '하얗다', '검다'] }
  ];

  var byKo = {};
  (DATA.NOUNS.concat(DATA.PREDS, DATA.OTHERS || [])).forEach(function (w) { byKo[w.ko] = w; });

  function list() {
    return DEFS.map(function (d) {
      var p = pool(d.id);
      return { id: d.id, label: d.label, icon: d.icon, hint: d.hint, count: p ? p.words.length : 0 };
    });
  }
  function get(id) {
    for (var i = 0; i < DEFS.length; i++) if (DEFS[i].id === id) return DEFS[i];
    return null;
  }

  /** 出題プールを作る（並び順は定義のまま） */
  function pool(id) {
    var d = get(id);
    if (!d) return null;
    var out = {
      id: d.id, kind: 'theme', title: d.label, icon: d.icon, hint: d.hint,
      words: [], nouns: [], preds: [], others: []
    };
    d.words.forEach(function (ko) {
      var base = byKo[ko];
      if (!base) { console.warn('テーマ「' + d.label + '」の語が辞書にありません: ' + ko); return; }
      var w = base;
      if (d.gloss && d.gloss[ko]) {            // このテーマの中だけ別の訳で出す
        w = {}; Object.keys(base).forEach(function (k) { w[k] = base[k]; });
        w.ja = d.gloss[ko];
        w.cat = '数';                          // 誤答も数字から選ばれるようにする
      }
      out.words.push(w);
      (w.type === 'noun' ? out.nouns : (w.type === 'other' ? out.others : out.preds)).push(w);
    });
    return out;
  }

  /** そのテーマで開けるコース */
  function courses(id) {
    var p = pool(id);
    if (!p) return [];
    var n = p.words.length;
    var v = p.preds.length;
    var listenable = p.words.filter(function (w) { return w.ko.length >= 2; }).length;
    return [
      { mode: 'all-k2j', label: '韓 → 日', count: n, ok: n >= 4, main: true },
      { mode: 'all-j2k', label: '日 → 韓', count: n, ok: n >= 4 },
      { mode: 'listen', label: '🔊 聞き取り', count: listenable, ok: listenable >= 4 },
      { mode: 'conj-j2k', label: '活用 日→韓', count: v, ok: v >= 1 },
      { mode: 'mix', label: '🎯 ミックス', count: n, ok: n >= 4 }
    ];
  }

  /** テーマの問題数（12語以下なら2周、それ以上なら1周。10〜24問に収める） */
  function questionCount(id) {
    var p = pool(id);
    var n = p ? p.words.length : 0;
    var q = n <= 12 ? n * 2 : n;
    return Math.max(10, Math.min(24, q));
  }

  return { list: list, get: get, pool: pool, courses: courses, questionCount: questionCount, DEFS: DEFS };
});

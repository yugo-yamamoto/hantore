/* ============================================================
 * speech.js - 韓国語の読み上げ（Web Speech API）
 *   SPEECH.btn(text)   … 読み上げボタンのHTMLを返す
 *   SPEECH.speak(text) … 読み上げる
 * ============================================================ */
(function (root) {
  'use strict';

  var SP = {
    supported: typeof window !== 'undefined' && 'speechSynthesis' in window,
    enabled: true,
    rate: 0.95,
    voice: null,
    voiceName: '(未取得)',
    onlog: null
  };

  function log(msg, level) { if (SP.onlog) SP.onlog(msg, level); }

  /** 韓国語の音声を選ぶ */
  function pickVoice() {
    if (!SP.supported) return null;
    var vs = window.speechSynthesis.getVoices() || [];
    var ko = vs.filter(function (v) { return /^ko/i.test(v.lang); });
    // Windows の韓国語音声（Microsoft SunHi / InJoon）や Google 한국의 を優先
    ko.sort(function (a, b) {
      var score = function (v) {
        if (/google/i.test(v.name)) return 0;
        if (/heami|sunhi|injoon/i.test(v.name)) return 1;
        return 2;
      };
      return score(a) - score(b);
    });
    SP.voice = ko[0] || null;
    SP.voiceName = SP.voice ? SP.voice.name + ' (' + SP.voice.lang + ')' : '(韓国語音声なし)';
    return SP.voice;
  }

  function init() {
    if (!SP.supported) { log('この環境は音声合成に未対応です', 'warn'); return; }
    pickVoice();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = function () {
        var before = SP.voiceName;
        pickVoice();
        if (before !== SP.voiceName) log('音声を選択: ' + SP.voiceName);
      };
    }
    log('音声合成: ' + SP.voiceName);
  }

  /** 読み上げ（btnEl を渡すと再生中クラスを付ける） */
  function speak(text, btnEl) {
    if (!SP.supported) { log('読み上げ不可（音声合成に未対応）', 'warn'); return; }
    if (!SP.enabled) return;
    text = String(text || '').trim();
    if (!text) return;
    try {
      window.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      u.rate = SP.rate;
      u.pitch = 1;
      if (!SP.voice) pickVoice();
      if (SP.voice) u.voice = SP.voice;
      if (btnEl) {
        btnEl.classList.add('playing');
        var off = function () { btnEl.classList.remove('playing'); };
        u.onend = off; u.onerror = off;
        setTimeout(off, 4000);
      }
      window.speechSynthesis.speak(u);
      log('🔊 読み上げ: ' + text + (SP.voice ? '' : '（韓国語音声が見つからないため既定音声）'));
    } catch (e) {
      log('読み上げ失敗: ' + e.message, 'err');
    }
  }

  /** ハングルを含むか */
  function hasHangul(s) { return /[가-힣]/.test(String(s || '')); }

  /** 韓国語として読み上げてよい文字列か（ハングルを含み、かな・漢字を含まない） */
  function isKorean(s) {
    s = String(s || '');
    return /[가-힣]/.test(s) && !/[\u3040-\u30ff\u4e00-\u9fff]/.test(s);
  }

  /** 読み上げボタンのHTML（韓国語でないときは空文字） */
  function btn(text, cls) {
    if (!isKorean(text)) return '';
    var t = String(text).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
    return '<button class="spk' + (cls ? ' ' + cls : '') + '" data-speak="' + t +
      '" title="読み上げ（' + t + '）" aria-label="読み上げ">🔊</button>';
  }

  SP.init = init; SP.speak = speak; SP.btn = btn;
  SP.hasHangul = hasHangul; SP.isKorean = isKorean; SP.pickVoice = pickVoice;
  root.SPEECH = SP;
})(typeof window !== 'undefined' ? window : globalThis);

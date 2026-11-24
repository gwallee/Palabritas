'use strict';

/* Conservative Spanish syllabification. Returns null when the input is outside
   the supported spelling rules; callers must then omit syllable help. */
(function (root) {
  const VOWEL = /[aeiouáéíóúü]/i;
  const LETTERS = /^[a-záéíóúüñ]+$/i;
  const STRONG = /[aeoáéíóú]/i;
  const ACCENTED_WEAK = /[íú]/i;
  // 'tl' stays together (a·tle·ta, ná·huatl) — the Mexican convention, matching the es-MX voice
  const ONSET_2 = new Set(['bl','br','ch','cl','cr','dr','fl','fr','gl','gr','ll','pl','pr','rr','tr','tl']);

  function vowelTogether(a, b) {
    if (ACCENTED_WEAK.test(a) || ACCENTED_WEAK.test(b)) return false;
    return !(STRONG.test(a) && STRONG.test(b));
  }

  function syllabifySpanish(value) {
    const word = String(value || '').trim().toLowerCase().normalize('NFC');
    if (!word || !LETTERS.test(word) || !VOWEL.test(word)) return null;
    if (/^sub[lr]/.test(word)) return null;   // sub·ra·yar vs su·bli·me — prefix, can't tell
    const nuclei = [];
    for (let i = 0; i < word.length;) {
      if (!VOWEL.test(word[i])) { i++; continue; }
      const start = i++;
      // h is always a consonant here: joining vowels across it turned
      // ca·ca·hua·te into ca·cahua·te and chi·hua·hua into one syllable.
      while (i < word.length && VOWEL.test(word[i])) {
        if (!vowelTogether(word[i - 1], word[i])) break;
        i++;
      }
      nuclei.push([start, i]);
    }
    if (!nuclei.length) return null;
    const breaks = [0];
    for (let n = 0; n < nuclei.length - 1; n++) {
      const leftEnd = nuclei[n][1], rightStart = nuclei[n + 1][0];
      const cluster = word.slice(leftEnd, rightStart);
      let split;
      if (cluster.length <= 1) split = leftEnd;
      else if (cluster.length === 2) split = ONSET_2.has(cluster) ? leftEnd : leftEnd + 1;
      else if (cluster.length === 3) split = ONSET_2.has(cluster.slice(1)) ? leftEnd + 1 : leftEnd + 2;
      else return null; // compounds/loanwords: confidence is deliberately low
      breaks.push(split);
    }
    breaks.push(word.length);
    const parts = [];
    for (let i = 0; i < breaks.length - 1; i++) {
      const part = word.slice(breaks[i], breaks[i + 1]);
      if (!part || !VOWEL.test(part)) return null;
      parts.push(part);
    }
    return parts.length ? parts : null;
  }

  root.syllabifySpanish = syllabifySpanish;
  if (typeof module !== 'undefined') module.exports = { syllabifySpanish };
})(typeof globalThis !== 'undefined' ? globalThis : window);

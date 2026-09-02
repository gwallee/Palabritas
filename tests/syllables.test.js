'use strict';
const assert = require('node:assert/strict');
const { syllabifySpanish } = require('../syllables.js');

const cases = {
  mariposa: ['ma','ri','po','sa'], biblioteca: ['bi','blio','te','ca'],
  ferrocarril: ['fe','rro','ca','rril'], queso: ['que','so'],
  guitarra: ['gui','ta','rra'], pingüino: ['pin','güi','no'],
  país: ['pa','ís'], miércoles: ['miér','co','les'], héroe: ['hé','ro','e'],
  escuela: ['es','cue','la'], avión: ['a','vión'], mañana: ['ma','ña','na'],
};
for (const [word, expected] of Object.entries(cases)) assert.deepEqual(syllabifySpanish(word), expected, word);
for (const word of ['co-op', 'rockstar', '123', '', 'psst']) assert.equal(syllabifySpanish(word), null, word);
console.log(`syllables: ${Object.keys(cases).length} trusted cases passed`);

/* Palabritas — paint-by-number reward pictures (v2.0)
 *
 * Six hand-drawn SVG scenes, each split into paint regions. During a practice
 * round every correct answer paints the next region(s); the finished picture
 * is revealed on the done screen and collected in the home-screen Museo.
 *
 * Region formats: { c: paletteIndex, d: 'path' }  |  { c, circle: [cx,cy,r] }
 *                 { c, ell: [cx,cy,rx,ry,rot?] }
 * `l: [x,y]` places the printed number (auto-centered for circle/ell; a region
 * with no `l` and no center shows no number). Regions paint in array order —
 * backgrounds first, faces and sparkles last, so the subject "comes alive" at
 * the end. `deco` entries are outline details (smiles, whiskers, rays) that
 * appear once the region at index `when` has been painted; `f` makes a deco
 * filled instead of stroked.
 */

const PAINTINGS = [

  /* ---------- 1. El unicornio — night sky, rainbow mane ---------- */
  {
    id: 'unicornio', name: 'El unicornio', emoji: '🦄',
    pal: ['#43327f', '#ffd966', '#ffffff', '#ffc2dd', '#f6b83c', '#ff6fa5', '#9b59d0', '#4aa3e8', '#35c4b5', '#3a3147'],
    regions: [
      { c: 0, d: 'M0 0H100V100H0Z', l: [8, 92] },
      { c: 1, l: [14, 14], d: 'M12 11 L14.5 14 L12 17 L9.5 14 Z M26 6 L28 8.5 L26 11 L24 8.5 Z M88 10 L90.5 13 L88 16 L85.5 13 Z M79 25 L80.8 27.2 L79 29.4 L77.2 27.2 Z M9 42 L11 44.5 L9 47 L7 44.5 Z M93 46 L95 48.5 L93 51 L91 48.5 Z M14 66 L16 68.5 L14 71 L12 68.5 Z' },
      { c: 2, d: 'M36 100 C37 76 44 62 58 54 L84 62 C80 78 78 88 78 100 Z', l: [58, 86] },
      { c: 2, d: 'M58 24 C46 20 34 28 29 40 C26 46 27 51 32 53 L42 55 C46 61 55 63 62 58 C69 53 70 42 67 33 Z', l: [50, 44] },
      { c: 4, d: 'M52 27 L43 5 L60 24 Z', l: [51, 20] },
      { c: 5, d: 'M58 22 C74 20 83 34 81 52 C79 66 73 78 64 88 C71 72 72 59 68 47 C65 36 62 29 58 22 Z', l: [73, 42] },
      { c: 6, d: 'M62 28 C74 32 78 44 76 56 C74 68 68 80 60 88 C66 74 68 62 64 50 C61 40 60 33 62 28 Z', l: [70, 62] },
      { c: 7, d: 'M64 38 C72 44 72 56 68 66 C64 76 58 84 52 90 C58 76 60 64 58 54 C57 46 60 41 64 38 Z', l: [61, 76] },
      { c: 8, d: 'M70 48 C75 57 74 68 68 80 C64 87 60 92 57 96 C61 84 63 72 62 62 C63 53 66 48 70 48 Z', l: [66, 70] },
      { c: 5, d: 'M58 24 C52 14 42 14 37 21 C44 18 51 23 53 30 Z', l: [48, 21] },
      { c: 2, d: 'M66 30 L75 14 L80 29 Z', l: [74, 26] },
      { c: 3, d: 'M68.8 28 L74.8 17.5 L77.6 27 Z' },
      { c: 3, circle: [37, 48, 3.4] },
      { c: 9, circle: [44, 41, 2.5] },
    ],
    deco: [
      { d: 'M49 23 L55 25 M47 17 L53 20 M45.5 11 L50 14', when: 4, w: 0.9 },
      { d: 'M46 37.5 Q48.5 35.5 51 36.5', when: 13, w: 1 },
      { d: 'M30.5 48 Q33 50.5 36.5 50', when: 13, w: 1 },
      { d: 'M33.8 44.2 A1.2 1.2 0 1 1 33.7 44.1', when: 13, w: 0.8 },
    ],
  },

  /* ---------- 2. La sirena — underwater ---------- */
  {
    id: 'sirena', name: 'La sirena', emoji: '🧜‍♀️',
    pal: ['#8fd9ea', '#54b6d9', '#2f8fbb', '#ffe2a8', '#d94f93', '#ffd9b8', '#2fbf9b', '#1d9a7c', '#8e6fd8', '#eafaff', '#ff9f5b', '#3da56b', '#ff7f6e', '#3a3147'],
    regions: [
      { c: 0, d: 'M0 0H100V36H0Z', l: [8, 8] },
      { c: 1, d: 'M0 36H100V68H0Z', l: [92, 42] },
      { c: 2, d: 'M0 68H100V100H0Z', l: [8, 76] },
      { c: 3, d: 'M0 87 C18 81 38 91 58 85 C76 80 90 87 100 84 V100 H0 Z', l: [88, 95] },
      { c: 11, d: 'M5 98 C1 88 10 82 5 70 C12 79 9 88 12 98 Z M14 98 C11 90 18 84 15 74 C22 84 17 92 20 98 Z', l: [9, 64] },
      { c: 9, d: 'M80 18 a2.2 2.2 0 1 0 0.01 0 Z M86 29 a1.5 1.5 0 1 0 0.01 0 Z M76 37 a1.8 1.8 0 1 0 0.01 0 Z M88 45 a1.3 1.3 0 1 0 0.01 0 Z M23 23 a1.6 1.6 0 1 0 0.01 0 Z M29 14 a1.2 1.2 0 1 0 0.01 0 Z', l: [81, 11] },
      { c: 10, d: 'M13 46 a6 3.6 0 1 0 0.01 0 Z M13.5 46 L5 41 L7 46 L5 51 Z', l: [15, 46] },
      { c: 6, d: 'M48 57 C40 66 33 72 30 81 C29 84 30 87 32 88 C36 88 40 84 44 78 C50 70 55 64 58 59 Z', l: [44, 70] },
      { c: 7, d: 'M33 85 L19 79 L27 91 Z M33 88 L23 100 L39 96 Z', l: [28, 90] },
      { c: 7, d: 'M44 64 C39 70 35 75 33 80 L35.5 82 C38 77 42 71 47 66.5 Z' },
      { c: 5, d: 'M48 39 C45 47 47 54 52 58 L58 56 C58 47 58 42 56 37 Z', l: [53, 49] },
      { c: 5, d: 'M53 44 C59 46 65 50 69 56 L66.5 59 C60 54 55 50 51.5 47.5 Z' },
      { c: 5, circle: [58, 30, 7.5] },
      { c: 4, d: 'M58 19 C50 18 44 24 45 32 C41 38 43 46 48 52 C46 44 47 37 50 32 C51 26 54 23 58 22.5 C63 22 67 26 68 31 C71 41 68 51 62 59 C70 51 73 40 70 30 C68 22 64 19.5 58 19 Z', l: [46, 27] },
      { c: 4, d: 'M67 32 C71 40 70 50 64 58 C70 60 75 54 76 46 C77 39 73 34 67 32 Z' },
      { c: 8, d: 'M49 41.5 a3 3 0 1 0 0.01 0 Z M55.5 40.5 a3 3 0 1 0 0.01 0 Z', l: [52, 36] },
      { c: 12, d: 'M72 86 L75 91 L81 91 L76.5 94.5 L78 100 L72 96.5 L66 100 L67.5 94.5 L63 91 L69 91 Z', l: [72, 92] },
      { c: 13, circle: [56, 30.5, 1.1] },
    ],
    deco: [
      { d: 'M58 34 Q60 35.5 62 34', when: 17, w: 0.9 },
      { d: 'M10.5 45.5 A0.8 0.8 0 1 1 10.4 45.4', when: 6, w: 0.7 },
      { d: 'M53 93 Q56 90 59 93 M55 96 Q56.5 94.5 58 96', when: 3, w: 0.8 },
    ],
  },

  /* ---------- 3. El castillo — rainbow castle ---------- */
  {
    id: 'castillo', name: 'El castillo', emoji: '🏰',
    pal: ['#ffd1dd', '#ffd966', '#ffffff', '#ff6b8a', '#ffd166', '#5fd3bc', '#9b7bdc', '#7bc96f', '#55a04c', '#efe6f7', '#d9c9ef', '#ff6fa5', '#8f6fd8', '#b07bd6'],
    regions: [
      { c: 0, d: 'M0 0H100V100H0Z', l: [50, 8] },
      { c: 1, circle: [14, 15, 8] },
      { c: 3, d: 'M-4 96 A54 54 0 0 1 104 96 L100 96 A50 50 0 0 0 0 96 Z', l: [4, 88] },
      { c: 4, d: 'M0 96 A50 50 0 0 1 100 96 L96 96 A46 46 0 0 0 4 96 Z', l: [8, 91] },
      { c: 5, d: 'M4 96 A46 46 0 0 1 96 96 L92 96 A42 42 0 0 0 8 96 Z', l: [11.5, 94] },
      { c: 6, d: 'M8 96 A42 42 0 0 1 92 96 L88 96 A38 38 0 0 0 12 96 Z', l: [88, 94] },
      { c: 2, d: 'M70 22 a5 5 0 1 0 0.01 0 Z M76 24 a6 6 0 1 0 0.01 0 Z M83 22.5 a4.5 4.5 0 1 0 0.01 0 Z M14 36 a4 4 0 1 0 0.01 0 Z M19 38 a5 5 0 1 0 0.01 0 Z M25 36.5 a3.6 3.6 0 1 0 0.01 0 Z', l: [77, 24] },
      { c: 7, d: 'M0 80 C18 70 42 72 58 76 C76 81 90 76 100 80 V100 H0 Z', l: [14, 80] },
      { c: 8, d: 'M0 92 C25 84 60 90 100 86 V100 H0 Z', l: [50, 95] },
      { c: 9, d: 'M38 46 H62 V86 H38 Z', l: [50, 66] },
      { c: 9, d: 'M40 41 h5 v5 h-5 Z M47.5 41 h5 v5 h-5 Z M55 41 h5 v5 h-5 Z' },
      { c: 10, d: 'M27 52 H39 V86 H27 Z M61 52 H73 V86 H61 Z', l: [33, 70] },
      { c: 11, d: 'M25 52 L33 32 L41 52 Z', l: [33, 47] },
      { c: 12, d: 'M59 52 L67 32 L75 52 Z', l: [67, 47] },
      { c: 12, d: 'M41 46 L50 24 L59 46 Z', l: [50, 41] },
      { c: 11, d: 'M50 24 L50 16 L58 19.5 Z M33 32 L33 24 L40 27.5 Z M67 32 L67 24 L74 27.5 Z' },
      { c: 13, d: 'M44.5 86 V74 A5.5 5.5 0 0 1 55.5 74 V86 Z', l: [50, 80] },
      { c: 1, d: 'M31 58 h4 v6 h-4 Z M65 58 h4 v6 h-4 Z M44 54 h4 v6 h-4 Z M52 54 h4 v6 h-4 Z', l: [33, 61] },
      { c: 10, d: 'M46 92 a3 1.6 0 1 0 0.01 0 Z M53 95 a3.4 1.8 0 1 0 0.01 0 Z M43 97.5 a3 1.6 0 1 0 0.01 0 Z' },
    ],
    deco: [
      { d: 'M14 2 V6 M14 24 V28 M1 15 H5 M23 15 H27 M4.8 5.8 L7.6 8.6 M20.4 21.4 L23.2 24.2 M23.2 5.8 L20.4 8.6 M7.6 21.4 L4.8 24.2', when: 1, w: 1.1, col: '#f3b53c' },
      { d: 'M50 24 V16 M33 32 V24 M67 32 V24', when: 15, w: 0.9 },
    ],
  },

  /* ---------- 4. El gatito — kitten with a crown ---------- */
  {
    id: 'gatito', name: 'El gatito', emoji: '😺',
    pal: ['#e7dcff', '#ffffff', '#ffd7ea', '#ffc98f', '#ef9f5a', '#fff3e0', '#ffb3cf', '#ffd04d', '#ff6fa5', '#453a50', '#ffa8c5', '#ff5e8a'],
    regions: [
      { c: 0, d: 'M0 0H100V100H0Z', l: [8, 50] },
      { c: 1, d: 'M12 30 a2.4 2.4 0 1 0 0.01 0 Z M88 34 a2 2 0 1 0 0.01 0 Z M8 62 a1.8 1.8 0 1 0 0.01 0 Z M92 60 a2.2 2.2 0 1 0 0.01 0 Z M24 10 a1.8 1.8 0 1 0 0.01 0 Z M76 8 a2 2 0 1 0 0.01 0 Z', l: [12, 24] },
      { c: 2, d: 'M0 84 C30 80 70 88 100 83 V100 H0 Z', l: [14, 92] },
      { c: 4, d: 'M68 80 C84 76 90 62 82 52 C88 64 82 74 68 75 Z', l: [83, 62] },
      { c: 3, d: 'M30 86 C28 66 38 56 50 56 C62 56 72 66 70 86 Z', l: [38, 74] },
      { c: 5, ell: [50, 76, 9, 8] },
      { c: 5, d: 'M37 86 a5 3.5 0 1 0 0.01 0 Z M53 86 a5 3.5 0 1 0 0.01 0 Z' },
      { c: 3, d: 'M30 30 L35 10 L46 25 Z M70 30 L65 10 L54 25 Z', l: [33, 24] },
      { c: 6, d: 'M33.5 27 L36.5 15 L43 24 Z M66.5 27 L63.5 15 L57 24 Z' },
      { c: 3, ell: [50, 40, 21, 17.5] },
      { c: 4, d: 'M30 36 C27 40 27 46 29 50 C27 44 29 39 32 36 Z M70 36 C73 40 73 46 71 50 C73 44 71 39 68 36 Z' },
      { c: 5, ell: [50, 47, 8.5, 6] },
      { c: 7, d: 'M40 15 L43 5 L48 11 L52 3 L56.5 11 L61 5 L64 15 Q52 18.5 40 15 Z', l: [52, 13] },
      { c: 11, d: 'M43.5 11.5 a1.3 1.3 0 1 0 0.01 0 Z M51 10 a1.3 1.3 0 1 0 0.01 0 Z M58.5 11.5 a1.3 1.3 0 1 0 0.01 0 Z' },
      { c: 9, d: 'M42 36 a2.8 3.6 0 1 0 0.01 0 Z M58 36 a2.8 3.6 0 1 0 0.01 0 Z', l: [50, 32] },
      { c: 1, d: 'M42.8 35 a0.9 0.9 0 1 0 0.01 0 Z M58.8 35 a0.9 0.9 0 1 0 0.01 0 Z' },
      { c: 8, d: 'M48.3 44.5 L51.7 44.5 L50 47 Z' },
      { c: 10, d: 'M34 44 a2.6 1.8 0 1 0 0.01 0 Z M66 44 a2.6 1.8 0 1 0 0.01 0 Z' },
      { c: 11, d: 'M18 24 C14 20 12 16 15 14 C17 12.8 18 14.6 18 16 C18 14.6 19 12.8 21 14 C24 16 22 20 18 24 Z M82 20 C78 16 76 12 79 10 C81 8.8 82 10.6 82 12 C82 10.6 83 8.8 85 10 C88 12 86 16 82 20 Z', l: [18, 19] },
    ],
    deco: [
      { d: 'M50 47 V49 M50 49 Q47.5 51.5 45.5 49.5 M50 49 Q52.5 51.5 54.5 49.5', when: 16, w: 0.9 },
      { d: 'M27 42 L36 43 M27 47 L36 46.5 M73 42 L64 43 M73 47 L64 46.5', when: 16, w: 0.8 },
    ],
  },

  /* ---------- 5. El delfín — sunset leap ---------- */
  {
    id: 'delfin', name: 'El delfín', emoji: '🐬',
    pal: ['#ff8e72', '#ffb27e', '#ffd9a0', '#ffe08a', '#2e7fba', '#4aa3d8', '#ffffff', '#6ca6d9', '#dceefb', '#ffd966', '#3a3147'],
    regions: [
      { c: 0, d: 'M0 0H100V20H0Z', l: [8, 8] },
      { c: 1, d: 'M0 20H100V36H0Z', l: [92, 28] },
      { c: 2, d: 'M0 36H100V54H0Z', l: [8, 44] },
      { c: 3, d: 'M38 54 A12 12 0 0 1 62 54 Z', l: [50, 50] },
      { c: 4, d: 'M0 54H100V100H0Z', l: [12, 88] },
      { c: 5, d: 'M0 64 C15 60 30 68 50 64 C70 60 85 68 100 64 V74 C85 78 70 70 50 74 C30 78 15 70 0 74 Z', l: [90, 68] },
      { c: 6, d: 'M0 54 C15 51.5 30 56.5 50 54 C70 51.5 85 56.5 100 54 V58 C85 60.5 70 55.5 50 58 C30 60.5 15 55.5 0 58 Z' },
      { c: 6, d: 'M70 12 a4 4 0 1 0 0.01 0 Z M75 14 a5 5 0 1 0 0.01 0 Z M81 12.5 a3.6 3.6 0 1 0 0.01 0 Z M14 28 a3.4 3.4 0 1 0 0.01 0 Z M19 30 a4.2 4.2 0 1 0 0.01 0 Z M24 28.5 a3 3 0 1 0 0.01 0 Z', l: [76, 14] },
      { c: 7, d: 'M26 38 C30 22 48 10 64 16 C74 20 80 32 82 44 L86 52 L78 50 C76 42 70 34 62 32 C48 28 36 32 30 44 Z', l: [52, 20] },
      { c: 8, d: 'M30 44 C36 32 48 28 62 32 C70 34 76 42 78 50 L74 49 C70 40 64 35 58 33.5 C46 31 37 35.5 32 45 Z' },
      { c: 7, d: 'M54 15 C56 6 63 5 66 9 C62 9 58 12 57 17 Z', l: [60, 11] },
      { c: 7, d: 'M27 40 L14 32 L21 42 L13 48 L26 45 Z', l: [20, 40] },
      { c: 7, d: 'M58 33 C56 40 58 45 63 48 C64 42 62 36 60 33.5 Z' },
      { c: 6, d: 'M88 46 a1.7 1.7 0 1 0 0.01 0 Z M92 50 a1.3 1.3 0 1 0 0.01 0 Z M90 42 a1.2 1.2 0 1 0 0.01 0 Z M94 45 a1 1 0 1 0 0.01 0 Z' },
      { c: 9, d: 'M34 78 L36 80.5 L34 83 L32 80.5 Z M64 82 L66 84.5 L64 87 L62 84.5 Z M18 88 L20 90.5 L18 93 L16 90.5 Z M82 90 L84 92.5 L82 95 L80 92.5 Z', l: [34, 74] },
      { c: 10, circle: [72, 38, 1.5] },
    ],
    deco: [
      { d: 'M77 48 Q81.5 49.5 85.5 51.5', when: 15, w: 1 },
      { d: 'M84 18 Q87 15 90 18 Q93 15 96 18', when: 0, w: 1 },
      { d: 'M6 24 Q8.5 21.5 11 24 Q13.5 21.5 16 24', when: 0, w: 0.9 },
    ],
  },

  /* ---------- 6. La mariposa — butterfly meadow ---------- */
  {
    id: 'mariposa', name: 'La mariposa', emoji: '🦋',
    pal: ['#bfe7ff', '#ffd966', '#8fd47e', '#6abf63', '#ff9ec4', '#ffffff', '#ff7fb0', '#e85c92', '#a06fe0', '#35c4b5', '#54436b'],
    regions: [
      { c: 0, d: 'M0 0H100V100H0Z', l: [8, 10] },
      { c: 1, circle: [86, 13, 7] },
      { c: 2, d: 'M0 78 C20 70 45 74 60 78 C80 83 92 78 100 80 V100 H0 Z', l: [10, 82] },
      { c: 3, d: 'M0 92 C30 86 65 92 100 88 V100 H0 Z', l: [50, 96] },
      { c: 4, d: 'M10 88 a2.2 2.2 0 1 0 0.01 0 Z M22 93 a2 2 0 1 0 0.01 0 Z M78 92 a2.2 2.2 0 1 0 0.01 0 Z M90 87 a2 2 0 1 0 0.01 0 Z M38 95 a1.8 1.8 0 1 0 0.01 0 Z M62 94 a1.8 1.8 0 1 0 0.01 0 Z', l: [10, 83] },
      { c: 6, d: 'M48 46 C36 26 16 22 11 34 C7 46 26 58 46 54 Z', l: [28, 40] },
      { c: 6, d: 'M52 46 C64 26 84 22 89 34 C93 46 74 58 54 54 Z', l: [72, 40] },
      { c: 7, d: 'M46 50 C38 52 30 52 22 48 C30 56 42 58 47 54 Z M54 50 C62 52 70 52 78 48 C70 56 58 58 53 54 Z' },
      { c: 8, d: 'M47 54 C34 55 24 64 28 74 C32 83 45 78 49 62 Z', l: [36, 68] },
      { c: 8, d: 'M53 54 C66 55 76 64 72 74 C68 83 55 78 51 62 Z', l: [64, 68] },
      { c: 9, d: 'M20 37 a4.6 4.6 0 1 0 0.01 0 Z M80 37 a4.6 4.6 0 1 0 0.01 0 Z', l: [20, 32] },
      { c: 5, d: 'M34 46 a2 2 0 1 0 0.01 0 Z M66 46 a2 2 0 1 0 0.01 0 Z M36 68 a1.8 1.8 0 1 0 0.01 0 Z M64 68 a1.8 1.8 0 1 0 0.01 0 Z' },
      { c: 10, ell: [50, 52, 3.2, 12] },
      { c: 10, circle: [50, 36, 4] },
      { c: 6, d: 'M14 12 C11 8 6 9 7 13 C8 16 12 15 14 12 Z M14 12 C17 8 22 9 21 13 C20 16 16 15 14 12 Z', l: [14, 18] },
    ],
    deco: [
      { d: 'M86 1.5 V4.5 M86 21.5 V24.5 M74.5 13 H77.5 M94.5 13 H97.5 M77.9 4.9 L80 7 M92 19 L94.1 21.1 M94.1 4.9 L92 7 M80 19 L77.9 21.1', when: 1, w: 1.1, col: '#f3b53c' },
      { d: 'M48.5 33 C46 29 42 28 40 30 M51.5 33 C54 29 58 28 60 30', when: 13, w: 1 },
      { d: 'M40.2 29.7 A1.1 1.1 0 1 1 40.1 29.6 M59.8 29.7 A1.1 1.1 0 1 1 59.9 29.8', when: 13, w: 0.9 },
      { d: 'M14 13 V10', when: 14, w: 0.8 },
    ],
  },
];

/* Shared renderer: returns SVG markup for `scene` with the first `painted`
   regions filled. Regions at index >= popFrom get a pop-in animation class. */
function paintingSVG(scene, painted, popFrom = Infinity) {
  let s = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="pbn-svg">'
    + '<rect x="0" y="0" width="100" height="100" fill="#fdf8ef"/>';
  scene.regions.forEach((r, i) => {
    const on = i < painted;
    let shape, lab = r.l;
    if (r.circle) {
      shape = `<circle cx="${r.circle[0]}" cy="${r.circle[1]}" r="${r.circle[2]}"`;
      lab = lab || [r.circle[0], r.circle[1]];
    } else if (r.ell) {
      shape = `<ellipse cx="${r.ell[0]}" cy="${r.ell[1]}" rx="${r.ell[2]}" ry="${r.ell[3]}"`
        + (r.ell[4] ? ` transform="rotate(${r.ell[4]} ${r.ell[0]} ${r.ell[1]})"` : '');
      lab = lab || [r.ell[0], r.ell[1]];
    } else {
      shape = `<path d="${r.d}"`;
    }
    s += shape
      + ` fill="${on ? scene.pal[r.c] : '#f4edDC'}"`
      + ` stroke="${on ? 'rgba(80,60,40,.16)' : '#cfc1a6'}" stroke-width="0.45"`
      + (on && i >= popFrom ? ` class="pbn-pop" style="animation-delay:${(i - popFrom) * 90}ms"` : '')
      + '/>';
    if (!on && lab) {
      s += `<text x="${lab[0]}" y="${lab[1]}" font-size="4.2" text-anchor="middle"`
        + ' dominant-baseline="central" fill="#a8997c" font-weight="700"'
        + ` font-family="ui-rounded, system-ui, sans-serif">${r.c + 1}</text>`;
    }
  });
  (scene.deco || []).forEach(dk => {
    if (painted > (dk.when || 0)) {
      s += `<path d="${dk.d}" fill="${dk.f || 'none'}"`
        + (dk.f ? '' : ` stroke="${dk.col || '#51455e'}" stroke-width="${dk.w || 1}" stroke-linecap="round" stroke-linejoin="round"`)
        + '/>';
    }
  });
  return s + '</svg>';
}

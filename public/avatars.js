/* ==========================================================
   AVATARS — shared between server (validation, bot assignment)
   and client (picker UI, rendering).

   Era-flavoured archetypes from the 1920s–30s Weimar period:
   detectives, journalists, cabaret performers, aviators, etc.
   No actual historical figures or political insignia.

   Each entry is a single inline SVG body (paths/shapes) drawn
   on a 64×64 viewBox with currentColor as the fill, so the
   avatar inherits the surrounding text colour. Render with:
     <svg viewBox="0 0 64 64" fill="currentColor">{body}</svg>
   ========================================================== */
(function() {
  const AVATARS = [
    { key: 'detective', label: 'Detective', body:
      '<path d="M10 36h44l-3-5c-3-9-10-15-19-15s-16 6-19 15z"/>' +
      '<rect x="6" y="36" width="52" height="4" rx="2"/>' +
      '<rect x="13" y="32" width="38" height="2.5" fill-opacity=".4"/>' +
      '<rect x="40" y="44" width="14" height="3" rx="1"/>' +
      '<circle cx="55" cy="46" r="2.5"/>'
    },
    { key: 'reporter', label: 'Reporter', body:
      '<rect x="14" y="22" width="36" height="22" rx="2"/>' +
      '<rect x="20" y="16" width="24" height="8" rx="1"/>' +
      '<rect x="18" y="28" width="22" height="10" fill-opacity=".4"/>' +
      '<rect x="20" y="30" width="18" height="1.5" fill-opacity=".7"/>' +
      '<rect x="20" y="33" width="14" height="1.5" fill-opacity=".7"/>' +
      '<rect x="20" y="36" width="16" height="1.5" fill-opacity=".7"/>'
    },
    { key: 'professor', label: 'Professor', body:
      '<polygon points="32,14 6,26 32,30 58,26"/>' +
      '<rect x="14" y="30" width="36" height="6" rx="1"/>' +
      '<path d="M52 24v16q0 4 4 4" stroke="currentColor" stroke-width="2" fill="none"/>' +
      '<circle cx="56" cy="46" r="3"/>' +
      '<rect x="22" y="38" width="20" height="14" rx="1" fill-opacity=".4"/>'
    },
    { key: 'cabaret', label: 'Cabaret Singer', body:
      '<circle cx="30" cy="42" r="14"/>' +
      '<path d="M28 30 Q22 18 8 12 Q12 22 16 30 Q22 28 28 30z"/>' +
      '<path d="M30 28 Q26 14 14 6 Q18 18 22 28 Q26 28 30 28z" fill-opacity=".6"/>' +
      '<circle cx="46" cy="46" r="2.5" fill-opacity=".6"/>'
    },
    { key: 'aviator', label: 'Aviator', body:
      '<path d="M14 30 Q14 14 32 14 Q50 14 50 30 L50 40 Q50 52 32 52 Q14 52 14 40z"/>' +
      '<rect x="13" y="30" width="38" height="3" fill-opacity=".4"/>' +
      '<circle cx="22" cy="36" r="6" fill-opacity=".25"/>' +
      '<circle cx="42" cy="36" r="6" fill-opacity=".25"/>' +
      '<circle cx="22" cy="36" r="3"/>' +
      '<circle cx="42" cy="36" r="3"/>' +
      '<rect x="28" y="35" width="8" height="2" fill-opacity=".5"/>'
    },
    { key: 'magnate', label: 'Industrialist', body:
      '<rect x="20" y="8" width="24" height="24" rx="1"/>' +
      '<rect x="14" y="32" width="36" height="4" rx="2"/>' +
      '<rect x="18" y="14" width="28" height="3" fill-opacity=".4"/>' +
      '<circle cx="32" cy="46" r="9" fill-opacity=".7"/>' +
      '<circle cx="44" cy="46" r="3"/>'
    },
    { key: 'conductor', label: 'Conductor', body:
      '<circle cx="32" cy="26" r="11"/>' +
      '<path d="M16 56 Q16 40 32 40 Q48 40 48 56z"/>' +
      '<polygon points="32,40 26,46 32,52 38,46" fill-opacity=".6"/>' +
      '<rect x="48" y="10" width="2.5" height="22" rx="1" transform="rotate(35 49 21)"/>'
    },
    { key: 'saxophonist', label: 'Jazz Player', body:
      '<rect x="34" y="8" width="8" height="6" rx="1"/>' +
      '<path d="M36 14 L36 28 Q36 38 28 44 L18 50 Q10 48 14 40 L24 32 Q30 28 30 22 L30 14z"/>' +
      '<circle cx="20" cy="48" r="7" fill-opacity=".4"/>' +
      '<circle cx="33" cy="20" r="1.4" fill-opacity=".5"/>' +
      '<circle cx="33" cy="26" r="1.4" fill-opacity=".5"/>' +
      '<circle cx="29" cy="32" r="1.4" fill-opacity=".5"/>'
    },
    { key: 'suffragist', label: 'Suffragist', body:
      '<path d="M32 12 Q24 16 24 24 Q24 32 32 36 Q40 32 40 24 Q40 16 32 12z"/>' +
      '<path d="M32 18 Q28 22 28 26 Q28 30 32 32" fill-opacity=".4"/>' +
      '<rect x="30" y="36" width="4" height="18"/>' +
      '<path d="M30 42 Q22 44 18 50" stroke="currentColor" stroke-width="2.5" fill="none"/>' +
      '<path d="M34 46 Q42 48 46 54" stroke="currentColor" stroke-width="2.5" fill="none"/>'
    },
    { key: 'diplomat', label: 'Diplomat', body:
      '<path d="M12 16 L18 12 L52 46 L46 50z" fill-opacity=".5"/>' +
      '<path d="M12 16 L18 12 L22 16 L16 20z"/>' +
      '<circle cx="46" cy="48" r="9"/>' +
      '<polygon points="46,42 48,46 52,46 49,49 50,53 46,51 42,53 43,49 40,46 44,46" fill="var(--bg-1)"/>'
    },
    { key: 'doctor', label: 'Doctor', body:
      '<path d="M22 12 L22 30 Q22 40 32 40 Q42 40 42 30 L42 12" stroke="currentColor" stroke-width="3" fill="none"/>' +
      '<circle cx="22" cy="12" r="3.5"/>' +
      '<circle cx="42" cy="12" r="3.5"/>' +
      '<line x1="32" y1="40" x2="32" y2="46" stroke="currentColor" stroke-width="3"/>' +
      '<circle cx="32" cy="50" r="6"/>' +
      '<circle cx="32" cy="50" r="2.5" fill-opacity=".5"/>'
    },
    { key: 'scientist', label: 'Scientist', body:
      '<rect x="22" y="8" width="20" height="4" rx="1"/>' +
      '<path d="M26 12 L26 28 L12 50 Q10 56 18 56 L46 56 Q54 56 52 50 L38 28 L38 12z"/>' +
      '<rect x="26" y="12" width="12" height="2" fill-opacity=".4"/>' +
      '<circle cx="22" cy="46" r="2.8" fill="var(--bg-1)" fill-opacity=".5"/>' +
      '<circle cx="34" cy="50" r="2" fill="var(--bg-1)" fill-opacity=".5"/>' +
      '<circle cx="42" cy="44" r="1.6" fill="var(--bg-1)" fill-opacity=".5"/>'
    },
    { key: 'boxer', label: 'Boxer', body:
      '<path d="M14 28 Q14 14 28 14 L40 14 Q52 14 52 26 L52 40 Q52 52 38 52 L24 52 Q14 52 14 42z"/>' +
      '<rect x="20" y="32" width="14" height="6" rx="2" fill-opacity=".4"/>' +
      '<rect x="14" y="22" width="6" height="10" rx="1"/>' +
      '<path d="M44 22 L52 18 L54 22 L46 26z" fill-opacity=".5"/>'
    },
    { key: 'painter', label: 'Painter', body:
      '<path d="M14 32 Q14 16 32 16 Q52 16 52 32 Q52 40 44 40 L40 40 Q34 40 34 46 Q34 52 28 52 Q14 52 14 32z"/>' +
      '<circle cx="22" cy="28" r="3" fill="var(--bg-1)"/>' +
      '<circle cx="32" cy="22" r="3" fill="var(--bg-1)"/>' +
      '<circle cx="42" cy="28" r="3" fill="var(--bg-1)"/>' +
      '<circle cx="44" cy="38" r="3" fill="var(--bg-1)"/>' +
      '<rect x="40" y="46" width="3" height="14" rx="1" transform="rotate(20 42 53)"/>'
    },
    { key: 'filmmaker', label: 'Filmmaker', body:
      '<rect x="8" y="26" width="48" height="26" rx="2"/>' +
      '<path d="M8 16 L56 12 L58 24 L10 28z"/>' +
      '<path d="M14 16 L18 26 L24 14 L28 26 L34 12 L38 26 L44 12 L48 24" stroke="var(--bg-0)" stroke-width="2" fill="none" stroke-linejoin="round"/>' +
      '<rect x="14" y="34" width="36" height="2" fill-opacity=".4"/>' +
      '<rect x="14" y="40" width="28" height="2" fill-opacity=".4"/>'
    },
    { key: 'engineer', label: 'Engineer', body:
      '<path d="M14 38 Q14 16 32 16 Q50 16 50 38z"/>' +
      '<rect x="8" y="38" width="48" height="6" rx="2"/>' +
      '<rect x="30" y="20" width="4" height="16" fill-opacity=".4"/>' +
      '<rect x="20" y="44" width="24" height="3" fill-opacity=".5"/>' +
      '<circle cx="32" cy="32" r="3" fill-opacity=".4"/>'
    },
    { key: 'banker', label: 'Banker', body:
      '<ellipse cx="32" cy="36" rx="22" ry="8"/>' +
      '<path d="M14 36 Q14 18 32 18 Q50 18 50 36"/>' +
      '<rect x="14" y="36" width="36" height="3" fill-opacity=".4"/>' +
      '<rect x="20" y="48" width="24" height="10" rx="1"/>' +
      '<rect x="30" y="44" width="4" height="6" fill-opacity=".5"/>'
    },
    { key: 'officer', label: 'Officer', body:
      '<path d="M12 32 Q12 18 32 18 Q52 18 52 32 Z"/>' +
      '<rect x="8" y="32" width="48" height="6" rx="2"/>' +
      '<rect x="6" y="38" width="52" height="3" fill-opacity=".5"/>' +
      '<rect x="28" y="22" width="8" height="6"/>' +
      '<polygon points="32,23 33,26 36,26 33.5,28 34.5,31 32,29 29.5,31 30.5,28 28,26 31,26" fill-opacity=".7"/>'
    },
    { key: 'chess-master', label: 'Chess Master', body:
      '<rect x="16" y="50" width="32" height="6" rx="1"/>' +
      '<path d="M20 50 L20 36 Q20 24 30 16 Q40 12 46 18 L46 22 L42 22 L44 28 L36 28 L36 32 L42 36 L42 50z"/>' +
      '<circle cx="40" cy="22" r="1.5" fill="var(--bg-0)"/>' +
      '<rect x="14" y="46" width="36" height="3" fill-opacity=".4"/>'
    },
    { key: 'architect', label: 'Architect', body:
      '<circle cx="32" cy="14" r="3.5"/>' +
      '<path d="M30 16 L14 50 L22 50 L32 30 L42 50 L50 50z"/>' +
      '<rect x="14" y="50" width="36" height="3" rx="1" fill-opacity=".5"/>' +
      '<rect x="28" y="32" width="8" height="2" fill-opacity=".5"/>'
    },
  ];

  const KEYS = AVATARS.map(a => a.key);
  const isValidKey = k => KEYS.indexOf(k) !== -1;
  const randomKey = () => KEYS[Math.floor(Math.random() * KEYS.length)];

  const api = { AVATARS, KEYS, isValidKey, randomKey };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.AVATARS_API = api;
})();

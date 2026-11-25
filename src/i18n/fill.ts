// `{n}` is a value. `{s:n}` is the plural "s" of an English word: nothing when `n` is 1 (QA #50).
export const fill = (s: string, vars?: Record<string, string | number>) =>
  vars
    ? s
        .replace(/\{s:(\w+)\}/g, (m, k) => (k in vars ? (Number(vars[k]) === 1 ? "" : "s") : m))
        .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m))
    : s;

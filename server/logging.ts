export const log = {
  info: (...args: Parameters<typeof console.log>) => console.log(...args),
  warn: (...args: Parameters<typeof console.warn>) => console.warn(...args),
  error: (...args: Parameters<typeof console.error>) => console.error(...args),
};

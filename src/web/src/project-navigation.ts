export const shortProject = (path: string) =>
  path.split(/[\\/]/).filter(Boolean).at(-1) || path;

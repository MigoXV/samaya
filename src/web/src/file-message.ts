export type MessageFile = {
  id: string;
  name: string;
  size: number;
  path: string;
};
export function fileMessage(text: string): {
  text: string;
  files: MessageFile[];
} {
  const match =
    /\n\n<samaya_attachments>\n([\s\S]+)\n<\/samaya_attachments>$/.exec(text);
  if (!match) return { text, files: [] };
  try {
    const value = JSON.parse(match[1]);
    if (
      !Array.isArray(value.files) ||
      !value.files.length ||
      value.files.length > 5 ||
      !value.files.every(
        (file: MessageFile) =>
          file &&
          typeof file.id === "string" &&
          /^[a-f0-9]{32}$/.test(file.id) &&
          typeof file.name === "string" &&
          typeof file.path === "string" &&
          typeof file.size === "number" &&
          file.size >= 0 &&
          file.size <= 20 * 1024 * 1024,
      )
    )
      return { text, files: [] };
    return { text: text.slice(0, match.index), files: value.files };
  } catch {
    return { text, files: [] };
  }
}

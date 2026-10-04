export type InputReference = {
  type: "skill" | "mention";
  name: string;
  path: string;
  label: string;
  description: string;
  source: string;
  enabled: boolean;
  cwd?: string;
};
export type SlashCommand = {
  name: string;
  description: string;
  kind: "ui" | "native" | "unavailable";
  enabled: boolean;
  alias?: string;
};
export type InputCatalog = {
  cwd: string;
  references: InputReference[];
  commands: SlashCommand[];
  prompts: { name: string; text: string }[];
  errors: string[];
};
export const escapeRegex = (s: string) =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function hasReference(text: string, name: string) {
  return new RegExp(`(?<![\\w$])\\$${escapeRegex(name)}(?![\\w:-])`, "u").test(
    text,
  );
}
export function inputTrigger(text: string, caret: number) {
  const left = text.slice(0, caret);
  if (
    (left.match(/```/g) || []).length % 2 ||
    (left.split("\n").at(-1)!.match(/`/g) || []).length % 2
  )
    return null;
  const slash = /^\s*\/([\w:-]*)$/.exec(left);
  if (slash)
    return {
      mode: "/" as const,
      start: left.indexOf("/"),
      end: caret,
      query: slash[1],
    };
  const skill = /(?:^|\s)\$([\p{L}_][\p{L}\p{N}_:-]*|)$/u.exec(left);
  return skill
    ? {
        mode: "$" as const,
        start: caret - skill[1].length - 1,
        end: caret,
        query: skill[1],
      }
    : null;
}
export function slashInput(text: string) {
  const m = /^\s*\/([\w:-]+)(?:\s+([\s\S]*))?$/.exec(text);
  return m ? { name: m[1], args: m[2] || "" } : null;
}

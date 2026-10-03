export type McpField = {
  type: "string" | "number" | "integer" | "boolean" | "array";
  title?: string;
  description?: string;
  default?: string | number | boolean | string[];
  enum?: string[];
  enumNames?: string[];
  oneOf?: { const: string; title: string }[];
  items?: {
    type?: string;
    enum?: string[];
    anyOf?: { const: string; title: string }[];
  };
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  format?: "email" | "uri" | "date" | "date-time";
};
export type McpSchema = {
  type: "object";
  properties: Record<string, McpField>;
  required?: string[];
};
export type McpPresentation =
  | {
      mode: "form";
      schema: McpSchema;
      toolApproval?: boolean;
      arguments?: unknown;
    }
  | { mode: "url"; url: string; host: string }
  | { mode: "unsupported"; reason: string };
export type McpValue = string | number | boolean | string[];
export const options = (f: McpField) =>
  f.type === "array"
    ? f.items?.anyOf?.map((o) => ({ value: o.const, label: o.title })) ||
      f.items?.enum?.map((v) => ({ value: v, label: v }))
    : f.oneOf?.map((o) => ({ value: o.const, label: o.title })) ||
      f.enum?.map((v, i) => ({ value: v, label: f.enumNames?.[i] || v }));
export function validateField(
  f: McpField,
  value: McpValue | undefined,
  required: boolean,
): string {
  if (value === undefined) return required ? "请填写此字段" : "";
  if (f.type === "string") {
    const s = String(value),
      length = Array.from(s).length;
    if (f.minLength !== undefined && length < f.minLength)
      return `至少 ${f.minLength} 个字符`;
    if (f.maxLength !== undefined && length > f.maxLength)
      return `最多 ${f.maxLength} 个字符`;
    if (f.format === "email" && !/^[^\s@]+@[^\s@]+$/.test(s))
      return "请输入有效的邮箱地址";
    if (f.format === "uri") {
      try {
        new URL(s);
      } catch {
        return "请输入完整的 URI";
      }
    }
    if (
      f.format === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(s) ||
        Number.isNaN(Date.parse(s)) ||
        new Date(s).toISOString().slice(0, 10) !== s)
    )
      return "请输入有效日期（YYYY-MM-DD）";
    if (
      f.format === "date-time" &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i.test(
        s,
      ) ||
        Number.isNaN(Date.parse(s)))
    )
      return "请输入含时区的日期时间";
  }
  if (f.type === "number" || f.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value))
      return "请输入有效数字";
    if (f.type === "integer" && !Number.isInteger(value)) return "请输入整数";
    if (f.minimum !== undefined && value < f.minimum)
      return `不得小于 ${f.minimum}`;
    if (f.maximum !== undefined && value > f.maximum)
      return `不得大于 ${f.maximum}`;
  }
  if (f.type === "array") {
    if (!Array.isArray(value)) return "请选择选项";
    if (f.minItems !== undefined && value.length < f.minItems)
      return `至少选择 ${f.minItems} 项`;
    if (f.maxItems !== undefined && value.length > f.maxItems)
      return `最多选择 ${f.maxItems} 项`;
  }
  const choices = options(f);
  if (
    choices &&
    (Array.isArray(value) ? value : [value]).some(
      (v) => !choices.some((o) => o.value === v),
    )
  )
    return "请选择有效选项";
  return "";
}

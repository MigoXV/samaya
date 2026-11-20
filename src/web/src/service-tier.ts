export function serviceTierLabel(id?: string | null, name?: string) {
  switch (id) {
    case "priority":
    case "fast":
      return "快速";
    case "ultrafast":
      return "超快";
    case "default":
    case null:
    case undefined:
      return "标准";
    default:
      return name || id;
  }
}

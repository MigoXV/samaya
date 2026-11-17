export const PASTED_TEXT_LIMIT = 1000;

export function pastedTextFile(text: string): File | null {
  let characters = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.codePointAt(index)! > 0xffff) index++;
    if (++characters > PASTED_TEXT_LIMIT)
      return new File([text], "粘贴内容.txt", {
        type: "text/plain;charset=utf-8",
      });
  }
  return null;
}

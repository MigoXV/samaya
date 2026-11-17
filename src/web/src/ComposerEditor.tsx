import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type {
  ComponentProps,
  ChangeEvent,
  KeyboardEvent,
  ClipboardEvent,
  SyntheticEvent,
} from "react";
import { platformLinks } from "./link-boundaries";

// Keep the composer's existing selection/focus API at this boundary. The visible
// editor stores plain text; decorative icons never enter its value or clipboard.
export const ComposerEditor = forwardRef<
  HTMLTextAreaElement,
  ComponentProps<"textarea">
>(function ComposerEditor(props, ref) {
  const root = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const latest = useRef(props);
  const history = useRef([
    { text: String(props.value ?? ""), start: 0, end: 0 },
  ]);
  const historyIndex = useRef(0);
  latest.current = props;
  function plain(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node instanceof HTMLElement && node.tagName === "BR")
      return node.dataset.editorSentinel ? "" : "\n";
    let text = "";
    for (const child of node.childNodes) {
      if (
        child instanceof HTMLElement &&
        /^(DIV|P)$/.test(child.tagName) &&
        text &&
        !text.endsWith("\n")
      )
        text += "\n";
      text += plain(child);
    }
    return text;
  }
  function value() {
    return root.current ? plain(root.current) : "";
  }
  function offsets() {
    const el = root.current!,
      selection = window.getSelection();
    if (
      !selection?.rangeCount ||
      !el.contains(selection.anchorNode) ||
      !el.contains(selection.focusNode)
    )
      return [value().length, value().length];
    const r = selection.getRangeAt(0),
      before = document.createRange();
    before.selectNodeContents(el);
    before.setEnd(r.startContainer, r.startOffset);
    const start = plain(before.cloneContents()).length;
    return [start, start + plain(r.cloneContents()).length];
  }
  function select(start: number, end = start) {
    const el = root.current!;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const locate = (offset: number): [Node, number] => {
      walker.currentNode = el;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const length = node.textContent?.length || 0;
        if (offset <= length) return [node, offset];
        offset -= length;
      }
      return [el, el.childNodes.length];
    };
    const range = document.createRange();
    range.setStart(...locate(start));
    range.setEnd(...locate(end));
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }
  function decorate(text: string) {
    const el = root.current!,
      active = document.activeElement === el;
    const [start, end] = offsets();
    const urls = platformLinks(text);
    const fragment = document.createDocumentFragment();
    const pattern = /```[\s\S]*?```|`[^`\n]*`|https?:\/\/[^\s<>`]+/gi;
    let from = 0;
    for (const match of text.matchAll(pattern)) {
      const href = urls.find((url) => match[0].startsWith(url));
      if (!href) continue;
      fragment.append(document.createTextNode(text.slice(from, match.index)));
      const span = document.createElement("span");
      span.className = "composer-inline-link";
      span.dataset.platform = new URL(href).hostname.includes("figma")
        ? "figma"
        : "github";
      span.dataset.href = href;
      // The CSS pseudo-element is visual only, so selection and copy stay plain text.
      const leading = document.createElement("span");
      leading.className = "composer-link-leading";
      leading.textContent = href.slice(0, 8);
      span.append(leading, document.createTextNode(href.slice(8)));
      fragment.append(span);
      from = match.index + href.length;
    }
    fragment.append(document.createTextNode(text.slice(from)));
    // A terminal newline needs a final line box for the native caret. The BR
    // contributes no text and therefore never enters the submitted value.
    if (text.endsWith("\n")) {
      const sentinel = document.createElement("br");
      sentinel.dataset.editorSentinel = "true";
      fragment.append(sentinel);
    }
    el.replaceChildren(fragment);
    if (active)
      select(Math.min(start, text.length), Math.min(end, text.length));
  }
  function change(event: SyntheticEvent) {
    const text = value();
    if (!composing.current) {
      const [start, end] = offsets();
      if (history.current[historyIndex.current].text !== text) {
        history.current.splice(historyIndex.current + 1);
        history.current.push({ text, start, end });
        if (history.current.length > 100) history.current.shift();
        historyIndex.current = history.current.length - 1;
      }
      decorate(text);
    }
    latest.current.onChange?.(
      event as unknown as ChangeEvent<HTMLTextAreaElement>,
    );
  }
  function undo(event: SyntheticEvent, redo = false) {
    event.preventDefault();
    historyIndex.current = Math.max(
      0,
      Math.min(
        history.current.length - 1,
        historyIndex.current + (redo ? 1 : -1),
      ),
    );
    const snapshot = history.current[historyIndex.current];
    decorate(snapshot.text);
    select(snapshot.start, snapshot.end);
    latest.current.onChange?.(
      event as unknown as ChangeEvent<HTMLTextAreaElement>,
    );
  }
  function insertText(text: string, event: SyntheticEvent) {
    const [start, end] = offsets();
    Object.assign(history.current[historyIndex.current], { start, end });
    root.current!.textContent =
      value().slice(0, start) + text + value().slice(end);
    select(start + text.length);
    change(event);
  }
  useImperativeHandle(ref, () => {
    const el = root.current!;
    Object.defineProperties(el, {
      value: { configurable: true, get: value },
      selectionStart: { configurable: true, get: () => offsets()[0] },
      selectionEnd: { configurable: true, get: () => offsets()[1] },
    });
    Object.assign(el, {
      setSelectionRange: select,
      select: () => select(0, value().length),
    });
    return el as unknown as HTMLTextAreaElement;
  });
  useLayoutEffect(() => {
    const text = String(props.value ?? "");
    if (!composing.current && text !== value()) {
      decorate(text);
      history.current = [{ text, start: text.length, end: text.length }];
      historyIndex.current = 0;
    }
  });
  return (
    <div
      ref={root}
      role="textbox"
      aria-multiline="true"
      aria-label={props["aria-label"]}
      aria-autocomplete={props["aria-autocomplete"]}
      aria-haspopup={props["aria-haspopup"]}
      aria-controls={props["aria-controls"]}
      aria-activedescendant={props["aria-activedescendant"]}
      aria-disabled={props.disabled || undefined}
      data-placeholder={props.placeholder}
      className="composer-editor"
      contentEditable={!props.disabled}
      suppressContentEditableWarning
      onInput={change}
      onBeforeInput={(event) => {
        const type = (event.nativeEvent as InputEvent).inputType;
        if (type === "historyUndo" || type === "historyRedo") {
          undo(event, type === "historyRedo");
          return;
        }
        const [start, end] = offsets();
        Object.assign(history.current[historyIndex.current], { start, end });
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={(event) => {
        composing.current = false;
        change(event);
      }}
      onSelect={(event) =>
        props.onSelect?.(
          event as unknown as SyntheticEvent<HTMLTextAreaElement>,
        )
      }
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "z" &&
          !event.nativeEvent.isComposing
        ) {
          undo(event, event.shiftKey);
          return;
        }
        props.onKeyDown?.(
          event as unknown as KeyboardEvent<HTMLTextAreaElement>,
        );
        if (
          !event.defaultPrevented &&
          event.key === "Enter" &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          insertText("\n", event);
        }
      }}
      onPaste={(event) => {
        props.onPaste?.(
          event as unknown as ClipboardEvent<HTMLTextAreaElement>,
        );
        if (
          !event.defaultPrevented &&
          event.clipboardData.getData("text/plain")
        ) {
          event.preventDefault();
          insertText(event.clipboardData.getData("text/plain"), event);
        }
      }}
      onCopy={(event) => {
        const [start, end] = offsets();
        if (start !== end) {
          event.preventDefault();
          event.clipboardData.setData("text/plain", value().slice(start, end));
        }
      }}
    />
  );
});

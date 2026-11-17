import type { ComponentProps } from "react";
import { defaultUrlTransform } from "react-markdown";
import "./platform-link.css";
import { platformName } from "./link-boundaries";

export function PlatformLink({
  href,
  title,
  children,
  target,
  rel,
}: ComponentProps<"a">) {
  const safe = href ? defaultUrlTransform(href) || undefined : undefined;
  const platform = platformName(safe || "");
  const label =
    typeof children === "string"
      ? children
      : Array.isArray(children) && children.every((c) => typeof c === "string")
        ? children.join("")
        : undefined;
  return (
    <a
      href={safe}
      title={title || platform}
      target={target}
      rel={rel}
      className={platform ? "platform-link" : undefined}
    >
      <span className="platform-link-leading">
        {platform && <PlatformIcon platform={platform} />}
        {label ? label.slice(0, 8) : children}
      </span>
      {label?.slice(8)}
    </a>
  );
}

export function PlatformIcon({ platform }: { platform: "Figma" | "GitHub" }) {
  return platform === "Figma" ? (
    <img
      src="/platform/figma.svg"
      width="14"
      height="16"
      alt=""
      aria-hidden="true"
      className="platform-link-icon"
    />
  ) : (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="platform-link-icon"
    >
      <path d="M12 .5a12 12 0 0 0-3.79 23.38c.6.11.82-.26.82-.58v-2.23c-3.34.73-4.04-1.42-4.04-1.42-.55-1.39-1.33-1.76-1.33-1.76-1.09-.75.08-.73.08-.73 1.21.09 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.34-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18a4.64 4.64 0 0 1 1.24 3.22c0 4.6-2.8 5.62-5.48 5.92.43.37.82 1.1.82 2.22v3.3c0 .32.22.7.83.58A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}

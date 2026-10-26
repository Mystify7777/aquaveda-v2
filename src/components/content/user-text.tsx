import { parseUserText, type Inline } from "@/lib/content/user-text";
import { cn } from "@/lib/utils";

/**
 * Renders user-authored text under the policy in `lib/content/user-text`.
 * Emits only React text nodes inside a fixed set of structural/emphasis
 * elements (h2–h4, p, ul, ol, li, strong, em, br) — never HTML from the
 * content, so no markup, handler attributes or URLs are interpreted.
 * `dir="auto"` lets right-to-left text align and flow naturally per block.
 * Server-compatible (no client state).
 */
function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.type === "strong") return <strong key={index}>{part.text}</strong>;
        if (part.type === "em") return <em key={index}>{part.text}</em>;
        return <span key={index}>{part.text}</span>;
      })}
    </>
  );
}

const HEADING_CLASS = {
  2: "font-display text-xl font-semibold tracking-tight",
  3: "font-display text-lg font-semibold",
  4: "font-display text-base font-semibold",
} as const;

export function UserText({ text, className }: { text: unknown; className?: string }) {
  const blocks = parseUserText(text);

  if (blocks.length === 0) {
    return <p className={cn("text-muted-foreground text-sm", className)}>No content provided.</p>;
  }

  return (
    <div className={cn("space-y-3 text-sm leading-relaxed", className)}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Heading = `h${block.level}` as "h2" | "h3" | "h4";
          return (
            <Heading key={index} dir="auto" className={HEADING_CLASS[block.level]}>
              <Inlines parts={block.content} />
            </Heading>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={index} dir="auto">
              {block.lines.map((line, lineIndex) => (
                <span key={lineIndex}>
                  {lineIndex > 0 && <br />}
                  <Inlines parts={line} />
                </span>
              ))}
            </p>
          );
        }
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={index} className={cn("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex} dir="auto">
                <Inlines parts={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}

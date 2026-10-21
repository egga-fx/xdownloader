import React from "react";
import { ExternalLink } from "lucide-react";
import { openExternalUrl } from "../lib/tauri-api";

interface MarkdownRendererProps {
  content?: string | null;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = "",
}) => {
  if (!content || !content.trim()) {
    return <p className="text-xs text-[#71717a] italic">No content provided.</p>;
  }

  // Parse lines into tokens
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const renderedElements: React.ReactNode[] = [];

  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = "";

  const renderInline = (text: string): React.ReactNode => {
    // Regex for bold, italic, code, link
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let keyIdx = 0;

    while (remaining.length > 0) {
      // 1. Links: [text](url)
      const linkMatch = remaining.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
      // 2. Bold: **text**
      const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);
      // 3. Inline code: `code`
      const codeMatch = remaining.match(/`([^`]+)`/);
      // 4. Italic: *text* or _text_
      const italicMatch = remaining.match(/(?:\*([^*]+)\*|_([^_]+)_)/);

      // Find the earliest match
      let firstMatch: {
        type: "link" | "bold" | "code" | "italic";
        index: number;
        length: number;
        text: string;
        url?: string;
      } | null = null;

      if (linkMatch && linkMatch.index !== undefined) {
        firstMatch = {
          type: "link",
          index: linkMatch.index,
          length: linkMatch[0].length,
          text: linkMatch[1],
          url: linkMatch[2],
        };
      }

      if (boldMatch && boldMatch.index !== undefined) {
        if (!firstMatch || boldMatch.index < firstMatch.index) {
          firstMatch = {
            type: "bold",
            index: boldMatch.index,
            length: boldMatch[0].length,
            text: boldMatch[1],
          };
        }
      }

      if (codeMatch && codeMatch.index !== undefined) {
        if (!firstMatch || codeMatch.index < firstMatch.index) {
          firstMatch = {
            type: "code",
            index: codeMatch.index,
            length: codeMatch[0].length,
            text: codeMatch[1],
          };
        }
      }

      if (italicMatch && italicMatch.index !== undefined) {
        if (!firstMatch || italicMatch.index < firstMatch.index) {
          firstMatch = {
            type: "italic",
            index: italicMatch.index,
            length: italicMatch[0].length,
            text: italicMatch[1] || italicMatch[2],
          };
        }
      }

      if (!firstMatch) {
        parts.push(remaining);
        break;
      }

      // Add text before match
      if (firstMatch.index > 0) {
        parts.push(remaining.substring(0, firstMatch.index));
      }

      // Add matched element
      if (firstMatch.type === "link" && firstMatch.url) {
        const url = firstMatch.url;
        parts.push(
          <a
            key={`link-${keyIdx++}`}
            onClick={(e) => {
              e.preventDefault();
              openExternalUrl(url);
            }}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline inline-flex items-center gap-0.5 cursor-pointer font-medium"
          >
            <span>{firstMatch.text}</span>
            <ExternalLink className="w-2.5 h-2.5 inline-block opacity-70" />
          </a>
        );
      } else if (firstMatch.type === "bold") {
        parts.push(
          <strong key={`bold-${keyIdx++}`} className="font-semibold text-white">
            {firstMatch.text}
          </strong>
        );
      } else if (firstMatch.type === "code") {
        parts.push(
          <code
            key={`code-${keyIdx++}`}
            className="px-1.5 py-0.5 rounded bg-[#18181b] border border-[#27272a] font-mono text-[11px] text-blue-300"
          >
            {firstMatch.text}
          </code>
        );
      } else if (firstMatch.type === "italic") {
        parts.push(
          <em key={`italic-${keyIdx++}`} className="italic text-[#d4d4d8]">
            {firstMatch.text}
          </em>
        );
      }

      remaining = remaining.substring(firstMatch.index + firstMatch.length);
    }

    return <>{parts}</>;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Code blocks toggle
    if (trimmed.startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = trimmed.substring(3).trim();
        codeBlockContent = [];
        continue;
      } else {
        inCodeBlock = false;
        renderedElements.push(
          <div key={`code-block-${i}`} className="my-2.5 rounded-xl border border-[#27272a] bg-[#18181b] overflow-hidden">
            {codeBlockLang && (
              <div className="px-3 py-1 bg-[#121215] border-b border-[#27272a] text-[10px] font-mono text-[#71717a] uppercase tracking-wider">
                {codeBlockLang}
              </div>
            )}
            <pre className="p-3 text-[11px] font-mono text-zinc-300 overflow-x-auto leading-relaxed select-text">
              {codeBlockContent.join("\n")}
            </pre>
          </div>
        );
        continue;
      }
    }

    if (inCodeBlock) {
      codeBlockContent.push(rawLine);
      continue;
    }

    // Horizontal Rule
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(trimmed)) {
      renderedElements.push(
        <hr key={`hr-${i}`} className="my-3 border-t border-[#27272a]" />
      );
      continue;
    }

    // Empty line / spacer
    if (!trimmed) {
      renderedElements.push(<div key={`empty-${i}`} className="h-2" />);
      continue;
    }

    // Heading 1
    if (trimmed.startsWith("# ")) {
      renderedElements.push(
        <h1
          key={`h1-${i}`}
          className="text-sm font-bold text-white mt-3 mb-1.5 pb-1 border-b border-[#27272a] flex items-center gap-1.5"
        >
          {renderInline(trimmed.substring(2))}
        </h1>
      );
      continue;
    }

    // Heading 2
    if (trimmed.startsWith("## ")) {
      renderedElements.push(
        <h2
          key={`h2-${i}`}
          className="text-xs font-bold text-white mt-2.5 mb-1 flex items-center gap-1.5"
        >
          {renderInline(trimmed.substring(3))}
        </h2>
      );
      continue;
    }

    // Heading 3
    if (trimmed.startsWith("### ")) {
      renderedElements.push(
        <h3
          key={`h3-${i}`}
          className="text-xs font-semibold text-blue-400 mt-2 mb-1"
        >
          {renderInline(trimmed.substring(4))}
        </h3>
      );
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      renderedElements.push(
        <blockquote
          key={`quote-${i}`}
          className="border-l-2 border-blue-500/50 pl-3 py-0.5 my-1.5 text-xs text-[#a1a1aa] italic bg-blue-500/5 rounded-r-lg"
        >
          {renderInline(trimmed.substring(2))}
        </blockquote>
      );
      continue;
    }

    // Unordered List (- or *)
    if (/^[-*]\s+/.test(trimmed)) {
      const listText = trimmed.replace(/^[-*]\s+/, "");
      renderedElements.push(
        <div key={`ul-${i}`} className="flex items-start gap-2 my-1 text-xs text-[#d4d4d8] leading-relaxed">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" />
          <div className="flex-1">{renderInline(listText)}</div>
        </div>
      );
      continue;
    }

    // Ordered List (1. or 2.)
    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      renderedElements.push(
        <div key={`ol-${i}`} className="flex items-start gap-2 my-1 text-xs text-[#d4d4d8] leading-relaxed">
          <span className="font-mono text-[10px] font-bold text-blue-400/80 px-1 py-0.2 rounded bg-blue-500/10 border border-blue-500/20 mt-0.5 shrink-0">
            {olMatch[1]}
          </span>
          <div className="flex-1">{renderInline(olMatch[2])}</div>
        </div>
      );
      continue;
    }

    // Standard paragraph line
    renderedElements.push(
      <p key={`p-${i}`} className="text-xs text-[#d4d4d8] leading-relaxed my-0.5">
        {renderInline(rawLine)}
      </p>
    );
  }

  return (
    <div className={`markdown-content flex flex-col font-sans select-text ${className}`}>
      {renderedElements}
    </div>
  );
};

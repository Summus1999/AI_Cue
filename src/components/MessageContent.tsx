interface MessageContentProps {
  content: string;
  variant: "user" | "assistant";
}

interface ContentSegment {
  type: "text" | "code";
  content: string;
  language?: string;
}

function parseContent(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const codeBlockRegex = /```([a-zA-Z0-9_+-]*)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;

  for (const match of content.matchAll(codeBlockRegex)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      segments.push({
        type: "text",
        content: content.slice(lastIndex, matchIndex),
      });
    }

    segments.push({
      type: "code",
      language: match[1] || undefined,
      content: match[2].replace(/^\n/, "").replace(/\n$/, ""),
    });

    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({
      type: "text",
      content: content.slice(lastIndex),
    });
  }

  return segments.length > 0 ? segments : [{ type: "text", content }];
}

export function MessageContent({ content, variant }: MessageContentProps) {
  const segments = parseContent(content);
  const codeWrapperClass =
    variant === "assistant"
      ? "bg-stone-50 text-stone-900 border border-stone-200"
      : "bg-white/80 text-amber-900 border border-amber-300";

  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        if (segment.type === "code") {
          return (
            <div
              key={`code-${index}`}
              className={`overflow-hidden rounded-xl ${codeWrapperClass}`}
            >
              {segment.language && (
                <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide border-b border-black/10">
                  {segment.language}
                </div>
              )}
              <pre className="overflow-x-auto px-3 py-3 text-[13px] leading-6 font-mono">
                <code>{segment.content}</code>
              </pre>
            </div>
          );
        }

        const normalizedText = segment.content.trim();
        if (!normalizedText) {
          return null;
        }

        return (
          <div
            key={`text-${index}`}
            className="whitespace-pre-wrap break-words"
          >
            {normalizedText}
          </div>
        );
      })}
    </div>
  );
}

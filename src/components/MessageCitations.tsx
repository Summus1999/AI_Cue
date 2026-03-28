import type { CitationMetadata } from '../services/ragService';

interface MessageCitationsProps {
  citations: CitationMetadata[];
}

function getCitationSourceLabel(sourceKind: CitationMetadata['sourceKind']): string {
  return sourceKind === 'Message' ? '当前会话' : '知识库';
}

function getCitationTitle(citation: CitationMetadata): string {
  const normalizedTitle = citation.title.trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  return citation.sourceKind === 'Message' ? '会话消息' : '未命名文档';
}

function buildCitationMeta(citation: CitationMetadata): string {
  const parts: string[] = [];

  if (citation.pageNumber != null) {
    parts.push(`第 ${citation.pageNumber} 页`);
  }

  if (citation.headingPath.length > 0) {
    parts.push(citation.headingPath.join(' / '));
  }

  return parts.join(' · ');
}

export function MessageCitations({ citations }: MessageCitationsProps) {
  if (citations.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 border-t border-amber-200/20 pt-3">
      <div className="mb-2 text-[11px] tracking-wide text-amber-200/70">
        引用来源
      </div>
      <div className="space-y-2">
        {citations.map((citation) => {
          const metaText = buildCitationMeta(citation);

          return (
            <div
              key={`${citation.chunkId}-${citation.index}`}
              className="rounded-xl border border-amber-200/10 bg-amber-950/20 px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100/15 px-1.5 py-0.5 font-semibold text-amber-50">
                  [{citation.index}]
                </span>
                <span className="font-medium text-amber-50">
                  {getCitationTitle(citation)}
                </span>
                <span className="rounded-full border border-amber-200/15 px-1.5 py-0.5 text-[10px] text-amber-200/80">
                  {getCitationSourceLabel(citation.sourceKind)}
                </span>
              </div>
              {metaText && (
                <div className="mt-1 text-[11px] text-amber-200/65">
                  {metaText}
                </div>
              )}
              <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-5 text-amber-100/90">
                {citation.snippet}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

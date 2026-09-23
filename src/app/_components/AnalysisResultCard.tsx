import type { ReactNode } from "react";

// GET /documents/{documentId} が返す解析結果
export type DocumentResult = {
  documentId: string;
  fileName: string | null;
  status: string | null;
  summary: string | null;
  modelId: string | null;
  createdAt: string | null;
};

type Props = {
  result: DocumentResult;
  // ユーザーが選択した元のファイル名（日本語名はアップロード時に置き換えられるため別に表示します）
  originalFileName: string | null;
};

// createdAt（UTCのISO形式）を日本時間の読みやすい形式にします
const formatCreatedAt = (value: string | null) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
};

// **太字** だけを <strong> に変換します。
// HTMLとして埋め込まず React の要素として組み立てるため、要約にタグが含まれていても実行されません
const renderInline = (text: string): ReactNode[] =>
  text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={index} className="font-semibold text-gray-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    )
  );

// Markdown形式の要約を、見出し・箇条書き・段落程度に整えて表示します（外部ライブラリは使いません）
function SummaryText({ summary }: { summary: string }) {
  const blocks: ReactNode[] = [];
  let listItems: { text: string; ordered: boolean }[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    const ordered = listItems[0].ordered;
    const items = listItems.map((item, index) => (
      <li key={index}>{renderInline(item.text)}</li>
    ));
    blocks.push(
      ordered ? (
        <ol key={blocks.length} className="list-decimal space-y-1 pl-6">
          {items}
        </ol>
      ) : (
        <ul key={blocks.length} className="list-disc space-y-1 pl-6">
          {items}
        </ul>
      )
    );
    listItems = [];
  };

  for (const rawLine of summary.split(/\r?\n/)) {
    const line = rawLine.trim();
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    // 「- 」「* 」「・」で始まる行は箇条書き、「1. 」で始まる行は番号付きリストとして扱います
    // （「**太字**」で始まる行を箇条書きと誤認しないよう、- と * の後ろには空白を必須にしています）
    const bullet = line.match(/^(?:[-*]\s+|[・•]\s*)(.*)$/);
    const numbered = line.match(/^\d+(?:[.)]\s+|．\s*)(.*)$/);

    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (listItems.length > 0 && listItems[0].ordered !== ordered) flushList();
      listItems.push({ text: (bullet ?? numbered)![1], ordered });
      continue;
    }

    flushList();
    if (!line) continue;
    if (heading) {
      blocks.push(
        <p key={blocks.length} className="font-semibold text-gray-900">
          {renderInline(heading[1])}
        </p>
      );
    } else {
      blocks.push(<p key={blocks.length}>{renderInline(line)}</p>);
    }
  }
  flushList();

  return (
    <div className="space-y-2 text-sm leading-relaxed break-words text-gray-700">
      {blocks}
    </div>
  );
}

export default function AnalysisResultCard({ result, originalFileName }: Props) {
  const savedFileName = result.fileName ?? "-";
  const displayFileName = originalFileName ?? savedFileName;

  return (
    <section
      aria-label="AI解析結果"
      className="rounded-2xl border border-gray-100 bg-white p-6 text-left shadow-sm sm:p-8"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            className="h-5 w-5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h9"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-gray-900">AI解析結果</h2>
        <span className="ml-auto rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
          解析完了
        </span>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="font-medium text-gray-500">ファイル名</dt>
        <dd className="break-all text-gray-900">
          {displayFileName}
          {displayFileName !== savedFileName && (
            <span className="ml-2 text-xs text-gray-400">
              （保存名: {savedFileName}）
            </span>
          )}
        </dd>

        <dt className="font-medium text-gray-500">使用モデル</dt>
        <dd className="break-all text-gray-900">{result.modelId ?? "-"}</dd>

        <dt className="font-medium text-gray-500">解析日時</dt>
        <dd className="text-gray-900">{formatCreatedAt(result.createdAt)}</dd>
      </dl>

      <div className="mt-6 border-t border-gray-100 pt-6">
        <h3 className="text-sm font-semibold text-gray-900">AI要約</h3>
        <div className="mt-3 rounded-xl bg-gray-50 p-4">
          {result.summary ? (
            <SummaryText summary={result.summary} />
          ) : (
            <p className="text-sm text-gray-500">要約がありません。</p>
          )}
        </div>
      </div>
    </section>
  );
}

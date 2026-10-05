"use client";

import { useEffect, useRef, useState } from "react";
import AnalysisResultCard, { formatCreatedAt } from "./AnalysisResultCard";
import type { DocumentResult } from "./AnalysisResultCard";
import { AUTH_EXPIRED_MESSAGE, getAuthHeaders } from "./apiAuth";

// API GatewayのURLは .env.local の NEXT_PUBLIC_API_URL から読み込みます（末尾の / は除去）
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");

// トップページに表示する履歴の件数
const RECENT_LIMIT = 5;
// 1回の問い合わせを待つ最大時間（ミリ秒）
const REQUEST_TIMEOUT_MS = 10000;

const API_URL_MISSING_MESSAGE =
  "APIのURLが設定されていません。.env.local に NEXT_PUBLIC_API_URL を設定し、開発サーバーを再起動してください。";

// 一覧の状態。loading: 読み込み中 / success: 取得成功 / error: エラー
type ListState =
  | { status: "loading" }
  | { status: "success"; items: DocumentResult[] }
  | { status: "error"; message: string };

// 「結果を見る」で開いた詳細の状態
type DetailState =
  | { status: "loading" }
  | { status: "success"; result: DocumentResult }
  | { status: "error"; message: string };

// API を呼び出し、レスポンスのJSONを返します。
// 失敗した場合は、画面にそのまま表示できる日本語メッセージの Error を投げます
const fetchJson = async (
  url: string,
  signal: AbortSignal,
  failureMessage: string
): Promise<unknown> => {
  const authHeaders = await getAuthHeaders();

  let response: Response;
  try {
    response = await fetch(url, {
      headers: authHeaders,
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    });
  } catch (error) {
    // 画面を離れた・別の操作で中断した場合は、呼び出し元で無視できるようそのまま投げます
    if (signal.aborted) throw error;
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(
        "APIからの応答がありませんでした。時間をおいて再度お試しください。"
      );
    }
    throw new Error(
      "APIに接続できませんでした。ネットワーク接続とAPIのURL設定を確認してください。"
    );
  }

  // 401 はトークンが無効（期限切れなど）なので、ログインし直してもらいます
  if (response.status === 401) {
    throw new Error(AUTH_EXPIRED_MESSAGE);
  }

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      data?.message ?? `${failureMessage}（ステータス: ${response.status}）。`
    );
  }
  return data;
};

// 一覧では要約の冒頭だけを見せるため、Markdownの記号（見出し・箇条書き・太字）を取り除いて1つの文章にします
const toSummaryPreview = (summary: string) =>
  summary
    .split(/\r?\n/)
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, "")
        .replace(/^(?:[-*]\s+|[・•]\s*|\d+(?:[.)]\s+|．\s*))/, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
    )
    .filter(Boolean)
    .join(" ");

function StatusBadge({ status }: { status: string | null }) {
  if (status === "COMPLETED") {
    return (
      <span className="shrink-0 rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700">
        解析完了
      </span>
    );
  }
  // 一覧はCOMPLETEDのみの想定ですが、それ以外の値が来た場合はそのまま表示します
  return (
    <span className="shrink-0 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600">
      {status ?? "不明"}
    </span>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
    />
  );
}

export default function RecentDocuments() {
  // API_URL が未設定なら、通信せずに最初からエラーを表示します
  const [listState, setListState] = useState<ListState>(() =>
    API_URL
      ? { status: "loading" }
      : { status: "error", message: API_URL_MISSING_MESSAGE }
  );
  // 「更新」ボタンを押すたびに増やし、一覧の再取得のきっかけにします
  const [reloadCount, setReloadCount] = useState(0);
  // 詳細を開いている履歴の documentId（同時に開くのは1件だけ）
  const [openDocumentId, setOpenDocumentId] = useState<string | null>(null);
  const [detailState, setDetailState] = useState<DetailState | null>(null);
  // 実行中の詳細取得を中断するためのコントローラー
  const detailControllerRef = useRef<AbortController | null>(null);

  // GET /documents?limit=5 で最新の履歴を取得します（初回表示時と「更新」ボタン押下時）
  useEffect(() => {
    if (!API_URL) return;
    const controller = new AbortController();

    fetchJson(
      `${API_URL}/documents?limit=${RECENT_LIMIT}`,
      controller.signal,
      "解析履歴の取得に失敗しました"
    )
      .then((data) => {
        const items = (data as { items?: unknown } | null)?.items;
        if (!Array.isArray(items)) {
          throw new Error("APIのレスポンスに解析履歴が含まれていません。");
        }
        setListState({ status: "success", items: items as DocumentResult[] });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setListState({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "予期しないエラーが発生しました。",
        });
      });

    // 画面を離れた・再取得が始まった場合は、前の通信を止めます
    return () => controller.abort();
  }, [reloadCount]);

  // 画面を離れたら、実行中の詳細取得も止めます
  useEffect(() => {
    const controllerRef = detailControllerRef;
    return () => controllerRef.current?.abort();
  }, []);

  const closeDetail = () => {
    detailControllerRef.current?.abort();
    detailControllerRef.current = null;
    setOpenDocumentId(null);
    setDetailState(null);
  };

  const handleReload = () => {
    if (!API_URL) return;
    // 一覧が入れ替わるので、開いている詳細は閉じます
    closeDetail();
    setListState({ status: "loading" });
    setReloadCount((count) => count + 1);
  };

  // GET /documents/{documentId} で1件分の解析結果を取得し、カードの下に表示します
  const loadDetail = async (documentId: string) => {
    if (!API_URL) return;

    detailControllerRef.current?.abort();
    const controller = new AbortController();
    detailControllerRef.current = controller;

    setOpenDocumentId(documentId);
    setDetailState({ status: "loading" });

    try {
      const data = await fetchJson(
        `${API_URL}/documents/${encodeURIComponent(documentId)}`,
        controller.signal,
        "解析結果の取得に失敗しました"
      );
      if (typeof (data as DocumentResult | null)?.documentId !== "string") {
        throw new Error("APIのレスポンスに解析結果が含まれていません。");
      }
      setDetailState({ status: "success", result: data as DocumentResult });
    } catch (error) {
      if (controller.signal.aborted) return;
      setDetailState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "予期しないエラーが発生しました。",
      });
    }
  };

  const handleToggleDetail = (documentId: string) => {
    if (openDocumentId === documentId) {
      closeDetail();
    } else {
      loadDetail(documentId);
    }
  };

  const isListLoading = listState.status === "loading";

  return (
    <section aria-labelledby="recent-documents-heading">
      <div className="flex items-center justify-between gap-4">
        <h2
          id="recent-documents-heading"
          className="text-xl font-bold text-gray-900 sm:text-2xl"
        >
          最近の解析履歴
        </h2>
        <button
          type="button"
          onClick={handleReload}
          disabled={isListLoading || !API_URL}
          className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isListLoading ? "更新中..." : "更新"}
        </button>
      </div>

      <div className="mt-6">
        {listState.status === "loading" && (
          <p
            role="status"
            className="flex items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-6 py-10 text-sm font-medium text-blue-600"
          >
            <Spinner />
            解析履歴を読み込んでいます...
          </p>
        )}

        {listState.status === "error" && (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-6 py-8 text-center"
          >
            <p className="text-sm font-medium text-red-600">
              {listState.message}
            </p>
            {API_URL && (
              <button
                type="button"
                onClick={handleReload}
                className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
              >
                再読み込み
              </button>
            )}
          </div>
        )}

        {listState.status === "success" && listState.items.length === 0 && (
          <p className="rounded-2xl border border-gray-100 bg-gray-50 px-6 py-10 text-center text-sm text-gray-500">
            まだ解析履歴はありません。PDFをアップロードすると、ここに表示されます。
          </p>
        )}

        {listState.status === "success" && listState.items.length > 0 && (
          <ul className="flex flex-col gap-4">
            {listState.items.map((item) => {
              const isOpen = openDocumentId === item.documentId;
              const detailId = `document-detail-${item.documentId}`;
              const isDetailLoading =
                isOpen && detailState?.status === "loading";

              return (
                <li key={item.documentId} className="flex flex-col gap-3">
                  <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-semibold break-all text-gray-900">
                        {item.fileName ?? "-"}
                      </p>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="mt-1 text-xs text-gray-500">
                      解析日時: {formatCreatedAt(item.createdAt)}
                    </p>
                    <p className="mt-3 line-clamp-3 text-sm leading-relaxed break-words text-gray-700">
                      {item.summary
                        ? toSummaryPreview(item.summary)
                        : "要約がありません。"}
                    </p>
                    <div className="mt-4 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleToggleDetail(item.documentId)}
                        disabled={isDetailLoading}
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? detailId : undefined}
                        className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
                      >
                        {isDetailLoading
                          ? "読み込み中..."
                          : isOpen
                            ? "閉じる"
                            : "結果を見る"}
                      </button>
                    </div>
                  </div>

                  {isOpen && detailState && (
                    <div id={detailId}>
                      {detailState.status === "loading" && (
                        <p
                          role="status"
                          className="flex items-center justify-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 px-6 py-8 text-sm font-medium text-blue-600"
                        >
                          <Spinner />
                          解析結果を読み込んでいます...
                        </p>
                      )}

                      {detailState.status === "error" && (
                        <div
                          role="alert"
                          className="flex flex-col items-center gap-3 rounded-2xl border border-red-100 bg-red-50 px-6 py-6 text-center"
                        >
                          <p className="text-sm font-medium text-red-600">
                            {detailState.message}
                          </p>
                          <button
                            type="button"
                            onClick={() => loadDetail(item.documentId)}
                            className="rounded-full border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
                          >
                            再試行
                          </button>
                        </div>
                      )}

                      {detailState.status === "success" && (
                        // 履歴からは元のファイル名が分からないため、保存されているファイル名を表示します
                        <AnalysisResultCard
                          result={detailState.result}
                          originalFileName={null}
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

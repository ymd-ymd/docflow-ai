"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import AnalysisResultCard from "./AnalysisResultCard";
import type { DocumentResult } from "./AnalysisResultCard";

// idle: 待機中 / uploading: S3へアップロード中 / analyzing: AIで解析中 / completed: 解析完了 / error: エラー
type UploadStatus = "idle" | "uploading" | "analyzing" | "completed" | "error";

// API GatewayのURLは .env.local の NEXT_PUBLIC_API_URL から読み込みます（末尾の / は除去）
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");

const PDF_CONTENT_TYPE = "application/pdf";

// 解析結果を問い合わせる間隔（ミリ秒）と最大回数。3秒 × 40回 = 最大約2分待ちます
// （pdf-processor Lambda のタイムアウトが120秒のため、それに合わせています）
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 40;
// 404（まだ解析結果が保存されていない）以外の一時的なエラー（通信エラー・5xx）を連続で許容する回数
const MAX_CONSECUTIVE_POLL_ERRORS = 3;
// 1回の問い合わせを待つ最大時間（ミリ秒）
const POLL_REQUEST_TIMEOUT_MS = 10000;

// Presigned URL API は documentId を返さず objectKey（uploads/<UUID>-<ファイル名>）を返します。
// pdf-processor Lambda はこの先頭のUUIDを documentId としてDynamoDBに保存するため、
// Lambda（UPLOAD_KEY_PATTERN）と同じルールでUUID部分を取り出します。
const OBJECT_KEY_PATTERN =
  /^uploads\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-.+$/;

const extractDocumentId = (objectKey: string) =>
  objectKey.match(OBJECT_KEY_PATTERN)?.[1] ?? null;

// 指定時間待ちます。中断（ページ離脱・別ファイル選択）されたらすぐに終了します
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true }
    );
  });

// GET /documents/{documentId} を status が COMPLETED になるまで定期的に呼び出します
const pollDocument = async (
  documentId: string,
  signal: AbortSignal
): Promise<DocumentResult> => {
  let consecutiveErrors = 0;

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
    // Lambdaの処理には数秒以上かかるため、1回目も少し待ってから問い合わせます
    await wait(POLL_INTERVAL_MS, signal);

    let response: Response;
    try {
      response = await fetch(
        `${API_URL}/documents/${encodeURIComponent(documentId)}`,
        {
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
          ]),
        }
      );
    } catch (error) {
      if (signal.aborted) throw error;
      // 通信エラー・タイムアウトは一時的な可能性があるので、数回までは再試行します
      if (++consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new Error(
          "解析結果の取得中に通信エラーが続きました。ネットワーク接続を確認してください。"
        );
      }
      continue;
    }

    // 404 は「まだDynamoDBに保存されていない（解析中）」なので、エラーにせず待ち続けます
    if (response.status === 404) {
      consecutiveErrors = 0;
      continue;
    }

    const data = await response.json().catch(() => null);

    if (response.status >= 500) {
      if (++consecutiveErrors >= MAX_CONSECUTIVE_POLL_ERRORS) {
        throw new Error(
          data?.message ??
            `解析結果の取得に失敗しました（ステータス: ${response.status}）。`
        );
      }
      continue;
    }

    // 400 など、再試行しても結果が変わらないエラーはすぐにエラーとして扱います
    if (!response.ok) {
      throw new Error(
        data?.message ??
          `解析結果の取得に失敗しました（ステータス: ${response.status}）。`
      );
    }

    consecutiveErrors = 0;
    if (data?.status === "COMPLETED") return data as DocumentResult;
    if (data?.status === "FAILED" || data?.status === "ERROR") {
      throw new Error("AIによる解析に失敗しました。別のPDFでお試しください。");
    }
    // それ以外（処理中など）の場合は、次の問い合わせまで待ちます
  }

  throw new Error(
    "解析が時間内に完了しませんでした。PDFの内容を解析できなかった可能性があります。時間をおいて再度お試しいただくか、別のPDFでお試しください。"
  );
};

const isPdf = (file: File) =>
  file.name.toLowerCase().endsWith(".pdf") &&
  (file.type === PDF_CONTENT_TYPE || file.type === "");

// Lambda側は英数字・.・_・- のみ許可しているため、それ以外の文字（日本語など）は _ に置き換えます
const toSafeFileName = (name: string) => {
  const base = name.replace(/\.pdf$/i, "").replace(/[^A-Za-z0-9._-]/g, "_");
  return `${base.replace(/^_+$/, "") || "document"}.pdf`;
};

export default function FileUploadArea() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 実行中のアップロード・ポーリングを中断するためのコントローラー
  const abortControllerRef = useRef<AbortController | null>(null);

  // 画面を離れたら（コンポーネントが破棄されたら）ポーリングを止めます
  useEffect(() => {
    const controllerRef = abortControllerRef;
    return () => controllerRef.current?.abort();
  }, []);

  const isBusy = status === "uploading" || status === "analyzing";

  const selectFile = (file: File) => {
    // アップロード・解析中は別のファイルを受け付けません
    if (isBusy) return;
    setStatus("idle");
    setResult(null);
    if (!isPdf(file)) {
      setSelectedFile(null);
      setErrorMessage(
        `「${file.name}」はPDFではありません。PDFファイルを選択してください。`
      );
      return;
    }
    setSelectedFile(file);
    setErrorMessage(null);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) selectFile(file);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) selectFile(file);
    // 同じファイルを選び直しても onChange が発火するようにリセットします
    event.target.value = "";
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    if (!API_URL) {
      setStatus("error");
      setErrorMessage(
        "APIのURLが設定されていません。.env.local に NEXT_PUBLIC_API_URL を設定し、開発サーバーを再起動してください。"
      );
      return;
    }

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setStatus("uploading");
    setErrorMessage(null);
    setResult(null);
    setUploadedFileName(selectedFile.name);

    try {
      // 1. API Gateway から Presigned URL（S3へ一時的にアップロードできるURL）を取得
      let uploadUrl: string;
      let documentId: string;
      try {
        const response = await fetch(`${API_URL}/upload-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileName: toSafeFileName(selectedFile.name),
            contentType: PDF_CONTENT_TYPE,
          }),
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            data?.message ??
              `アップロードURLの取得に失敗しました（ステータス: ${response.status}）。`
          );
        }
        if (typeof data?.uploadUrl !== "string") {
          throw new Error("APIのレスポンスに uploadUrl が含まれていません。");
        }
        uploadUrl = data.uploadUrl;
        const extractedId =
          typeof data?.objectKey === "string"
            ? extractDocumentId(data.objectKey)
            : null;
        if (!extractedId) {
          throw new Error(
            "APIのレスポンスから解析結果の取得に必要なIDを取り出せませんでした。"
          );
        }
        documentId = extractedId;
      } catch (error) {
        if (error instanceof TypeError) {
          throw new Error(
            "APIに接続できませんでした。ネットワーク接続とAPIのURL設定を確認してください。"
          );
        }
        throw error;
      }

      // 2. 取得した Presigned URL に PDF を直接 PUT してS3へアップロード
      let putResponse: Response;
      try {
        putResponse = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": PDF_CONTENT_TYPE },
          body: selectedFile,
        });
      } catch {
        throw new Error(
          "S3への接続に失敗しました。ネットワーク接続またはS3のCORS設定を確認してください。"
        );
      }
      if (!putResponse.ok) {
        throw new Error(
          `S3へのアップロードに失敗しました（ステータス: ${putResponse.status}）。URLの有効期限が切れている可能性があります。もう一度お試しください。`
        );
      }

      // 3. S3へのアップロード後、Lambdaが解析を終えるまで解析結果APIを定期的に確認
      setStatus("analyzing");
      const document = await pollDocument(documentId, controller.signal);

      setResult(document);
      setStatus("completed");
    } catch (error) {
      // 画面を離れた・別の処理に切り替わった場合は、何も表示を変えません
      if (controller.signal.aborted) return;
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "予期しないエラーが発生しました。"
      );
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div
        id="upload"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-16 text-center transition-colors ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-gray-50"
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="h-10 w-10 text-gray-400"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 8.25 12 3.75m0 0L7.5 8.25M12 3.75v12"
          />
        </svg>

        <p className="text-base font-medium text-gray-700">
          ファイルをここにドラッグ&amp;ドロップ
        </p>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isBusy}
          className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          またはファイルを選択
        </button>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={handleFileChange}
        />

        <p className="text-xs text-gray-400">対応形式: PDF</p>

        {selectedFile && (
          <p className="mt-2 text-sm text-gray-600">
            選択中のファイル:{" "}
            <span className="font-medium text-gray-900">
              {selectedFile.name}
            </span>
          </p>
        )}

        {selectedFile && (
          <button
            type="button"
            onClick={handleUpload}
            disabled={isBusy}
            className="mt-2 inline-flex items-center justify-center rounded-full bg-blue-600 px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
          >
            {status === "uploading"
              ? "アップロード中..."
              : status === "analyzing"
                ? "解析中..."
                : "アップロード"}
          </button>
        )}

        {isBusy && (
          <p
            role="status"
            className="inline-flex items-center gap-2 text-sm font-medium text-blue-600"
          >
            <span
              aria-hidden="true"
              className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
            />
            {status === "uploading"
              ? "アップロード中..."
              : "AIで解析しています...（数十秒かかる場合があります）"}
          </p>
        )}

        {status === "completed" && (
          <p role="status" className="text-sm font-medium text-green-600">
            解析完了
          </p>
        )}

        {errorMessage && (
          <p role="alert" className="text-sm font-medium text-red-600">
            {errorMessage}
          </p>
        )}
      </div>

      {status === "completed" && result && (
        <AnalysisResultCard
          result={result}
          originalFileName={uploadedFileName}
        />
      )}
    </div>
  );
}

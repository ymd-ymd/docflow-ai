"use client";

import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

type UploadStatus = "idle" | "uploading" | "success" | "error";

// API GatewayのURLは .env.local の NEXT_PUBLIC_API_URL から読み込みます（末尾の / は除去）
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "");

const PDF_CONTENT_TYPE = "application/pdf";

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
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = (file: File) => {
    setStatus("idle");
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

    setStatus("uploading");
    setErrorMessage(null);

    try {
      // 1. API Gateway から Presigned URL（S3へ一時的にアップロードできるURL）を取得
      let uploadUrl: string;
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

      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "予期しないエラーが発生しました。"
      );
    }
  };

  const isUploading = status === "uploading";

  return (
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
        disabled={isUploading}
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
          disabled={isUploading}
          className="mt-2 inline-flex items-center justify-center rounded-full bg-blue-600 px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400"
        >
          {isUploading ? "アップロード中..." : "アップロード"}
        </button>
      )}

      {status === "success" && (
        <p role="status" className="text-sm font-medium text-green-600">
          アップロード成功
        </p>
      )}

      {errorMessage && (
        <p role="alert" className="text-sm font-medium text-red-600">
          {errorMessage}
        </p>
      )}
    </div>
  );
}

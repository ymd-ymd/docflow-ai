"use client";

import { useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";

export default function FileUploadArea() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(
    null
  );
  const inputRef = useRef<HTMLInputElement>(null);

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
    if (file) setSelectedFileName(file.name);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) setSelectedFileName(file.name);
  };

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
        className="text-sm font-medium text-blue-600 underline-offset-2 hover:underline"
      >
        またはファイルを選択
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />

      <p className="text-xs text-gray-400">対応形式: PDF / Excel</p>

      {selectedFileName && (
        <p className="mt-2 text-sm text-gray-600">
          選択中のファイル:{" "}
          <span className="font-medium text-gray-900">
            {selectedFileName}
          </span>
        </p>
      )}
    </div>
  );
}

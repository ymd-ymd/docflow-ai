import FileUploadArea from "./_components/FileUploadArea";

const features = [
  {
    title: "AI要約",
    description:
      "長文のドキュメントも、AIが要点を素早く整理してわかりやすく要約します。",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h9"
      />
    ),
  },
  {
    title: "情報抽出",
    description:
      "必要な項目やデータを自動で検出し、構造化された情報として抽出します。",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.75 3.75h4.5a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5h-4.5a1.5 1.5 0 0 1-1.5-1.5V5.25a1.5 1.5 0 0 1 1.5-1.5ZM4.5 8.25h3v11.25h-3zM16.5 12h3v7.5h-3z"
      />
    ),
  },
  {
    title: "レポート生成",
    description:
      "解析結果をもとに、そのまま共有できる読みやすいレポートを自動作成します。",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
    ),
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col bg-white text-gray-900">
      <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <span className="text-xl font-bold tracking-tight text-gray-900">
            DocFlow AI
          </span>
          <button
            type="button"
            className="rounded-full border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            ログイン
          </button>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-4xl px-6 py-20 text-center sm:py-28">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-5xl">
            ドキュメント解析を、AIでもっと簡単に。
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-gray-600 sm:text-lg">
            PDFやExcelをアップロードするだけ。AIが内容を解析し、要約・情報抽出・レポート作成を自動化します。
          </p>
          <div className="mt-8">
            <a
              href="#upload"
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700"
            >
              ドキュメントを解析する
            </a>
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-20">
          <FileUploadArea />
        </section>

        <section className="border-t border-gray-100 bg-gray-50 py-20">
          <div className="mx-auto max-w-6xl px-6">
            <h2 className="text-center text-2xl font-bold text-gray-900 sm:text-3xl">
              主な機能
            </h2>
            <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm"
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      className="h-6 w-6"
                    >
                      {feature.icon}
                    </svg>
                  </div>
                  <h3 className="mt-4 text-lg font-semibold text-gray-900">
                    {feature.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-gray-600">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

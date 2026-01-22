import { Loader2, File, FileQuestion, Wand2 } from "lucide-react";

export default function DocumentsLoading() {
  const skeletonCards = Array.from({ length: 3 });

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:gap-8 md:p-8 animate-pulse">
      <div className="h-8 w-1/3 bg-gray-300 rounded-md mb-4"></div> {/* Page title skeleton */}

      {skeletonCards.map((_, idx) => (
        <div key={idx} className="border rounded-lg p-4 space-y-4 bg-gray-100 dark:bg-gray-800">
          {/* Card Header */}
          <div className="flex justify-between items-center gap-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <span className="h-8 w-8 rounded-full bg-gray-300 dark:bg-gray-600"></span>
              <div className="h-5 w-1/2 bg-gray-300 dark:bg-gray-600 rounded"></div>
            </div>
            <div className="flex gap-2">
              <div className="h-8 w-20 bg-gray-300 dark:bg-gray-600 rounded"></div>
              <div className="h-8 w-20 bg-gray-300 dark:bg-gray-600 rounded"></div>
            </div>
          </div>

          {/* Card Content */}
          <div className="space-y-2 divide-y">
            {/* Main document skeleton */}
            <div className="flex justify-between items-center py-2">
              <div className="flex items-center gap-2 flex-1">
                <File className="h-5 w-5 text-gray-400 dark:text-gray-500" />
                <div className="h-4 w-2/3 bg-gray-300 dark:bg-gray-600 rounded"></div>
              </div>
              <div className="h-4 w-20 bg-gray-300 dark:bg-gray-600 rounded"></div>
            </div>

            {/* Sub-documents skeleton (2 items) */}
            {Array.from({ length: 2 }).map((_, subIdx) => (
              <div key={subIdx} className="flex justify-between items-center py-2 pl-6">
                <div className="flex items-center gap-2 flex-1">
                  {subIdx === 0 ? <FileQuestion className="h-4 w-4 text-gray-400 dark:text-gray-500" /> : <Wand2 className="h-4 w-4 text-gray-400 dark:text-gray-500" />}
                  <div className="h-3 w-1/2 bg-gray-300 dark:bg-gray-600 rounded"></div>
                </div>
                <div className="h-3 w-16 bg-gray-300 dark:bg-gray-600 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Upload button skeleton */}
      <div className="flex justify-start mt-4">
        <div className="h-10 w-40 bg-gray-300 dark:bg-gray-600 rounded"></div>
      </div>
    </main>
  );
}

import Link from "next/link";
import { getAllStories, CATEGORY_COLORS, StoryCategory } from "@/lib/stories";

export default function StoriesPage() {
  const stories = getAllStories();

  return (
    <div>
      {/* 페이지 타이틀 */}
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2">로또 이야기</h1>
        <p className="text-gray-500 text-sm">
          역사, 확률, 당첨자 희노애락, 꿈 해몽까지 — 로또에 얽힌 이야기들
        </p>
      </div>

      {/* 카드 그리드 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {stories.map((story) => (
          <Link
            key={story.slug}
            href={`/stories/${story.slug}`}
            className="group block bg-white border border-gray-200 rounded-2xl p-5 hover:border-amber-300 hover:shadow-md transition-all duration-200"
          >
            {/* 카테고리 배지 */}
            <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-3 ${CATEGORY_COLORS[story.category as StoryCategory]}`}>
              {story.categoryLabel}
            </span>

            {/* 제목 */}
            <h2 className="text-base font-bold text-gray-900 mb-2 group-hover:text-amber-600 transition-colors leading-snug line-clamp-2">
              {story.title}
            </h2>

            {/* 요약 */}
            <p className="text-sm text-gray-500 leading-relaxed line-clamp-3 mb-4">
              {story.summary}
            </p>

            {/* 태그 + 날짜 */}
            <div className="flex items-center justify-between mt-auto">
              <div className="flex gap-1.5 flex-wrap">
                {story.tags.slice(0, 2).map((tag) => (
                  <span key={tag} className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
              <span className="text-xs text-gray-400 shrink-0 ml-2">{story.date}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

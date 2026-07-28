import { notFound } from "next/navigation";
import Link from "next/link";
import { getStoryBySlug, getAllStories, CATEGORY_COLORS, StoryCategory } from "@/lib/stories";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllStories().map((s) => ({ slug: s.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const story = getStoryBySlug(slug);
  if (!story) return {};
  return {
    title: `${story.title} | 로또 이야기`,
    description: story.summary,
  };
}

export default async function StoryPage({ params }: Props) {
  const { slug } = await params;
  const story = getStoryBySlug(slug);

  if (!story) notFound();

  return (
    <article>
      {/* 카테고리 배지 */}
      <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-full mb-4 ${CATEGORY_COLORS[story.category as StoryCategory]}`}>
        {story.categoryLabel}
      </span>

      {/* 제목 */}
      <h1 className="text-2xl font-extrabold text-gray-900 mb-3 leading-snug">
        {story.title}
      </h1>

      {/* 요약 */}
      <p className="text-gray-500 text-sm mb-4 leading-relaxed border-l-4 border-amber-300 pl-4">
        {story.summary}
      </p>

      {/* 태그 + 날짜 */}
      <div className="flex items-center gap-3 mb-8 flex-wrap">
        <span className="text-xs text-gray-400">{story.date}</span>
        {story.tags.map((tag) => (
          <span key={tag} className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
            {tag}
          </span>
        ))}
      </div>

      {/* 구분선 */}
      <hr className="border-gray-100 mb-8" />

      {/* 본문 — HTML 직접 렌더링 */}
      <div
        className="prose-story text-gray-700 leading-relaxed text-[0.97rem]"
        dangerouslySetInnerHTML={{ __html: story.content }}
      />

      {/* 하단 네비게이션 */}
      <div className="mt-12 pt-6 border-t border-gray-100 flex items-center justify-between">
        <Link
          href="/stories"
          className="text-sm text-gray-400 hover:text-amber-500 transition-colors flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          전체 이야기
        </Link>
        <Link
          href="/dashboard/draws"
          className="text-sm text-amber-500 hover:text-amber-600 font-semibold transition-colors"
        >
          번호 확인하러 가기 →
        </Link>
      </div>
    </article>
  );
}

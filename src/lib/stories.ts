// ============================================================
// 로또 이야기 콘텐츠 데이터
// 패키지 의존성 없는 정적 TypeScript 배열
// gray-matter + remark 마이그레이션 시 이 구조 그대로 유지
// ============================================================

export type StoryCategory = "history" | "probability" | "story" | "dream";

export interface Story {
  slug: string;
  title: string;
  category: StoryCategory;
  categoryLabel: string;
  date: string;
  summary: string;
  tags: string[];
  content: string; // HTML 문자열
}

export const CATEGORY_COLORS: Record<StoryCategory, string> = {
  history:     "bg-blue-100 text-blue-700",
  probability: "bg-purple-100 text-purple-700",
  story:       "bg-amber-100 text-amber-700",
  dream:       "bg-green-100 text-green-700",
};

export const stories: Story[] = [
  // ──────────────────────────────────────────────────────
  // 01. 역사
  // ──────────────────────────────────────────────────────
  {
    slug: "lotto-history",
    title: "로또는 어디서 왔을까 — 제노바의 추첨에서 전 세계로",
    category: "history",
    categoryLabel: "📜 역사",
    date: "2026-06-18",
    summary: "이탈리아 항구도시 제노바의 정치 추첨에서 시작된 복권이 어떻게 전 세계를 거쳐 한국 로또 6/45가 됐는지 그 여정을 따라간다.",
    tags: ["역사", "제노바", "복권의 유래", "한국 로또"],
    content: `
<p>복권의 역사는 생각보다 훨씬 오래됐다. 기원은 15세기 이탈리아 북부의 항구도시 <strong>제노바</strong>로 거슬러 올라간다. 당시 제노바 공화국은 90명의 원로원 의원 중 5명을 매년 추첨으로 선출했는데, 시민들이 이 추첨 결과에 돈을 거는 내기가 자연스럽게 생겨났다. '로또(Lotto)'라는 단어 자체가 이탈리아어로 '운명의 몫', '제비뽑기의 몫'을 뜻한다.</p>

<p>제노바의 추첨 내기는 17세기 들어 이탈리아 전역으로 퍼지면서 제도화됐다. 국가가 직접 운영하는 공식 복권으로 발전한 것이다. 당시 이탈리아 복권은 1부터 90까지의 숫자 중 5개를 추첨하는 방식이었다. 이 구조는 오늘날 유럽 일부 국가의 복권에도 여전히 남아 있다.</p>

<p>18세기에는 프랑스로 건너갔다. 루이 16세 치하의 프랑스는 전쟁과 낭비로 재정이 파탄 직전이었는데, 복권이 손쉬운 재원 조달 수단으로 주목받았다. 프랑스 왕실 복권은 귀족과 시민 모두에게 선풍적 인기를 끌었다. 프랑스 혁명 이후에도 복권은 살아남았고, 나폴레옹 시대에는 국고 보충 수단으로 적극 활용됐다.</p>

<p>영국에서는 엘리자베스 1세 시절인 1566년 첫 국가 복권이 발행됐다. 런던 항구 보수 공사 재원 마련이 목적이었다. 그 후 18~19세기 영국 복권은 대학 설립, 교량 건설, 박물관 건립에 자금을 댔다. 오늘날 대영박물관 컬렉션의 일부는 복권 수익으로 구입한 것들이다.</p>

<p>미국에는 식민지 시대부터 복권이 있었다. 하버드, 예일, 프린스턴 등 명문 대학들이 초기 재원을 복권으로 마련했다는 사실은 잘 알려져 있지 않다. 독립전쟁 당시에도 대륙군은 복권으로 전쟁 자금을 조달했다.</p>

<p>한국에 현대식 복권이 처음 등장한 건 1969년 '주택복권'이다. 주택 건설 재원 마련이 목적이었다. 이후 각종 복권이 생겼다 사라지기를 반복하다가, 2002년 12월 <strong>로또 6/45</strong>가 탄생했다. 1부터 45까지 숫자 중 6개를 고르는 방식으로, 첫 회 판매액이 약 230억 원에 달했다. 한국 사회에 로또 열풍이 시작된 순간이었다.</p>

<p>2003년 4월, 로또 1회 최고 당첨금 기록이 세워진다. 407억 원 — 당시 기준으로 전례 없는 액수였다. 전국의 편의점과 복권방에 줄이 늘어섰고, "로또 한 장"은 한국인의 일상어가 됐다. 제노바 원로원 추첨에서 시작된 500년의 역사가 한국의 토요일 밤으로 이어진 것이다.</p>

<p style="color:#888;font-size:0.85rem;margin-top:2rem;">※ 이 글은 공개된 역사 자료를 바탕으로 작성됐습니다.</p>
    `.trim(),
  },

  // ──────────────────────────────────────────────────────
  // 02. 당첨확률
  // ──────────────────────────────────────────────────────
  {
    slug: "lotto-probability",
    title: "1등 확률 814만분의 1 — 그게 얼마나 작은 숫자인지 실감해보자",
    category: "probability",
    categoryLabel: "📐 확률",
    date: "2026-06-18",
    summary: "1등이 814만분의 1이라는 건 알고 있다. 그런데 5등은? 많은 사람이 '44만분의 1'로 알고 있지만 실제는 전혀 다르다.",
    tags: ["당첨확률", "수학", "1등 확률", "5등 확률"],
    content: `
<p>로또 1등 확률은 흔히 "814만분의 1"이라고 한다. 45개 숫자 중 6개를 순서 없이 고르는 조합의 수, 즉 C(45,6) = 8,145,060이다. 1등이 되려면 이 814만 가지 경우 중 단 하나를 맞혀야 한다.</p>

<p>이 숫자가 얼마나 작은지 감이 안 잡힌다면 이렇게 생각해보자. 전국에 편의점이 약 5만 개 있다. 그 편의점 중 하나를 눈 감고 랜덤으로 골라, 거기서 근무하는 특정 아르바이트생이 바로 그 시간에 카운터에 있을 확률과 비슷하다. 아니면, 한국 인구(약 5,100만 명) 중에서 눈 감고 특정 한 사람을 6번 연속 지목하는 것에 가깝다.</p>

<h3 style="margin-top:1.5rem;font-size:1.1rem;font-weight:700;">등수별 정확한 확률</h3>

<table style="width:100%;border-collapse:collapse;margin:1rem 0;">
  <thead>
    <tr style="background:#fef3c7;">
      <th style="padding:8px 12px;text-align:left;border:1px solid #e5e7eb;">등수</th>
      <th style="padding:8px 12px;text-align:left;border:1px solid #e5e7eb;">조건</th>
      <th style="padding:8px 12px;text-align:right;border:1px solid #e5e7eb;">확률</th>
      <th style="padding:8px 12px;text-align:right;border:1px solid #e5e7eb;">약</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:700;color:#d97706;">1등</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;">6개 모두 일치</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">1/8,145,060</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">814만분의 1</td>
    </tr>
    <tr style="background:#f9fafb;">
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:700;">2등</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;">5개 + 보너스</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">1/1,357,510</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">135만분의 1</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:700;">3등</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;">5개 일치</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">1/35,724</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">3만 6천분의 1</td>
    </tr>
    <tr style="background:#f9fafb;">
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:700;">4등</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;">4개 일치</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">1/733</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">733분의 1</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:700;color:#16a34a;">5등</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;">3개 일치</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;">1/45</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;text-align:right;font-weight:700;color:#16a34a;">45분의 1</td>
    </tr>
  </tbody>
</table>

<p><strong>5등 확률이 "44만분의 1"이라는 이야기를 들어본 적 있을 것이다. 틀렸다.</strong> 5등(3개 일치)의 실제 확률은 약 <strong>45분의 1</strong>, 즉 2.2%다. 44만이 아니라 44~45다. 100장 사면 평균 2장 정도는 5등(5,000원)에 당첨된다는 뜻이다. 어디서 이 오해가 생겼는지 정확히는 알 수 없지만, 1등 확률인 "814만분의 1"의 숫자가 뒤섞인 게 아닐까 싶다.</p>

<p>확률론적으로 보면, 로또는 매우 공정한 게임이다. 어떤 번호 조합이든 당첨 확률은 완전히 동등하다. 1, 2, 3, 4, 5, 6을 선택하는 것과 7, 14, 22, 31, 38, 44를 선택하는 것의 당첨 확률은 수학적으로 똑같다. "연속 번호는 안 된다"는 속설은 확률적 근거가 전혀 없다.</p>

<p>그렇다면 왜 우리는 로또를 살까? 기댓값만 보면 합리적이지 않다. 1,000원짜리 로또의 기댓값은 약 400~500원이다. 하지만 기댓값으로는 포착되지 않는 무언가가 있다. 당첨됐을 때의 '삶이 바뀌는 상상'이다. 경제학자들은 이것을 "복권 프리미엄"이라 부른다. 1,000원으로 일주일 동안 행복한 상상을 살 수 있다면, 그건 꽤 합리적인 구매일 수도 있다.</p>

<p style="color:#888;font-size:0.85rem;margin-top:2rem;">※ 확률 계산: C(45,6)=8,145,060 기준. 동행복권 공식 확률표 참조.</p>
    `.trim(),
  },

  // ──────────────────────────────────────────────────────
  // 03. 당첨자 스토리 — 기적의 순간
  // ──────────────────────────────────────────────────────
  {
    slug: "story-miracle",
    title: "그 번호를 고른 이유가 없었다 — 어느 자영업자의 로또 이야기",
    category: "story",
    categoryLabel: "💛 이야기",
    date: "2026-06-18",
    summary: "빚과 폐업 사이에서 마지막 한 장 산 로또. 당첨금은 크지 않았지만, 그 5,000원이 그의 인생 방향을 바꿨다.",
    tags: ["당첨자 이야기", "실화 기반", "자영업", "5등"],
    content: `
<p style="color:#888;font-style:italic;font-size:0.9rem;">※ 이 이야기는 여러 실제 사례를 바탕으로 각색한 픽션입니다. 특정 인물을 지칭하지 않습니다.</p>

<p>2018년 초, 경기도 외곽에서 작은 분식집을 운영하던 40대 남성 K씨는 폐업을 앞두고 있었다. 3년 가까이 버텼지만 월세와 재료비, 인건비를 감당하기가 벅찼다. 통장 잔고는 30만 원 남짓. 대출 이자 납부일은 2주 뒤였다.</p>

<p>그 토요일 오후, K씨는 장을 보러 들른 마트 계산대 앞에서 로또 자동 1장을 샀다. 특별한 이유는 없었다. 그냥 습관처럼, 별생각 없이. "어차피 안 된다는 거 알아요. 근데 1,000원이잖아요."</p>

<p>그날 밤 추첨 결과를 확인할 여유도 없이 잠들었다. 다음 날 아침, 전날 산 로또가 생각나서 가게 POS 단말기 앞에 앉아 번호를 조회했다. 5등이었다. 3개 일치, 5,000원.</p>

<p>K씨는 그 5,000원을 받으러 복권방에 갔다. 그리고 그 자리에서 자동 5장을 다시 샀다. "5,000원이 생겼으니까, 그냥 또 샀어요." 5장 중 한 장이 또 5등이었다. 연속으로 5등에 당첨된 것이다.</p>

<p>당첨금은 합쳐 1만 원. 그 주에 공과금을 냈다. 금액은 보잘것없었지만, K씨에게는 묘한 감각이 남았다. "그게 처음으로 '운이 있는 사람'처럼 느껴진 경험이었어요."</p>

<p>그로부터 두 달 뒤, K씨는 분식집 폐업 대신 메뉴를 대폭 줄이고 혼자 운영하는 소규모로 전환했다. 이후 도시락 배달로 활로를 찾아 지금은 안정적으로 운영 중이다. 로또 덕분이라고 하면 과장이겠지만, K씨는 이렇게 말한다.</p>

<p style="border-left:3px solid #e8a000;padding-left:1rem;margin:1.5rem 0;font-style:italic;">"그 5,000원이 딱히 뭘 해결한 건 아니에요. 근데 그때 '아, 그래도 뭔가 되는구나'하는 생각이 들었어요. 별거 아닌 것 같아도 그게 마음을 좀 돌려줬어요."</p>

<p>로또가 삶을 구하는 건 아니다. 하지만 가끔은 5,000원짜리 5등이, 다음 주를 버티게 하는 작은 이유가 되기도 한다.</p>
    `.trim(),
  },

  // ──────────────────────────────────────────────────────
  // 04. 당첨자 스토리 — 인생이 꼬인 사람들
  // ──────────────────────────────────────────────────────
  {
    slug: "story-warning",
    title: "10억을 받고 나서 가족이 사라졌다 — 당첨 후 인생이 꼬인 사람들",
    category: "story",
    categoryLabel: "💛 이야기",
    date: "2026-06-18",
    summary: "대박 당첨이 모든 걸 해결해줄 것 같지만, 실제로는 당첨 이후 더 힘들어진 사례가 적지 않다. 돈이 드러냈던 것들에 대한 이야기.",
    tags: ["당첨자 이야기", "교훈", "가족 갈등", "실화 기반"],
    content: `
<p style="color:#888;font-style:italic;font-size:0.9rem;">※ 이 이야기는 공개 보도된 사례들을 바탕으로 각색한 픽션입니다. 특정 인물을 지칭하지 않습니다.</p>

<p>로또 1등 당첨 소식이 알려지는 순간, 삶은 두 갈래로 나뉜다. 하나는 꿈에 그리던 새 인생이고, 다른 하나는 예상치 못한 혼돈이다. 안타깝게도 후자를 경험한 이들이 적지 않다.</p>

<h3 style="margin-top:1.5rem;font-size:1rem;font-weight:700;">사례 1 — 형제가 원수가 됐다</h3>

<p>경남에 사는 50대 남성 A씨는 평소 친하게 지내던 형과 함께 로또를 사왔다. 당첨됐을 때 당연히 나눌 거라 생각했다. 하지만 막상 수십억 원이 눈앞에 놓이자 생각이 달라졌다. "내가 샀으니까 내 거"라는 마음이 생겼다. 형 역시 "우리 같이 해온 거잖냐"고 맞섰다. 소송으로 이어졌고, 결국 법원은 당첨금을 나누라고 판결했지만, 형제 사이는 영영 끊겼다.</p>

<h3 style="margin-top:1.5rem;font-size:1rem;font-weight:700;">사례 2 — 연락 없던 친척들</h3>

<p>B씨는 당첨 사실을 비밀로 했지만 소문은 빠르게 퍼졌다. 10년 넘게 연락 없던 친척들이 갑자기 나타났다. "어려울 때 도와줬잖냐"는 사람, "사업 좀 도와달라"는 사람, "빌려만 달라"는 사람. B씨는 결국 이사와 번호 변경을 선택했다. 지금도 가족 중 일부와는 왕래하지 않는다.</p>

<h3 style="margin-top:1.5rem;font-size:1rem;font-weight:700;">사례 3 — 당첨금보다 빠른 지출</h3>

<p>C씨는 당첨금을 받은 뒤 몇 년 만에 대부분을 썼다. 오랫동안 갖고 싶었던 차, 여행, 가족들 챙겨주기. "한 번쯤은 좋은 거 해야지"라는 마음이 쌓이고 쌓였다. 투자한 가게는 적자를 냈고, 지인에게 빌려준 돈은 돌아오지 않았다. 10년 후 C씨의 상황은 당첨 이전보다 오히려 나빴다.</p>

<p style="border-left:3px solid #e8a000;padding-left:1rem;margin:1.5rem 0;font-style:italic;">"돈이 문제가 아니었어요. 그 전에도 우리 사이에 있던 것들이 — 욕심, 섭섭함, 오해 같은 것들이 — 돈이 생기니까 한꺼번에 드러난 거죠."</p>

<p>당첨금 자체가 문제가 아니다. 돈은 원래 있던 것들을 가속할 뿐이다. 좋은 관계는 더 좋아지고, 숨어있던 균열은 더 크게 벌어진다. 로또를 꿈꾸면서 함께 상상할 것은 '무엇을 살까'보다 '나는 어떤 사람인가'일지도 모른다.</p>
    `.trim(),
  },

  // ──────────────────────────────────────────────────────
  // 05. 꿈 이야기
  // ──────────────────────────────────────────────────────
  {
    slug: "dream-folklore",
    title: "돼지 꿈을 꿨다면? — 로또와 꿈 해몽의 민속학",
    category: "dream",
    categoryLabel: "🌙 꿈 이야기",
    date: "2026-06-18",
    summary: "조상 꿈, 돼지 꿈, 뱀 꿈 — 로또 당첨과 연결되는 꿈 해몽의 종류와 그 문화적 배경을 정리했다. 과학적 근거는 없지만, 이야기로는 재미있다.",
    tags: ["꿈 해몽", "민속", "돼지꿈", "조상꿈", "뱀꿈"],
    content: `
<p style="color:#888;font-style:italic;font-size:0.9rem;">※ 꿈 해몽은 과학적 근거가 없습니다. 민속 문화로서 소개합니다.</p>

<p>한국인이 복권을 살 때 가장 많이 언급하는 이유 중 하나가 꿈이다. 복권방 주인들이 입을 모아 말하는 단골 멘트: "어젯밤에 돼지 꿈 꿨어요." 과연 어떤 꿈들이 '로또 꿈'으로 분류되고, 그 배경은 무엇일까.</p>

<h3 style="margin-top:1.5rem;font-size:1rem;font-weight:700;">🐷 돼지 꿈</h3>
<p>가장 유명한 로또 길몽이다. 돼지는 한국 민속에서 오래전부터 재물과 풍요의 상징이었다. 돼지가 집 안으로 들어오는 꿈, 돼지를 안는 꿈, 돼지를 잡는 꿈이 특히 좋다고 전해진다. 돼지저금통 문화도 이 상징에서 비롯됐다. 재미있는 점은 꿈에서 돼지가 얼마나 크고 살쪘는지가 당첨금 규모를 암시한다고 여기는 사람들이 있다는 것. 물론 근거는 없다.</p>

<h3 style="margin-top:1.5rem;font-size:1rem;font-weight:700;">👴 조상 꿈</h3>
<p>돌아가신 할아버지, 할머니, 부모님이 꿈에 나타나 무언가를 주거나 이끌어주는 꿈이다. 한국 전통 사상에서 조상은 저승에서도 자손을 보살핀다는 믿음이 있다. 조상이 꿈에서 숫자를 알려주거나, 손을 잡아끌거나, 밝은 얼굴로 나타나면 좋은 일이 생긴다고 해석된다. 반대로 조상이 슬프거나 화난 얼굴이면 조심해야 한다는 신호로 본다.</p>

<h3 style="margin-top:1.5rem;font-size:1rem;font-weight:700;">🐍 뱀 꿈</h3>
<p>뱀은 서양에서 부정적 상징이지만, 동아시아에서는 다르다. 큰 뱀이나 용처럼 생긴 뱀이 나타나는 꿈은 재물운의 상징으로 해석되는 경우가 많다. 특히 뱀이 집 안으로 들어오거나, 뱀을 잡거나, 뱀이 몸을 감는 꿈이 길몽으로 분류된다. 단, 뱀에게 물리거나 뱀이 도망가는 꿈은 흉몽으로 본다.</p>

<h3 style="margin-top:1.5rem;font-size:1rem;font-weight:700;">🌊 물 꿈</h3>
<p>맑고 넘치는 물이 꿈에 나오면 재물이 들어온다는 해석이 있다. 폭포수, 흘러넘치는 샘물, 파도가 밀려오는 꿈이 해당된다. 반대로 흙탕물이나 물에 빠지는 꿈은 좋지 않은 것으로 해석된다. 물이 '재물의 흐름'을 상징한다는 동양적 풍수 사상의 연장선이다.</p>

<h3 style="margin-top:1.5rem;font-size:1rem;font-weight:700;">꿈 해몽을 대하는 방법</h3>
<p>꿈 해몽의 과학적 근거는 없다. 수십만 명이 비슷한 꿈을 꾸고 로또를 사지만, 당첨은 814만분의 1의 확률로 발생한다. 꿈과 당첨 사이에 인과관계가 없다는 건 통계가 증명한다.</p>

<p>그렇다면 왜 꿈 해몽 문화는 사라지지 않을까. 아마도 인간에게는 '이번엔 다를 것 같다'는 희망이 필요하기 때문일 것이다. 조상이 나타났다는 꿈 하나가 그 주를 조금 더 설레게 만들어준다면, 그 자체로 이미 값어치가 있는 건지도 모른다. 꿈 해몽은 정확한 예측이 아니라, 기대를 정당화하는 이야기다.</p>
    `.trim(),
  },
];

// 유틸 함수들

export function getAllStories(): Story[] {
  return stories;
}

export function getStoryBySlug(slug: string): Story | undefined {
  return stories.find((s) => s.slug === slug);
}

export function getLatestStories(count: number = 2): Story[] {
  return [...stories]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, count);
}

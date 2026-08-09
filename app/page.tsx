import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type LeaderboardRow = {
  event_id: number;
  event_name: string | null;
  server: string;
  fetched_at: string;
  rank: number;
  score: number;
  player_id: string;
  external_id: string;
  name: string;
  profile_image_url: string | null;
  last_played_at: string | null;
  last_play_score: number | null;
  last_play_source_type: string | null;
  parking_started_at: string | null;
  idle_seconds: number | null;
  is_parking: boolean | null;
};

export default async function HomePage() {
  const { data, error } = await supabaseBrowser
    .from("current_leaderboard_status")
    .select("*")
    .order("rank", { ascending: true })
    .limit(100);

  if (error) {
    return <main className="p-8">讀取排行榜失敗：{error.message}</main>;
  }

  const rows = (data ?? []) as LeaderboardRow[];
  const eventName = rows[0]?.event_name ?? "目前活動";
  const fetchedAt = rows[0]?.fetched_at;

  return (
    <main className="min-h-screen p-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">前 100 名排行榜</h1>
        <p className="mt-2 text-sm text-gray-600">
          {eventName}
          {fetchedAt
            ? ` · 更新時間 ${new Date(fetchedAt).toLocaleString("zh-TW")}`
            : ""}
        </p>
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">排名</th>
            <th className="p-2">玩家</th>
            <th className="p-2">分數</th>
            <th className="p-2">最後一把</th>
            <th className="p-2">最後進帳</th>
            <th className="p-2">來源</th>
            <th className="p-2">狀態</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.event_id}-${row.player_id}-${row.fetched_at}`}
              className="border-b"
            >
              <td className="p-2">{row.rank}</td>

              <td className="p-2">
                <Link
                  className="text-blue-600 underline"
                  href={`/players/${row.player_id}`}
                >
                  {row.name}
                </Link>
              </td>

              <td className="p-2">{Number(row.score).toLocaleString()}</td>

              <td className="p-2">
                {row.last_played_at
                  ? new Date(row.last_played_at).toLocaleString("zh-TW")
                  : "-"}
              </td>

              <td className="p-2">
                {row.last_play_score !== null && row.last_play_score !== undefined
                  ? Number(row.last_play_score).toLocaleString()
                  : "-"}
              </td>

              <td className="p-2">
                {row.last_play_source_type === "mysekai" ? "MySekai" : "活動"}
              </td>

              <td className="p-2">
                {row.is_parking
                  ? `停車中 ${Math.floor(Number(row.idle_seconds ?? 0) / 60)} 分鐘`
                  : "進行中"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

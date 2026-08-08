import { ScoreCharts } from "./ScoreCharts";
import { supabaseBrowser } from "@/lib/supabase";

type PlayerPageProps = {
  params: Promise<{
    id: string;
  }>;
};

export default async function PlayerPage({ params }: PlayerPageProps) {
  const { id } = await params;

  const { data: player } = await supabaseBrowser
    .from("players")
    .select("*")
    .eq("id", id)
    .single();

  const { data: plays } = await supabaseBrowser
    .from("play_records")
    .select("played_at, play_score, score_after, rank")
    .eq("player_id", id)
    .order("played_at", { ascending: true });

  const { data: snapshots } = await supabaseBrowser
    .from("ranking_snapshots")
    .select("fetched_at, score, rank")
    .eq("player_id", id)
    .order("fetched_at", { ascending: true });

  const { data: parkingSessions } = await supabaseBrowser
    .from("parking_sessions")
    .select("*")
    .eq("player_id", id)
    .order("started_at", { ascending: false });

  return (
    <main className="min-h-screen p-8">
      <a href="/" className="text-blue-600 underline">
        回排行榜
      </a>

      <h1 className="mt-4 text-3xl font-bold">{player?.name ?? "玩家"}</h1>
	<ScoreCharts plays={plays ?? []} snapshots={snapshots ?? []} />

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-bold">每一把分數</h2>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">時間</th>
              <th className="p-2">該把分數</th>
              <th className="p-2">打完總分</th>
              <th className="p-2">當時排名</th>
            </tr>
          </thead>

          <tbody>
            {plays?.map((play) => (
              <tr key={`${play.played_at}-${play.score_after}`} className="border-b">
                <td className="p-2">
                  {new Date(play.played_at).toLocaleString("zh-TW")}
                </td>
                <td className="p-2">{Number(play.play_score).toLocaleString()}</td>
                <td className="p-2">{Number(play.score_after).toLocaleString()}</td>
                <td className="p-2">{play.rank}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-bold">停車時段</h2>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">開始</th>
              <th className="p-2">結束</th>
              <th className="p-2">狀態</th>
            </tr>
          </thead>

          <tbody>
            {parkingSessions?.map((session) => (
              <tr key={session.id} className="border-b">
                <td className="p-2">
                  {new Date(session.started_at).toLocaleString("zh-TW")}
                </td>
                <td className="p-2">
                  {session.ended_at
                    ? new Date(session.ended_at).toLocaleString("zh-TW")
                    : "-"}
                </td>
                <td className="p-2">
                  {session.is_active ? "停車中" : "已恢復"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
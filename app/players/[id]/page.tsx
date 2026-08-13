import { ScoreCharts } from "./ScoreCharts";
import { supabaseBrowser } from "@/lib/supabase";

const taipeiDateTime = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatTaipeiTime(value: string | null | undefined) {
  return value ? taipeiDateTime.format(new Date(value)) : "-";
}

type PlayerPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    board?: string;
  }>;
};

export default async function PlayerPage({ params, searchParams }: PlayerPageProps) {
  const { id } = await params;
  const { board } = await searchParams;
  const boardId = board ?? "overall";

  const { data: player } = await supabaseBrowser
    .from("players")
    .select("*")
    .eq("id", id)
    .single();

  const { data: plays } = await supabaseBrowser
    .from("play_records")
    .select("played_at, play_score, score_after, rank, source_type, exclude_from_chart, board_id")
    .eq("player_id", id)
    .eq("board_id", boardId)
    .order("played_at", { ascending: true });

  const { data: snapshots } = await supabaseBrowser
    .from("ranking_snapshots")
    .select("fetched_at, score, rank, board_id")
    .eq("player_id", id)
    .eq("board_id", boardId)
    .order("fetched_at", { ascending: true });

  const { data: hourlyRuns } = await supabaseBrowser
    .from("hourly_run_snapshots")
    .select("captured_hour, rank, score, run_count_1h, board_label")
    .eq("player_id", id)
    .eq("board_id", boardId)
    .order("captured_hour", { ascending: true });

  const boardLabel = hourlyRuns?.[0]?.board_label ?? (boardId === "overall" ? "總榜" : "角色榜");

  return (
    <main className="min-h-screen p-8">
      <a href={`/?board=${encodeURIComponent(boardId)}`} className="text-blue-600 underline">
        回排行榜
      </a>

      <h1 className="mt-4 text-3xl font-bold">{player?.name ?? "玩家"}</h1>
      <p className="mt-2 text-sm text-gray-600">{boardLabel}</p>

      <ScoreCharts plays={plays ?? []} snapshots={snapshots ?? []} />

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-bold">整點周回</h2>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">整點</th>
              <th className="p-2">周回數</th>
              <th className="p-2">當時排名</th>
              <th className="p-2">當時分數</th>
            </tr>
          </thead>

          <tbody>
            {hourlyRuns?.map((hour) => (
              <tr key={hour.captured_hour} className="border-b">
                <td className="p-2">{formatTaipeiTime(hour.captured_hour)}</td>
                <td className="p-2">{Number(hour.run_count_1h).toLocaleString()}</td>
                <td className="p-2">{hour.rank}</td>
                <td className="p-2">{Number(hour.score).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-xl font-bold">每一把分數</h2>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b text-left">
              <th className="p-2">時間</th>
              <th className="p-2">該把分數</th>
              <th className="p-2">打完總分</th>
              <th className="p-2">當時排名</th>
              <th className="p-2">來源</th>
            </tr>
          </thead>

          <tbody>
            {plays?.map((play) => (
              <tr key={`${play.played_at}-${play.score_after}`} className="border-b">
                <td className="p-2">{formatTaipeiTime(play.played_at)}</td>
                <td className="p-2">{Number(play.play_score).toLocaleString()}</td>
                <td className="p-2">{Number(play.score_after).toLocaleString()}</td>
                <td className="p-2">{play.rank}</td>
                <td className="p-2">
                  {play.source_type === "entry"
                    ? "-"
                    : play.source_type === "mysekai"
                      ? "MySekai"
                      : "活動"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}



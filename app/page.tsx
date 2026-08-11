import Link from "next/link";
import { AutoRefresh } from "./AutoRefresh";
import { supabaseBrowser } from "@/lib/supabase";

export const dynamic = "force-dynamic";

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

function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || seconds < 0) return "-";

  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours} 小時 ${minutes} 分鐘`;
  return `${minutes} 分鐘`;
}

type SearchParams = Promise<{
  board?: string;
}>;

type LeaderboardRow = {
  event_id: number;
  event_name: string | null;
  server: string;
  board_type: string;
  board_id: string;
  board_label: string | null;
  chapter: number | null;
  character: number | null;
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
  speed_1h: number | null;
  run_count_1h: number | null;
};

function boardName(row: Pick<LeaderboardRow, "board_type" | "board_label" | "character">) {
  if (row.board_type === "overall") return "總榜";
  return row.board_label ?? `角色榜 ${row.character ?? ""}`;
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const selectedBoard = params.board ?? "overall";

  const { data: optionRows } = await supabaseBrowser
    .from("current_leaderboard_status")
    .select("board_id, board_type, board_label, character")
    .order("board_type", { ascending: true })
    .order("character", { ascending: true });

  const boardOptions = Array.from(
    new Map(
      ((optionRows ?? []) as Pick<LeaderboardRow, "board_id" | "board_type" | "board_label" | "character">[]).map((row) => [
        row.board_id,
        row,
      ])
    ).values()
  );

  const { data, error } = await supabaseBrowser
    .from("current_leaderboard_status")
    .select("*")
    .eq("board_id", selectedBoard)
    .order("rank", { ascending: true })
    .limit(100);

  if (error) {
    return <main className="p-8">讀取排行榜失敗：{error.message}</main>;
  }

  const rows = (data ?? []) as LeaderboardRow[];
  const eventName = rows[0]?.event_name ?? "目前活動";
  const fetchedAt = rows[0]?.fetched_at;
  const currentBoardName = rows[0] ? boardName(rows[0]) : "總榜";

  return (
    <main className="min-h-screen p-8">
      <AutoRefresh />
      <div className="mb-6">
        <h1 className="text-3xl font-bold">前 100 名排行榜</h1>
        <p className="mt-2 text-sm text-gray-600">
          {eventName} · {currentBoardName}
          {fetchedAt ? ` · 更新時間 ${formatTaipeiTime(fetchedAt)}` : ""}
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {boardOptions.map((board) => {
          const active = board.board_id === selectedBoard;

          return (
            <Link
              key={board.board_id}
              href={`/?board=${encodeURIComponent(board.board_id)}`}
              className={`border px-3 py-1 text-sm ${
                active ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-300"
              }`}
            >
              {boardName(board)}
            </Link>
          );
        })}
      </div>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">排名</th>
            <th className="p-2">玩家</th>
            <th className="p-2">分數</th>
            <th className="p-2">時速</th>
            <th className="p-2">周回</th>
            <th className="p-2">最後一把</th>
            <th className="p-2">最後進帳</th>
            <th className="p-2">來源</th>
            <th className="p-2">狀態</th>
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={`${row.board_id}-${row.player_id}-${row.fetched_at}`} className="border-b">
              <td className="p-2">{row.rank}</td>

              <td className="p-2">
                <Link
                  className="text-blue-600 underline"
                  href={`/players/${row.player_id}?board=${encodeURIComponent(row.board_id)}`}
                >
                  {row.name}
                </Link>
              </td>

              <td className="p-2">{Number(row.score).toLocaleString()}</td>

              <td className="p-2">
                {row.speed_1h !== null && row.speed_1h !== undefined
                  ? Math.round(Number(row.speed_1h)).toLocaleString()
                  : "-"}
              </td>

              <td className="p-2">
                {row.run_count_1h !== null && row.run_count_1h !== undefined
                  ? Number(row.run_count_1h).toLocaleString()
                  : "-"}
              </td>

              <td className="p-2">{formatTaipeiTime(row.last_played_at)}</td>

              <td className="p-2">
                {row.last_play_score !== null && row.last_play_score !== undefined
                  ? Number(row.last_play_score).toLocaleString()
                  : "-"}
              </td>

              <td className="p-2">
                {row.last_play_source_type === "mysekai"
                  ? "MySekai"
                  : row.last_play_source_type === "entry"
                    ? "入榜"
                    : "活動"}
              </td>

              <td className="p-2">
                {row.is_parking
                  ? `停車中 ${formatDuration(row.idle_seconds)}`
                  : "進行中"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}

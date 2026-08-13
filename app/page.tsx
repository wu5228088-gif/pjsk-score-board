import Link from "next/link";
import { AutoRefresh } from "./AutoRefresh";
import { supabaseBrowser } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

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
  board_starts_at: string | null;
  board_ends_at: string | null;
  is_board_closed: boolean | null;
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

type BoardOption = Pick<
  LeaderboardRow,
  "board_id" | "board_type" | "board_label" | "chapter" | "character" | "board_ends_at" | "is_board_closed"
>;

function isClosedBoard(row: Pick<LeaderboardRow, "board_ends_at" | "is_board_closed">) {
  if (row.is_board_closed) return true;
  return row.board_ends_at ? new Date(row.board_ends_at).getTime() <= Date.now() : false;
}

function boardName(row: Pick<LeaderboardRow, "board_type" | "board_label" | "chapter" | "character" | "board_ends_at" | "is_board_closed">) {
  if (row.board_type === "overall") return "總榜";

  const chapter = row.chapter ? `第 ${row.chapter} 章` : "角色榜";
  const character = row.character ? `角色 ${row.character}` : row.board_label ?? "角色榜";
  const status = isClosedBoard(row) ? "已關閉" : "進行中";

  return `${chapter} · ${character} · ${status}`;
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const selectedBoard = params.board ?? "overall";

  const { data: optionRows } = await supabaseBrowser
    .from("current_leaderboard_status")
    .select("board_id, board_type, board_label, chapter, character, board_ends_at, is_board_closed")
    .order("board_type", { ascending: false })
    .order("chapter", { ascending: true });

  const boardOptions = Array.from(
    new Map(
      ((optionRows ?? []) as BoardOption[]).map((row) => [
        row.board_id,
        row,
      ])
    ).values()
  ).sort((a, b) => {
    if (a.board_type !== b.board_type) return a.board_type === "overall" ? -1 : 1;
    if (a.board_type === "overall") return 0;

    const aClosed = isClosedBoard(a);
    const bClosed = isClosedBoard(b);
    if (aClosed !== bClosed) return aClosed ? 1 : -1;

    return (a.chapter ?? 999) - (b.chapter ?? 999);
  });

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
  const isBoardClosed = Boolean(rows[0]?.is_board_closed);

  return (
    <main className="min-h-screen p-8">
      <AutoRefresh />
      <div className="mb-6">
        <h1 className="text-3xl font-bold">前 100 名排行榜</h1>
        <p className="mt-2 text-sm text-gray-600">
          {eventName} · {currentBoardName}
          {isBoardClosed ? " · 已關閉" : ""}
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
          {isBoardClosed ? (
            <tr className="border-b text-left">
              <th className="p-2">排名</th>
              <th className="p-2">玩家</th>
              <th className="p-2">分數</th>
            </tr>
          ) : (
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
          )}
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

              {!isBoardClosed && (
                <>
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
                        ? "-"
                        : "活動"}
                  </td>

                  <td className="p-2">
                    {row.is_parking
                      ? `停車中 ${formatDuration(row.idle_seconds)}`
                      : "進行中"}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}





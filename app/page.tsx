import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase";

export default async function HomePage() {
  const { data, error } = await supabaseBrowser
    .from("latest_leaderboard")
    .select("*")
    .order("rank", { ascending: true })
    .limit(100);

  if (error) {
    return <main className="p-8">讀取排行榜失敗：{error.message}</main>;
  }

  return (
    <main className="min-h-screen p-8">
      <h1 className="mb-6 text-3xl font-bold">前 100 名排行榜</h1>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2">排名</th>
            <th className="p-2">玩家</th>
            <th className="p-2">分數</th>
            <th className="p-2">更新時間</th>
          </tr>
        </thead>

        <tbody>
          {data?.map((row) => (
            <tr key={`${row.player_id}-${row.fetched_at}`} className="border-b">
              <td className="p-2">{row.rank}</td>
              <td className="p-2">
  		<Link className="text-blue-600 underline" href={`/players/${row.player_id}`}>
    		 {row.name}
  		</Link>
	      </td>
              <td className="p-2">{Number(row.score).toLocaleString()}</td>
              <td className="p-2">
                {new Date(row.fetched_at).toLocaleString("zh-TW")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}


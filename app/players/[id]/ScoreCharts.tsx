"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

type PlayRecord = {
  played_at: string;
  play_score: number;
  score_after: number;
  rank: number;
};

type Snapshot = {
  fetched_at: string;
  score: number;
  rank: number;
};

export function ScoreCharts({
  plays,
  snapshots,
}: {
  plays: PlayRecord[];
  snapshots: Snapshot[];
}) {
  const playData = plays.map((play) => ({
    time: new Date(play.played_at).toLocaleTimeString("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    play_score: Number(play.play_score),
    score_after: Number(play.score_after),
    rank: Number(play.rank),
  }));

  const snapshotData = snapshots.map((snapshot) => ({
    time: new Date(snapshot.fetched_at).toLocaleTimeString("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    score: Number(snapshot.score),
    rank: Number(snapshot.rank),
  }));

  return (
    <div className="mt-8 space-y-8">
      <section>
        <h2 className="mb-3 text-xl font-bold">每一把分數圖</h2>
        <div className="h-80 w-full">
          <ResponsiveContainer>
            <LineChart data={playData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="play_score"
                stroke="#2563eb"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-bold">總分曲線</h2>
        <div className="h-80 w-full">
          <ResponsiveContainer>
            <LineChart data={snapshotData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line
                type="monotone"
                dataKey="score"
                stroke="#16a34a"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RankingRow = {
  rank: number;
  name: string;
  score: number;
  last_score?: number;
  last_played_at?: string;
  last_player_info?: {
    profile?: {
      id?: number | string;
    };
  };
};

type PlayerRow = {
  id: string;
  external_id: string;
};

type RecentPlay = {
  player_id: string;
  played_at: string;
  play_score: number;
  source_type: string | null;
};

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-sync-secret");

  if (secret !== process.env.SYNC_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiUrl = process.env.RANKING_API_URL;

  if (!apiUrl) {
    return NextResponse.json(
      { error: "RANKING_API_URL is not configured" },
      { status: 500 }
    );
  }

  const res = await fetch(apiUrl, { cache: "no-store" });

  if (!res.ok) {
    return NextResponse.json(
      { error: `Ranking API failed: ${res.status}` },
      { status: 500 }
    );
  }

  const apiData = await res.json();
  const eventId = Number(apiData.id);
  const eventName = apiData.name;
  const server = "tw";
  const fetchedAt = new Date().toISOString();
  const rows = (apiData.player_top_100_rankings ?? []) as RankingRow[];

  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 500 });
  }

  const validRows = rows
    .map((row) => {
      const profileId = row.last_player_info?.profile?.id;
      if (!profileId) return null;

      return {
        row,
        externalId: String(profileId),
        name: row.name,
        rank: Number(row.rank),
        score: Number(row.score),
        lastScore: Number(row.last_score ?? 0),
        lastPlayedAt: row.last_played_at ?? null,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const uniquePlayers = Array.from(
    new Map(validRows.map((item) => [item.externalId, item])).values()
  );

  const { error: eventError } = await supabaseAdmin.from("events").upsert({
    id: eventId,
    name: eventName,
    server,
    starts_at: apiData.start_at,
    ends_at: apiData.closed_at,
  });

  if (eventError) {
    return NextResponse.json({ error: eventError.message }, { status: 500 });
  }

  const { data: players, error: playersError } = await supabaseAdmin
    .from("players")
    .upsert(
      uniquePlayers.map((item) => ({
        server,
        external_id: item.externalId,
        name: item.name,
        updated_at: fetchedAt,
      })),
      { onConflict: "server,external_id" }
    )
    .select("id, external_id");

  if (playersError) {
    return NextResponse.json({ error: playersError.message }, { status: 500 });
  }

  const playerByExternalId = new Map(
    ((players ?? []) as PlayerRow[]).map((player) => [
      player.external_id,
      player.id,
    ])
  );

  const rankingPayload = validRows
    .map((item) => {
      const playerId = playerByExternalId.get(item.externalId);
      if (!playerId) return null;

      return {
        event_id: eventId,
        server,
        fetched_at: fetchedAt,
        rank: item.rank,
        player_id: playerId,
        score: item.score,
        raw_data: item.row,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const { error: snapshotError } = await supabaseAdmin
    .from("ranking_snapshots")
    .insert(rankingPayload);

  if (snapshotError) {
    return NextResponse.json({ error: snapshotError.message }, { status: 500 });
  }

  const playerIds = Array.from(playerByExternalId.values());
  const { data: recentPlayRows } = await supabaseAdmin
    .from("play_records")
    .select("player_id, played_at, play_score, source_type")
    .eq("event_id", eventId)
    .eq("server", server)
    .in("player_id", playerIds)
    .order("played_at", { ascending: false })
    .limit(2000);

  const latestPlayByPlayer = new Map<string, RecentPlay>();
  const eventScoresByPlayer = new Map<string, number[]>();

  for (const play of (recentPlayRows ?? []) as RecentPlay[]) {
    if (!latestPlayByPlayer.has(play.player_id)) {
      latestPlayByPlayer.set(play.player_id, play);
    }

    if (play.source_type === "event") {
      const scores = eventScoresByPlayer.get(play.player_id) ?? [];
      if (scores.length < 20) scores.push(Number(play.play_score));
      eventScoresByPlayer.set(play.player_id, scores);
    }
  }

  const playPayload = validRows
    .map((item) => {
      const playerId = playerByExternalId.get(item.externalId);
      if (!playerId || !item.lastPlayedAt || item.lastScore <= 0) return null;

      const previousPlay = latestPlayByPlayer.get(playerId);
      const secondsSincePreviousPlay = previousPlay?.played_at
        ? Math.floor(
            (new Date(item.lastPlayedAt).getTime() -
              new Date(previousPlay.played_at).getTime()) /
              1000
          )
        : null;

      const normalMedian = median(eventScoresByPlayer.get(playerId) ?? []);
      const isTooFast =
        secondsSincePreviousPlay !== null &&
        secondsSincePreviousPlay > 0 &&
        secondsSincePreviousPlay < 70;
      const isMuchLowerThanNormal =
        normalMedian !== null &&
        normalMedian >= 10000 &&
        item.lastScore < normalMedian * 0.25;
      const isMysekai = isTooFast && isMuchLowerThanNormal;

      return {
        event_id: eventId,
        server,
        player_id: playerId,
        rank: item.rank,
        score_before: item.score - item.lastScore,
        score_after: item.score,
        play_score: item.lastScore,
        played_at: item.lastPlayedAt,
        raw_data: item.row,
        source_type: isMysekai ? "mysekai" : "event",
        is_mysekai: isMysekai,
        seconds_since_previous_play: secondsSincePreviousPlay,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (playPayload.length > 0) {
    const { error: playError } = await supabaseAdmin
      .from("play_records")
      .upsert(playPayload, {
        onConflict: "event_id,server,player_id,played_at",
      });

    if (playError) {
      return NextResponse.json({ error: playError.message }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    event_id: eventId,
    event_name: eventName,
    count: rankingPayload.length,
    plays: playPayload.length,
    fetched_at: fetchedAt,
  });
}

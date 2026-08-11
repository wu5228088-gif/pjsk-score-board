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
  last_1h_stats?: {
    count?: number;
    score?: number;
    speed?: number;
    average?: number;
  };
  last_player_info?: {
    profile?: {
      id?: number | string;
    };
  };
};

type WorldLinkBoard = {
  id: number;
  chapter?: number;
  character?: number;
  player_rankings?: RankingRow[];
};

type Board = {
  boardType: "overall" | "character";
  boardId: string;
  boardLabel: string;
  chapter: number | null;
  character: number | null;
  rows: RankingRow[];
};

type PlayerRow = {
  id: string;
  external_id: string;
};

type RecentPlay = {
  player_id: string;
  board_id: string;
  played_at: string;
  play_score: number;
  source_type: string | null;
};

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function getCapturedHour(value: string) {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
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
  const fetchedDate = new Date(fetchedAt);
  const shouldCaptureHourly = fetchedDate.getUTCMinutes() === 0;
  const capturedHour = getCapturedHour(fetchedAt);

  if (!Number.isFinite(eventId)) {
    return NextResponse.json({ error: "Invalid event id" }, { status: 500 });
  }

  const boards: Board[] = [
    {
      boardType: "overall",
      boardId: "overall",
      boardLabel: "總榜",
      chapter: null,
      character: null,
      rows: apiData.player_top_100_rankings ?? [],
    },
    ...((apiData.world_link_top_100_rankings ?? []) as WorldLinkBoard[]).map(
      (board) => ({
        boardType: "character" as const,
        boardId: String(board.id),
        boardLabel: `角色榜 ${board.character}`,
        chapter: board.chapter ?? null,
        character: board.character ?? null,
        rows: board.player_rankings ?? [],
      })
    ),
  ];

  const flatRows = boards.flatMap((board) =>
    board.rows
      .map((row) => {
        const profileId = row.last_player_info?.profile?.id;
        if (!profileId) return null;

        return {
          board,
          row,
          externalId: String(profileId),
          name: row.name,
          rank: Number(row.rank),
          score: Number(row.score),
          lastScore: Number(row.last_score ?? 0),
          lastPlayedAt: row.last_played_at ?? null,
          runCount1h: Number(row.last_1h_stats?.count ?? 0),
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
  );

  const uniquePlayers = Array.from(
    new Map(flatRows.map((item) => [item.externalId, item])).values()
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

  const rankingPayload = flatRows
    .map((item) => {
      const playerId = playerByExternalId.get(item.externalId);
      if (!playerId) return null;

      return {
        event_id: eventId,
        server,
        board_type: item.board.boardType,
        board_id: item.board.boardId,
        board_label: item.board.boardLabel,
        chapter: item.board.chapter,
        character: item.board.character,
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
    .select("player_id, board_id, played_at, play_score, source_type")
    .eq("event_id", eventId)
    .eq("server", server)
    .in("player_id", playerIds)
    .order("played_at", { ascending: false })
    .limit(4000);

  const latestPlayByKey = new Map<string, RecentPlay>();
  const eventScoresByKey = new Map<string, number[]>();

  for (const play of (recentPlayRows ?? []) as RecentPlay[]) {
    const key = `${play.player_id}:${play.board_id}`;

    if (!latestPlayByKey.has(key)) {
      latestPlayByKey.set(key, play);
    }

    if (play.source_type === "event") {
      const scores = eventScoresByKey.get(key) ?? [];
      if (scores.length < 20) scores.push(Number(play.play_score));
      eventScoresByKey.set(key, scores);
    }
  }

  const playPayload = flatRows
    .map((item) => {
      const playerId = playerByExternalId.get(item.externalId);
      if (!playerId || !item.lastPlayedAt || item.lastScore <= 0) return null;

      const key = `${playerId}:${item.board.boardId}`;
      const previousPlay = latestPlayByKey.get(key);
      const isEntry = !previousPlay;
      const secondsSincePreviousPlay = previousPlay?.played_at
        ? Math.floor(
            (new Date(item.lastPlayedAt).getTime() -
              new Date(previousPlay.played_at).getTime()) /
              1000
          )
        : null;

      const normalMedian = median(eventScoresByKey.get(key) ?? []);
      const isTooFast =
        secondsSincePreviousPlay !== null &&
        secondsSincePreviousPlay > 0 &&
        secondsSincePreviousPlay < 70;
      const isMuchLowerThanNormal =
        normalMedian !== null &&
        normalMedian >= 10000 &&
        item.lastScore < normalMedian * 0.25;
      const isMysekai = !isEntry && isTooFast && isMuchLowerThanNormal;
      const sourceType = isEntry ? "entry" : isMysekai ? "mysekai" : "event";

      return {
        event_id: eventId,
        server,
        board_type: item.board.boardType,
        board_id: item.board.boardId,
        board_label: item.board.boardLabel,
        chapter: item.board.chapter,
        character: item.board.character,
        player_id: playerId,
        rank: item.rank,
        score_before: item.score - item.lastScore,
        score_after: item.score,
        play_score: item.lastScore,
        played_at: item.lastPlayedAt,
        raw_data: item.row,
        source_type: sourceType,
        is_mysekai: isMysekai,
        is_entry: isEntry,
        exclude_from_chart: isEntry || isMysekai,
        seconds_since_previous_play: secondsSincePreviousPlay,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (playPayload.length > 0) {
    const { error: playError } = await supabaseAdmin
      .from("play_records")
      .upsert(playPayload, {
        onConflict: "event_id,server,board_id,player_id,played_at",
      });

    if (playError) {
      return NextResponse.json({ error: playError.message }, { status: 500 });
    }
  }

  let hourlyCount = 0;

  if (shouldCaptureHourly) {
    const hourlyPayload = flatRows
      .map((item) => {
        const playerId = playerByExternalId.get(item.externalId);
        if (!playerId) return null;

        return {
          event_id: eventId,
          server,
          board_type: item.board.boardType,
          board_id: item.board.boardId,
          board_label: item.board.boardLabel,
          chapter: item.board.chapter,
          character: item.board.character,
          player_id: playerId,
          captured_hour: capturedHour,
          rank: item.rank,
          score: item.score,
          run_count_1h: item.runCount1h,
          raw_data: item.row,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    if (hourlyPayload.length > 0) {
      const { error: hourlyError } = await supabaseAdmin
        .from("hourly_run_snapshots")
        .upsert(hourlyPayload, {
          onConflict: "event_id,server,board_id,player_id,captured_hour",
        });

      if (hourlyError) {
        return NextResponse.json({ error: hourlyError.message }, { status: 500 });
      }

      hourlyCount = hourlyPayload.length;
    }
  }

  return NextResponse.json({
    ok: true,
    event_id: eventId,
    event_name: eventName,
    boards: boards.length,
    count: rankingPayload.length,
    plays: playPayload.length,
    hourly: hourlyCount,
    fetched_at: fetchedAt,
  });
}
